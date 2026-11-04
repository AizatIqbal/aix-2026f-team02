# Database

PointNull uses the MySQL 8 management schema in `management_schema_1.sql`.
Run this setup from the repository root in Windows Command Prompt.

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < project\database\management_schema_1.sql
```

Setup creates missing tables and keeps existing records. Apply migrations separately
when an existing table needs a different structure. Load `pointnull_mock_data.sql`
only into an empty development database to populate demo records.

Copy `project/backend/.env.example` to `project/backend/.env` and set the local
MySQL username and password. Run the backend on port 8000 from `project/backend`.

```cmd
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

```cmd
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

From `project/frontend`, install the dependencies and start Vite.

```cmd
pnpm install --frozen-lockfile
```

```cmd
pnpm dev
```

Vite sends `/api` requests to `http://127.0.0.1:8000`. For separate hosted origins,
set `VITE_API_BASE_URL` when building the frontend and `FRONTEND_ORIGIN` on the
backend to the frontend origin.

The dashboard reads net revenue from the statistics API. The sale form can attach
an existing customer or leave the sale as a walk-in. Discounts use monetary
amounts with at most two decimal places. Time filters use local clock times.

Spreadsheet imports save in one transaction. Imported product and order IDs, if
provided, are preserved so separate item sheets can refer to them. An existing
ID or missing reference rejects the batch. Add categories first or include them
in the same batch as products that reference them by name.
