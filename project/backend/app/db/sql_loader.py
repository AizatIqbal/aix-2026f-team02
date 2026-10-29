
from pathlib import Path


class SQLLoader:
    """Loads SQL scripts from the project's database directory."""

    def __init__(self):
        # sql_loader.py -> db -> app -> backend -> project
        project_dir = Path(__file__).resolve().parents[3]
        self.sql_dir = project_dir / "database"

    def load_sql_file(self, filename: str) -> str:
        """Read an SQL file and return its contents."""

        if not filename or Path(filename).name != filename:
            raise ValueError("Provide a valid SQL filename.")

        sql_path = self.sql_dir / filename

        if not sql_path.is_file() or sql_path.suffix.lower() != ".sql":
            raise FileNotFoundError(
                f"SQL file not found: {filename}"
            )

        return sql_path.read_text(encoding="utf-8")
