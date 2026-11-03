# Database

Use MySQL 8.0.16 or newer. `schema.sql` contains the table definitions from the
uploaded `management_schema_1 (1).sql` (the management schema). It creates
`business_management` with six tables: `category`, `customer`, `campaign`,
`product`, `orders`, and `order_item`.

Setup differs from the upload only by removing `DROP TABLE` and adding
`IF NOT EXISTS`. Running it again keeps existing tables and records. It does
not migrate tables from an older structure. Python database access stays in
`backend/app/db/`; no architecture or folder replacement is required.

## Connection and data contract

The shared `DatabaseManager()` uses SQLAlchemy with PyMySQL. Both analytics and
the endpoint branch can use its `engine`, `connect`, `execute_query`, `fetch_all`,
`fetch_one`, and `close` methods. Parameterized queries use named parameters,
for example `WHERE product_id = :product_id` with a dictionary of values.

Set these in `project/backend/.env` (never commit that file):

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_actual_mysql_password
DB_NAME=business_management
```

Analytics reads `customer_phone`, `order_date`, and `order_time`. All table names
are lower case so queries also work with case-sensitive MySQL table names.
`order_item.price` is the unit price recorded when the sale occurred.

`orders.discount` is money deducted from the whole order, not a percentage.
For 48 Colas at 1980.50 each, a 15% promotion is stored as discount `14259.60`
and total `80804.40`. Do not store `15%` as the discount. The existing analysis
allocates that monetary order discount across its items.

The reader retrieves all four record sets in one repeatable-read transaction,
then passes the same record format to `BusinessDataService` and the existing
analysis functions. It never repairs stored totals or updates sales.

## Windows Command Prompt setup

Stop the running backend with Ctrl+C. From the repository root:

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < project\database\schema.sql
```

```cmd
cd project\backend
```

If `.env` does not exist, copy the example. If asked to overwrite an existing
file, choose N and edit the existing file instead:

```cmd
copy /-Y .env.example .env
```

```cmd
notepad .env
```

Set the five values shown above, including `DB_NAME=business_management`, and save.
Existing environment variables take precedence over `.env`; remove old `DB_*`
variables if the checker reports a different database from the one configured.

```cmd
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

```cmd
.venv\Scripts\python.exe -m app.db.check_database
```

The checker connects, verifies required table/column names and the discount type,
and exercises the actual analytics reader. It prints record counts, not passwords
or customer details. A new empty database should report zero records.

```cmd
.venv\Scripts\python.exe -m pytest -q
```

Real-MySQL tests are skipped unless `MYSQL_TEST_SERVER_URL` is configured. Those
tests create and remove their own randomly named temporary databases, never an
existing database. A test account needs database creation privileges. All other
tests run without a MySQL server.

```cmd
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Open <http://127.0.0.1:8000/api/v1/statistics?start=2026-11-01&end=2026-11-02&group=day>.
New databases return zero statistics until orders and their items are entered.

## Existing POS records

`pos_database_mysql` remains separate and unchanged. Changing `DB_NAME` does not
move its records. This patch creates the shared structure and adapts the code;
it does not automatically migrate the older POS data.

A migration must map the old customer/date/time columns, convert percentage
discounts to money, and map campaigns to the `promocode` key. Back up and review
that mapping before importing old records. Changing a database name does not
change its columns.
