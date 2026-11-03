from fastapi import FastAPI
from .statistics_routes import router as statistics_router

app = FastAPI(
    title="Business Management and Analytics API",
    version="0.1.0",
)


@app.get("/api/v1/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}

app.include_router(statistics_router)
