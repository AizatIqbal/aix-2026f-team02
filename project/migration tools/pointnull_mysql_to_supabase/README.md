# PointNull: copy existing local MySQL data to Supabase PostgreSQL

This approach avoids pasting the very large `mock_data.sql` file into Supabase SQL Editor.
It connects from your own computer to:

1. your running local MySQL database (`business_management`), as a read-only source; and
2. your Supabase PostgreSQL database, as the destination.

It copies rows in batches in foreign-key order. It does not parse or execute the MySQL dump.
Therefore, if the campaign attribution UPDATE statements have already been executed in your
local MySQL database, those exact `promocode` and `discount` values are copied too. The local
MySQL database is not changed.

## Prerequisites

- The six PointNull tables already exist in Supabase (schema has been run).
- The target Supabase tables are empty.
- The local MySQL server is running and contains the desired PointNull data.
- Python 3.10+.

## Install dependencies

From your PointNull backend virtual environment:

```powershell
python -m pip install PyMySQL "psycopg[binary]" python-dotenv
```

## Configure environment

Create a separate file named `.env.migration` in the same directory as this script, or use
the existing backend `.env` (do not commit either file):

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=YOUR_LOCAL_MYSQL_PASSWORD
MYSQL_DATABASE=business_management

DATABASE_URL=YOUR_SUPABASE_TRANSACTION_POOLER_CONNECTION_STRING
```

If using `.env.migration`, either rename it to `.env` in the script folder before running,
or run the script from a directory where `load_dotenv()` finds the file. Never paste credentials
into chat or commit them to GitHub.

For Supabase, copy the **Transaction pooler** URI from Project → Connect. Keep the provided
username, host and port exactly as shown. The script adds `sslmode=require` if it is absent.

## Run a safe check first

```powershell
python migrate_mysql_to_supabase.py
```

This only checks connectivity, required tables/columns and row counts. It does not write data.

## Copy the data

Only after confirming the counts and confirming the Supabase target tables are empty:

```powershell
python migrate_mysql_to_supabase.py --migrate
```

The script refuses to import if any target table is non-empty. It copies the six tables in
foreign-key order, batches 1,000 rows at a time, omits the generated `orders.day_of_week`
column, preserves explicit IDs and synchronises identity sequences. On an error, the target
PostgreSQL transaction is rolled back. The source MySQL database is never modified.

## Campaign attribution

Your uploaded `mock_data.sql` ends with four UPDATE statements assigning `AUTUMN10`,
`LOYALTY5`, `CHUSEOK24`, and `NOODLEWEEK` to selected orders and setting the `discount` field.
If those statements were executed in local MySQL, the migration copies the already-updated rows.
If they were not executed, run them in MySQL Workbench before the migration (not in Supabase SQL
Editor), after confirming the campaign and orders data are present.

## Notes

- The source schema has a generated `day_of_week` column; PostgreSQL calculates it from
  `order_date`, so the transfer intentionally does not insert it.
- The source upload may not contain `product.image_url` and `product.is_active`; the destination
  schema has these columns. If absent in source, PostgreSQL defaults/nulls are retained.
- Run a final row-count and campaign attribution check in Supabase after transfer.
