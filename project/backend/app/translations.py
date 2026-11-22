"""Database-backed translation memory and best-effort machine translation."""
import asyncio
import html
import os
import re
import unicodedata
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text

from app.db.database_manager import DatabaseManager

router = APIRouter(prefix="/api/v1/translations", tags=["translations"])
TranslationContext = Literal["product", "category", "campaign", "general"]
TranslationLanguage = Literal["en", "ko"]
MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get"


class TranslationSourceItem(BaseModel):
    source_text: str = Field(min_length=1, max_length=500)
    context: TranslationContext


class TranslationResolveRequest(BaseModel):
    target_language: TranslationLanguage
    items: list[TranslationSourceItem] = Field(min_length=1, max_length=100)


class TranslationCreateRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=500)
    translated_text: str = Field(min_length=1, max_length=1000)
    source_language: TranslationLanguage
    target_language: TranslationLanguage
    context: TranslationContext


class TranslationUpdateRequest(BaseModel):
    translated_text: str = Field(min_length=1, max_length=1000)


def normalize_source_text(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip().casefold()


def detect_source_language(value: str) -> TranslationLanguage:
    # Mixed labels follow their first language-bearing character, so
    # "Kimchi Jjigae (김치찌개)" is treated as English and its reverse as Korean.
    first_language_character = re.search(r"[A-Za-z\uac00-\ud7a3]", value)
    return "ko" if first_language_character and "\uac00" <= first_language_character.group() <= "\ud7a3" else "en"


async def translate_with_mymemory(
    source_text: str,
    source_language: TranslationLanguage,
    target_language: TranslationLanguage,
    client: httpx.AsyncClient,
) -> str | None:
    """Translate one short segment; return None on any provider/quota failure."""
    if len(source_text.encode("utf-8")) > 500:
        return None
    params = {
        "q": source_text,
        "langpair": f"{source_language}|{target_language}",
        "mt": "1",
    }
    email = os.getenv("MYMEMORY_EMAIL", "").strip()
    if email:
        params["de"] = email
    try:
        response = await client.get(MYMEMORY_ENDPOINT, params=params)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if payload.get("responseStatus") != 200 or payload.get("quotaFinished") is True:
        return None
    translated = payload.get("responseData", {}).get("translatedText")
    if not isinstance(translated, str):
        return None
    translated = html.unescape(translated).strip()
    return translated or None


def _read_records(connection, grouped_keys: dict[tuple[str, str], set[str]], target_language: str):
    records: dict[tuple[str, str, str, str], dict] = {}
    statement = text("""
        SELECT translation_id, source_text, normalized_source_text,
               source_language, target_language, context, translated_text,
               provider, is_verified, updated_at
        FROM translation_memory
        WHERE source_language = :source_language
          AND target_language = :target_language
          AND context = :context
          AND normalized_source_text IN :normalized_texts
    """).bindparams(bindparam("normalized_texts", expanding=True))
    for (source_language, context), normalized_texts in grouped_keys.items():
        if not normalized_texts:
            continue
        rows = connection.execute(statement, {
            "source_language": source_language,
            "target_language": target_language,
            "context": context,
            "normalized_texts": sorted(normalized_texts),
        }).mappings().all()
        for row in rows:
            record = dict(row)
            key = (str(record["source_language"]), str(record["target_language"]),
                   str(record["context"]), str(record["normalized_source_text"]))
            records[key] = record
    return records


def _public_record(record: dict) -> dict:
    return {
        "translation_id": int(record["translation_id"]),
        "source_text": str(record["source_text"]),
        "translated_text": str(record["translated_text"]),
        "source_language": str(record["source_language"]),
        "target_language": str(record["target_language"]),
        "context": str(record["context"]),
        "provider": str(record["provider"]),
        "is_verified": bool(record["is_verified"]),
        "updated_at": str(record["updated_at"]) if record.get("updated_at") is not None else None,
    }


def _prepare_request(request: TranslationResolveRequest):
    prepared: list[dict] = []
    grouped_keys: dict[tuple[str, str], set[str]] = {}
    unique_missing: dict[tuple[str, str, str, str], dict] = {}
    for item in request.items:
        source_text = unicodedata.normalize("NFC", item.source_text).strip()
        if not source_text:
            continue
        source_language = detect_source_language(source_text)
        normalized = normalize_source_text(source_text)
        key = (source_language, request.target_language, item.context, normalized)
        entry = {
            "source_text": source_text,
            "source_language": source_language,
            "target_language": request.target_language,
            "context": item.context,
            "normalized_source_text": normalized,
            "key": key,
        }
        prepared.append(entry)
        if source_language != request.target_language:
            grouped_keys.setdefault((source_language, item.context), set()).add(normalized)
            unique_missing.setdefault(key, entry)
    return prepared, grouped_keys, unique_missing


def _resolution_response(prepared: list[dict], cached: dict) -> dict:
    response_items = []
    for entry in prepared:
        if entry["source_language"] == entry["target_language"]:
            response_items.append({
                "translation_id": None,
                "source_text": entry["source_text"],
                "translated_text": entry["source_text"],
                "source_language": entry["source_language"],
                "target_language": entry["target_language"],
                "context": entry["context"],
                "provider": "same-language",
                "is_verified": True,
                "updated_at": None,
            })
        elif entry["key"] in cached:
            response_items.append(_public_record(cached[entry["key"]]))
        else:
            response_items.append({
                "translation_id": None,
                "source_text": entry["source_text"],
                "translated_text": None,
                "source_language": entry["source_language"],
                "target_language": entry["target_language"],
                "context": entry["context"],
                "provider": "pending",
                "is_verified": False,
                "updated_at": None,
            })
    return {"translations": response_items}


@router.post("/resolve")
def resolve_translations(request: TranslationResolveRequest):
    """Read only from translation memory; never contacts the translation provider."""
    db = DatabaseManager()
    try:
        prepared, grouped_keys, _ = _prepare_request(request)
        with db.engine.connect() as connection:
            cached = _read_records(connection, grouped_keys, request.target_language)
        return _resolution_response(prepared, cached)
    finally:
        db.close()


@router.post("/generate")
async def generate_missing_translations(request: TranslationResolveRequest):
    """Translate only cache misses. The browser invokes this as a separate task."""
    db = DatabaseManager()
    try:
        prepared, grouped_keys, unique_missing = _prepare_request(request)
        with db.engine.connect() as connection:
            cached = _read_records(connection, grouped_keys, request.target_language)

        missing = [entry for key, entry in unique_missing.items() if key not in cached]
        generated: list[dict] = []
        enabled = os.getenv("TRANSLATION_API_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
        if missing and enabled:
            semaphore = asyncio.Semaphore(4)
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(8.0, connect=4.0),
                headers={"Accept": "application/json"},
            ) as client:
                async def translate_one(entry: dict):
                    async with semaphore:
                        value = await translate_with_mymemory(
                            entry["source_text"], entry["source_language"],
                            entry["target_language"], client,
                        )
                        return entry, value
                results = await asyncio.gather(*(translate_one(entry) for entry in missing))
            generated = [
                {**entry, "translated_text": translated}
                for entry, translated in results if translated
            ]

        if generated:
            with db.engine.begin() as connection:
                for entry in generated:
                    connection.execute(text("""
                        INSERT INTO translation_memory (
                            source_text, normalized_source_text, source_language,
                            target_language, context, translated_text, provider,
                            is_verified, created_at, updated_at
                        ) VALUES (
                            :source_text, :normalized_source_text, :source_language,
                            :target_language, :context, :translated_text, 'mymemory',
                            FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (source_language, target_language, context, normalized_source_text)
                        DO NOTHING
                    """), entry)
            # Re-read so a concurrent manual edit wins over generated text.
            with db.engine.connect() as connection:
                cached = _read_records(connection, grouped_keys, request.target_language)

        return _resolution_response(prepared, cached)
    finally:
        db.close()


@router.get("")
def list_translations(
    target_language: TranslationLanguage | None = Query(default=None),
    source_language: TranslationLanguage | None = Query(default=None),
    context: TranslationContext | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    db = DatabaseManager()
    try:
        clauses = []
        params: dict = {"limit": limit, "offset": offset}
        if target_language:
            clauses.append("target_language = :target_language")
            params["target_language"] = target_language
        if source_language:
            clauses.append("source_language = :source_language")
            params["source_language"] = source_language
        if context:
            clauses.append("context = :context")
            params["context"] = context
        if search and search.strip():
            comparison = "ILIKE" if db.engine.dialect.name == "postgresql" else "LIKE"
            clauses.append(f"(LOWER(source_text) {comparison} LOWER(:search) OR LOWER(translated_text) {comparison} LOWER(:search))")
            params["search"] = f"%{search.strip()}%"
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with db.engine.connect() as connection:
            rows = connection.execute(text(f"""
                SELECT translation_id, source_text, normalized_source_text,
                       source_language, target_language, context, translated_text,
                       provider, is_verified, updated_at
                FROM translation_memory {where}
                ORDER BY is_verified ASC, updated_at DESC, translation_id DESC
                LIMIT :limit OFFSET :offset
            """), params).mappings().all()
            total = connection.execute(text(f"SELECT COUNT(*) FROM translation_memory {where}"), params).scalar_one()
        return {"items": [_public_record(dict(row)) for row in rows], "total": int(total)}
    finally:
        db.close()


@router.post("", status_code=201)
def create_manual_translation(request: TranslationCreateRequest):
    if request.source_language == request.target_language:
        raise HTTPException(status_code=422, detail="Source and target languages must be different")
    source_text = unicodedata.normalize("NFC", request.source_text).strip()
    translated_text = unicodedata.normalize("NFC", request.translated_text).strip()
    if not source_text or not translated_text:
        raise HTTPException(status_code=422, detail="Both source and translated text are required")

    db = DatabaseManager()
    try:
        with db.engine.begin() as connection:
            row = connection.execute(text("""
                INSERT INTO translation_memory (
                    source_text, normalized_source_text, source_language,
                    target_language, context, translated_text, provider,
                    is_verified, created_at, updated_at
                ) VALUES (
                    :source_text, :normalized_source_text, :source_language,
                    :target_language, :context, :translated_text, 'manual',
                    TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (source_language, target_language, context, normalized_source_text)
                DO UPDATE SET source_text = EXCLUDED.source_text,
                    translated_text = EXCLUDED.translated_text,
                    provider = 'manual', is_verified = TRUE,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING translation_id, source_text, normalized_source_text,
                          source_language, target_language, context, translated_text,
                          provider, is_verified, updated_at
            """), {
                "source_text": source_text,
                "normalized_source_text": normalize_source_text(source_text),
                "source_language": request.source_language,
                "target_language": request.target_language,
                "context": request.context,
                "translated_text": translated_text,
            }).mappings().one()
        return _public_record(dict(row))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Translation could not be saved") from exc
    finally:
        db.close()


@router.put("/{translation_id}")
def update_translation(translation_id: int, request: TranslationUpdateRequest):
    translated_text = unicodedata.normalize("NFC", request.translated_text).strip()
    if not translated_text:
        raise HTTPException(status_code=422, detail="Translated text cannot be empty")
    db = DatabaseManager()
    try:
        with db.engine.begin() as connection:
            result = connection.execute(text("""
                UPDATE translation_memory
                SET translated_text = :translated_text,
                    provider = 'manual', is_verified = TRUE,
                    updated_at = CURRENT_TIMESTAMP
                WHERE translation_id = :translation_id
            """), {"translated_text": translated_text, "translation_id": translation_id})
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Translation not found")
            row = connection.execute(text("""
                SELECT translation_id, source_text, normalized_source_text,
                       source_language, target_language, context, translated_text,
                       provider, is_verified, updated_at
                FROM translation_memory WHERE translation_id = :translation_id
            """), {"translation_id": translation_id}).mappings().one()
        return _public_record(dict(row))
    finally:
        db.close()
