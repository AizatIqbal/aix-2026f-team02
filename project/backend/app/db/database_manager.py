import mysql.connector


class DatabaseManager:
    """Manages database access for the application."""

    def __init__(
        self,
        *,
        user,
        password,
        database="pos_database_mysql",
        host="127.0.0.1",
        port=3306,
    ):
        self.connection = None
        self.config = {
            "host": host,
            "port": port,
            "user": user,
            "password": password,
            "database": database,
            "connection_timeout": 5,
            "autocommit": True,
        }

    def connect(self):
        """Open the connection when needed."""
        if self.connection is None or not self.connection.is_connected():
            self.connection = mysql.connector.connect(**self.config)

    def execute_query(self, query: str, params=None):
        """Execute one write statement and return affected row count."""
        self.connect()

        with self.connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.rowcount

    def fetch_all(self, query: str, params=None):
        """Return all matching records as dictionaries."""
        self.connect()

        with self.connection.cursor(
            dictionary=True, buffered=True
        ) as cursor:
            cursor.execute(query, params)
            return cursor.fetchall()

    def fetch_one(self, query: str, params=None):
        """Return one matching record, or None."""
        self.connect()

        with self.connection.cursor(
            dictionary=True, buffered=True
        ) as cursor:
            cursor.execute(query, params)
            return cursor.fetchone()

    def close(self):
        """Close the database connection."""
        if self.connection is not None:
            self.connection.close()
            self.connection = None