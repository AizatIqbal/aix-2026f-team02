from fastapi import FastAPI

app = FastAPI(
    title="Business Management and Analytics API",
    version="0.1.0",
)


@app.get("/api/v1/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
