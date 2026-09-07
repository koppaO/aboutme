import os

import psycopg


def database_status() -> str | None:
    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    with psycopg.connect(url, connect_timeout=3) as conn:
        conn.execute("SELECT 1")
    return "ok"
