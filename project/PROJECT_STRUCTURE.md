# Project Structure

This folder contains the source code and resources for our
Business Management and Analytics web application.

## Folders

- `frontend/` — React.js user interface.
- `backend/` — Python API and business logic.
- `database/` — SQL scripts, database schema, and setup documentation.
- `res/` — Shared resources and sample data.

## Backend

- `app/` — FastAPI application code.
- `app/db/` — Database connection and query code.
- `tests/` — Backend tests.
- `requirements.txt` — Python dependencies.

Server on/off switch (inform group if want to run)
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app

## Notes

- The database technology is still to be confirmed.
- Do not commit passwords, API keys, or other secrets.
- Each developer should create their own Python virtual environment.
