# MySQL setup

`management_schema_1.sql` defines the tables in `business_management`.
Run it from the repository root in Windows Command Prompt.

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < project\database\management_schema_1.sql
```

Setup creates missing tables and preserves existing records. Changes to the
structure of existing tables require a migration.

For an empty development database, `pointnull_mock_data.sql` adds sample data.
Run the sample import once.

```cmd
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < project\database\pointnull_mock_data.sql
```

Use `project/backend/.env.example` to set up your local `project/backend/.env`
with your MySQL connection settings. Keep your credentials in that local file.
