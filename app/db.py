import os
from urllib.parse import quote_plus

import psycopg


def _database_url() -> str | None:
    if url := os.getenv("DATABASE_URL"):
        return url

    password = os.getenv("POSTGRES_PASSWORD")
    if not password:
        return None

    user = os.environ["POSTGRES_USER"]
    dbname = os.environ["POSTGRES_DB"]
    host = os.getenv("POSTGRES_HOST", "postgres")
    port = os.getenv("POSTGRES_PORT", "5432")
    return (
        f"postgresql://{quote_plus(user)}:{quote_plus(password)}"
        f"@{host}:{port}/{quote_plus(dbname)}"
    )


def database_status() -> str | None:
    url = _database_url()
    if not url:
        return None
    with psycopg.connect(url, connect_timeout=3) as conn:
        conn.execute("SELECT 1")
    return "ok"
