import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createManualTranslation,
  getTranslations,
  updateTranslation,
  type TranslationContext,
  type TranslationLanguage,
  type TranslationRecord,
} from "./data-access";
import { usePreferences } from "./preferences";
import { Button, Input, useModalScrollLock } from "./ui";

const PAGE_SIZE = 50;

const CONTEXTS: Array<{ value: TranslationContext | "all"; label: string }> = [
  { value: "all", label: "All content" },
  { value: "product", label: "Products" },
  { value: "category", label: "Categories" },
  { value: "campaign", label: "Campaigns" },
  { value: "general", label: "General" },
];

export function TranslationManager({ onClose }: { onClose: () => void }) {
  const { t, applyTranslations } = usePreferences();
  const [sourceLanguage, setSourceLanguage] = useState<TranslationLanguage>("en");
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>("ko");
  const [context, setContext] = useState<TranslationContext | "all">("all");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<TranslationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newContext, setNewContext] = useState<TranslationContext>("product");
  const [newSource, setNewSource] = useState("");
  const [newTranslated, setNewTranslated] = useState("");
  useModalScrollLock();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setPage(0);
  }, [sourceLanguage, targetLanguage, context, search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getTranslations({
      source_language: sourceLanguage,
      target_language: targetLanguage,
      context: context === "all" ? undefined : context,
      search: search.trim() || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return;
        setRecords(result.items);
        setTotal(result.total);
        setDrafts(Object.fromEntries(result.items.map((item) => [item.translation_id, item.translated_text])));
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : t("Translations could not be loaded."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceLanguage, targetLanguage, context, search, page, t]);

  const pendingCount = useMemo(() => records.filter((item) => !item.is_verified).length, [records]);

  async function saveRecord(record: TranslationRecord): Promise<void> {
    const translatedText = (drafts[record.translation_id] ?? "").trim();
    if (!translatedText) {
      setError(t("A translation cannot be empty."));
      return;
    }
    setSavingId(record.translation_id);
    setError("");
    setNotice("");
    try {
      const updated = await updateTranslation(record.translation_id, translatedText);
      setRecords((current) => current.map((item) => item.translation_id === updated.translation_id ? updated : item));
      setDrafts((current) => ({ ...current, [updated.translation_id]: updated.translated_text }));
      applyTranslations([updated]);
      setNotice(t("Translation saved and verified."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Translation could not be saved."));
    } finally {
      setSavingId(null);
    }
  }

  async function addManualTranslation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newSource.trim() || !newTranslated.trim()) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const created = await createManualTranslation({
        source_text: newSource.trim(),
        translated_text: newTranslated.trim(),
        source_language: sourceLanguage,
        target_language: targetLanguage,
        context: newContext,
      });
      applyTranslations([created]);
      setRecords((current) => [created, ...current.filter((item) => item.translation_id !== created.translation_id)]);
      setDrafts((current) => ({ ...current, [created.translation_id]: created.translated_text }));
      setContext("all");
      setSearch("");
      setPage(0);
      setNewSource("");
      setNewTranslated("");
      setNotice(t("Manual translation saved."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Translation could not be saved."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto overscroll-contain bg-ink/45 p-3 backdrop-blur-sm sm:p-5"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="my-auto flex max-h-[min(92dvh,900px)] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="translation-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-line bg-white px-5 py-4 sm:px-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{t("Language tools")}</div>
            <h2 id="translation-manager-title" className="mt-1 font-display text-2xl font-bold text-ink">{t("Translation memory")}</h2>
            <p className="mt-1 text-xs text-ink-muted">{t("Review machine translations and save your preferred wording.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6">
          {error && <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</div>}
          {notice && <div role="status" className="rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-accent-strong">{notice}</div>}

          <section className="rounded-2xl border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold">{t("Translation direction")}</h3>
              <span className="text-xs text-ink-faint">{total} {t("saved")}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-ink-muted">{t("Original language")}
                <select className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink" value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value as TranslationLanguage)}>
                  <option value="en">English</option>
                  <option value="ko">한국어</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-ink-muted">{t("Translated language")}
                <select className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value as TranslationLanguage)}>
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            {sourceLanguage === targetLanguage && <p className="mt-2 text-xs text-danger">{t("Choose two different languages.")}</p>}
          </section>

          <form onSubmit={(event) => void addManualTranslation(event)} className="space-y-3 rounded-2xl border border-line bg-white p-4">
            <div>
              <h3 className="text-sm font-bold">{t("Add a translation")}</h3>
              <p className="mt-1 text-xs text-ink-muted">{t("Manual entries are saved as verified and take priority over machine translations.")}</p>
            </div>
            <label className="block text-xs font-semibold text-ink-muted">{t("Content type")}
              <select className="mt-1.5 min-h-10 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink" value={newContext} onChange={(event) => setNewContext(event.target.value as TranslationContext)}>
                {CONTEXTS.filter((item) => item.value !== "all").map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-ink-muted">{t("Original text")}
                <Input className="mt-1.5 w-full" value={newSource} onChange={(event) => setNewSource(event.target.value)} maxLength={500} required />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">{t("Translation")}
                <Input className="mt-1.5 w-full" value={newTranslated} onChange={(event) => setNewTranslated(event.target.value)} maxLength={1000} required />
              </label>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={creating || !newSource.trim() || !newTranslated.trim() || sourceLanguage === targetLanguage}>
                {creating ? t("Saving…") : t("Save verified translation")}
              </Button>
            </div>
          </form>

          <section className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold">{t("Saved translations")}</h3>
                <p className="mt-1 text-xs text-ink-muted">{pendingCount} {t("need review")}</p>
              </div>
              <div className="flex gap-2">
                <select aria-label={t("Content type")} className="min-h-10 rounded-xl border border-line bg-white px-2 text-xs" value={context} onChange={(event) => setContext(event.target.value as TranslationContext | "all")}>
                  {CONTEXTS.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
                </select>
                <Input className="min-h-10 w-40" placeholder={t("Search translations")} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} />
              </div>
            </div>
            {loading ? (
              <div className="rounded-xl border border-line bg-white p-5 text-center text-sm text-ink-muted">{t("Loading…")}</div>
            ) : records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-ink-muted">{t("No translations found for this language pair.")}</div>
            ) : records.map((record) => (
              <article key={record.translation_id} className="space-y-3 rounded-2xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-strong px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">{t(record.context === "product" ? "Products" : record.context === "category" ? "Categories" : record.context === "campaign" ? "Campaigns" : "General")}</span>
                  {record.is_verified
                    ? <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-bold text-accent-strong">{t("Verified")}</span>
                    : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">{t("Needs review")}</span>}
                  <span className="ml-auto text-[10px] text-ink-faint">{record.provider}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint">{t("Original text")}</div>
                    <p className="break-words text-sm font-medium text-ink">{record.source_text}</p>
                  </div>
                  <label className="block min-w-0 text-[10px] font-bold uppercase tracking-wide text-ink-faint">{t("Translation")}
                    <Input className="mt-1.5 w-full text-sm font-medium normal-case tracking-normal text-ink" value={drafts[record.translation_id] ?? record.translated_text} onChange={(event) => setDrafts((current) => ({ ...current, [record.translation_id]: event.target.value }))} maxLength={1000} />
                  </label>
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" onClick={() => void saveRecord(record)} disabled={savingId === record.translation_id || !(drafts[record.translation_id] ?? "").trim()}>
                    {savingId === record.translation_id ? t("Saving…") : record.is_verified ? t("Save changes") : t("Save & verify")}
                  </Button>
                </div>
              </article>
            ))}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <Button variant="secondary" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
                  {t("Previous")}
                </Button>
                <span className="text-xs text-ink-muted">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
                </span>
                <Button variant="secondary" onClick={() => setPage((current) => current + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>
                  {t("Next")}
                </Button>
              </div>
            )}
          </section>
          <p className="text-[11px] leading-5 text-ink-faint">{t("Machine translations are suggestions. Verified translations are kept in the database and reused without another provider request.")}</p>
        </div>
        <footer className="flex shrink-0 justify-end border-t border-line bg-white px-5 py-3 sm:px-6">
          <Button onClick={onClose}>{t("Done")}</Button>
        </footer>
      </section>
    </div>
  );
}
