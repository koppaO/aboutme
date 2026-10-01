import copy
import json
import os
import re
import threading
from contextlib import contextmanager
from queue import Empty, Queue
from typing import Any, Iterator
from urllib.parse import quote_plus

import psycopg

from app.content import seed_about, seed_projects, seed_theme

SITE_ROW_ID = 1
_COLUMNS = frozenset({"theme", "about", "projects"})
RESOURCE_KEYS = ("theme", "me", "projects", "users")
ADMIN_ROLE = "admin"
_POOL_MAX = 8

_memory: dict[str, Any] | None = None
_ready = False
_postgres = False
_cache: dict[str, Any] = {}
_pool: Queue[psycopg.Connection] | None = None
_pool_size = 0
_pool_lock = threading.Lock()
_pool_url: str | None = None


class DuplicateUser(Exception):
    pass


class UnknownRole(Exception):
    pass


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


def _open_pool(url: str) -> None:
    global _pool, _pool_url
    if _pool is not None:
        return
    _pool_url = url
    _pool = Queue(maxsize=_POOL_MAX)


def close_pool() -> None:
    global _pool, _pool_size, _pool_url
    queue = _pool
    _pool = None
    _pool_url = None
    if queue is None:
        _pool_size = 0
        return
    while True:
        try:
            conn = queue.get_nowait()
        except Empty:
            break
        conn.close()
    with _pool_lock:
        _pool_size = 0


def _discard(conn: psycopg.Connection) -> None:
    global _pool_size
    try:
        conn.close()
    except Exception:
        pass
    with _pool_lock:
        _pool_size = max(0, _pool_size - 1)


def _checkout() -> psycopg.Connection:
    global _pool_size
    if _pool is None or _pool_url is None:
        raise RuntimeError("database pool missing")
    try:
        return _pool.get_nowait()
    except Empty:
        pass
    with _pool_lock:
        if _pool_size < _POOL_MAX:
            _pool_size += 1
            try:
                conn = psycopg.connect(_pool_url, connect_timeout=3)
            except Exception:
                _pool_size -= 1
                raise
            conn.autocommit = True
            return conn
    try:
        return _pool.get(timeout=5)
    except Empty as exc:
        raise RuntimeError("database pool exhausted") from exc


def _checkin(conn: psycopg.Connection) -> None:
    if _pool is None:
        conn.close()
        return
    try:
        _pool.put_nowait(conn)
    except Exception:
        _discard(conn)


@contextmanager
def _pg() -> Iterator[psycopg.Connection]:
    conn = _checkout()
    try:
        yield conn
    except (psycopg.OperationalError, psycopg.InterfaceError):
        _discard(conn)
        raise
    except Exception:
        _checkin(conn)
        raise
    else:
        _checkin(conn)


def database_status() -> str | None:
    url = _database_url()
    if not url:
        return None
    if _pool is not None:
        with _pg() as conn:
            conn.execute("SELECT 1")
        return "ok"
    with psycopg.connect(url, connect_timeout=3) as conn:
        conn.execute("SELECT 1")
    return "ok"


def _blank_site() -> dict[str, Any]:
    return {
        "theme": seed_theme(),
        "about": seed_about(),
        "projects": seed_projects(),
    }


def _empty_rbac() -> dict[str, Any]:
    roles = {1: {"id": 1, "name": ADMIN_ROLE}}
    resources = {
        index + 1: {"id": index + 1, "key": key}
        for index, key in enumerate(RESOURCE_KEYS)
    }
    return {
        "roles": roles,
        "resources": resources,
        "role_resources": {(1, resource_id) for resource_id in resources},
        "users": {},
        "ids": {"roles": 2, "resources": len(RESOURCE_KEYS) + 1, "users": 1},
    }


def _bootstrap_hash() -> str | None:
    from app import auth

    encoded = os.getenv("ADMIN_PASSWORD_HASH") or ""
    if auth.hash_format_ok(encoded):
        return encoded
    return None


def _bootstrap_login() -> str | None:
    login = (os.getenv("ADMIN_LOGIN") or "").strip()
    if not re.fullmatch(r"^[a-zA-Z0-9_-]{1,32}$", login):
        return None
    return login


def _seed_first_admin_memory() -> None:
    assert _memory is not None
    if _memory["users"]:
        return
    login = _bootstrap_login()
    encoded = _bootstrap_hash()
    if login is None or encoded is None:
        return
    _memory["users"][login] = {
        "id": 1,
        "login": login,
        "password_hash": encoded,
        "status": True,
        "role_id": 1,
    }
    _memory["ids"]["users"] = 2


def _init_memory() -> None:
    global _memory
    _memory = {**_blank_site(), **_empty_rbac()}
    _seed_first_admin_memory()


def _seed_catalogs_postgres(conn) -> None:
    conn.execute("INSERT INTO roles (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (ADMIN_ROLE,))
    for key in RESOURCE_KEYS:
        conn.execute(
            "INSERT INTO resources (key) VALUES (%s) ON CONFLICT (key) DO NOTHING",
            (key,),
        )
    conn.execute(
        """
        INSERT INTO role_resources (role_id, resource_id)
        SELECT r.id, res.id
        FROM roles r
        CROSS JOIN resources res
        WHERE r.name = %s
        ON CONFLICT DO NOTHING
        """,
        (ADMIN_ROLE,),
    )


def _seed_first_admin_postgres(conn) -> None:
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()
    if count is not None and int(count[0]) > 0:
        return
    login = _bootstrap_login()
    encoded = _bootstrap_hash()
    if login is None or encoded is None:
        return
    role_id = conn.execute(
        "SELECT id FROM roles WHERE name = %s",
        (ADMIN_ROLE,),
    ).fetchone()
    if role_id is None:
        return
    conn.execute(
        """
        INSERT INTO users (login, password_hash, status, role_id)
        VALUES (%s, %s, TRUE, %s)
        ON CONFLICT (login) DO NOTHING
        """,
        (login, encoded, role_id[0]),
    )


def _init_postgres(url: str) -> None:
    seed = _blank_site()
    with psycopg.connect(url) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS site_state (
                id INTEGER PRIMARY KEY,
                theme JSONB NOT NULL,
                about JSONB NOT NULL,
                projects JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS resources (
                id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                key TEXT NOT NULL UNIQUE
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS role_resources (
                role_id INTEGER NOT NULL REFERENCES roles (id),
                resource_id INTEGER NOT NULL REFERENCES resources (id),
                PRIMARY KEY (role_id, resource_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                login TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                status BOOLEAN NOT NULL DEFAULT TRUE,
                role_id INTEGER NOT NULL REFERENCES roles (id)
            )
            """
        )
        exists = conn.execute(
            "SELECT 1 FROM site_state WHERE id = %s",
            (SITE_ROW_ID,),
        ).fetchone()
        if exists is None:
            conn.execute(
                """
                INSERT INTO site_state (id, theme, about, projects)
                VALUES (%s, %s::jsonb, %s::jsonb, %s::jsonb)
                """,
                (
                    SITE_ROW_ID,
                    json.dumps(seed["theme"]),
                    json.dumps(seed["about"]),
                    json.dumps(seed["projects"]),
                ),
            )
        _seed_catalogs_postgres(conn)
        _seed_first_admin_postgres(conn)


def init_site_state() -> None:
    global _ready, _postgres
    _cache.clear()
    url = _database_url()
    if url:
        _init_postgres(url)
        _open_pool(url)
        _postgres = True
    else:
        _init_memory()
        _postgres = False
    _ready = True


def ensure_site_state() -> None:
    if not _ready:
        init_site_state()


def reload_seed() -> None:
    """Replace live state with JSON/theme seed and reset users. Used by tests."""
    global _ready, _memory, _postgres
    _cache.clear()
    seed = _blank_site()
    url = _database_url()
    if url:
        _init_postgres(url)
        with psycopg.connect(url) as conn:
            conn.execute(
                """
                INSERT INTO site_state (id, theme, about, projects)
                VALUES (%s, %s::jsonb, %s::jsonb, %s::jsonb)
                ON CONFLICT (id) DO UPDATE SET
                    theme = EXCLUDED.theme,
                    about = EXCLUDED.about,
                    projects = EXCLUDED.projects,
                    updated_at = NOW()
                """,
                (
                    SITE_ROW_ID,
                    json.dumps(seed["theme"]),
                    json.dumps(seed["about"]),
                    json.dumps(seed["projects"]),
                ),
            )
            conn.execute(
                "TRUNCATE users, role_resources, resources, roles RESTART IDENTITY CASCADE"
            )
            _seed_catalogs_postgres(conn)
            _seed_first_admin_postgres(conn)
        _open_pool(url)
        _postgres = True
        _ready = True
        return
    _memory = {**seed, **_empty_rbac()}
    _postgres = False
    _ready = True
    _seed_first_admin_memory()


def _require_column(column: str) -> str:
    if column not in _COLUMNS:
        raise ValueError("invalid column")
    return column


def _remember(column: str, value: Any) -> Any:
    stored = copy.deepcopy(value)
    _cache[column] = stored
    return copy.deepcopy(stored)


def _fetch_column(column: str) -> Any:
    column = _require_column(column)
    ensure_site_state()
    if column in _cache:
        return copy.deepcopy(_cache[column])
    if _postgres:
        with _pg() as conn:
            row = conn.execute(
                f"SELECT {column} FROM site_state WHERE id = %s",
                (SITE_ROW_ID,),
            ).fetchone()
        if row is None:
            url = _database_url()
            if not url:
                raise RuntimeError("database url missing")
            _init_postgres(url)
            with _pg() as conn:
                row = conn.execute(
                    f"SELECT {column} FROM site_state WHERE id = %s",
                    (SITE_ROW_ID,),
                ).fetchone()
        if row is None:
            raise RuntimeError("site_state missing")
        return _remember(column, row[0])
    assert _memory is not None
    return _remember(column, _memory[column])


def _store_column(column: str, value: Any) -> Any:
    column = _require_column(column)
    ensure_site_state()
    if _postgres:
        with _pg() as conn:
            conn.execute(
                f"""
                UPDATE site_state
                SET {column} = %s::jsonb, updated_at = NOW()
                WHERE id = %s
                """,
                (json.dumps(value), SITE_ROW_ID),
            )
        return _remember(column, value)
    assert _memory is not None
    _memory[column] = copy.deepcopy(value)
    return _remember(column, value)


def get_theme() -> Any:
    return _fetch_column("theme")


def get_about() -> Any:
    return _fetch_column("about")


def get_projects() -> Any:
    return _fetch_column("projects")


def put_theme(value: Any) -> Any:
    return _store_column("theme", value)


def put_about(value: Any) -> Any:
    return _store_column("about", value)


def put_projects(value: Any) -> Any:
    return _store_column("projects", value)


def _user_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": int(row[0]),
        "login": row[1],
        "password_hash": row[2],
        "status": bool(row[3]),
        "role_id": int(row[4]),
    }


def get_user_by_login(login: str) -> dict[str, Any] | None:
    ensure_site_state()
    if _postgres:
        with _pg() as conn:
            row = conn.execute(
                """
                SELECT id, login, password_hash, status, role_id
                FROM users
                WHERE login = %s
                """,
                (login,),
            ).fetchone()
        if row is None:
            return None
        return _user_from_row(row)
    assert _memory is not None
    user = _memory["users"].get(login)
    if user is None:
        return None
    return copy.deepcopy(user)


def role_has_resource(role_id: int, key: str) -> bool:
    ensure_site_state()
    if _postgres:
        with _pg() as conn:
            row = conn.execute(
                """
                SELECT 1
                FROM role_resources rr
                JOIN resources res ON res.id = rr.resource_id
                WHERE rr.role_id = %s AND res.key = %s
                """,
                (role_id, key),
            ).fetchone()
        return row is not None
    assert _memory is not None
    resource_id = next(
        (item["id"] for item in _memory["resources"].values() if item["key"] == key),
        None,
    )
    if resource_id is None:
        return False
    return (role_id, resource_id) in _memory["role_resources"]


def role_id_by_name(name: str) -> int | None:
    ensure_site_state()
    if _postgres:
        with _pg() as conn:
            row = conn.execute("SELECT id FROM roles WHERE name = %s", (name,)).fetchone()
        return None if row is None else int(row[0])
    assert _memory is not None
    for role in _memory["roles"].values():
        if role["name"] == name:
            return int(role["id"])
    return None


def create_role(name: str) -> int:
    ensure_site_state()
    existing = role_id_by_name(name)
    if existing is not None:
        return existing
    if _postgres:
        with _pg() as conn:
            row = conn.execute(
                "INSERT INTO roles (name) VALUES (%s) RETURNING id",
                (name,),
            ).fetchone()
        assert row is not None
        return int(row[0])
    assert _memory is not None
    role_id = int(_memory["ids"]["roles"])
    _memory["ids"]["roles"] = role_id + 1
    _memory["roles"][role_id] = {"id": role_id, "name": name}
    return role_id


def set_role_resources(role_name: str, keys: list[str]) -> None:
    role_id = role_id_by_name(role_name)
    if role_id is None:
        raise UnknownRole(role_name)
    unknown = [key for key in keys if key not in RESOURCE_KEYS]
    if unknown:
        raise ValueError("unknown resource")
    ensure_site_state()
    if _postgres:
        with _pg() as conn:
            conn.autocommit = False
            try:
                conn.execute("DELETE FROM role_resources WHERE role_id = %s", (role_id,))
                for key in keys:
                    conn.execute(
                        """
                        INSERT INTO role_resources (role_id, resource_id)
                        SELECT %s, id FROM resources WHERE key = %s
                        """,
                        (role_id, key),
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.autocommit = True
        return
    assert _memory is not None
    _memory["role_resources"] = {
        pair for pair in _memory["role_resources"] if pair[0] != role_id
    }
    key_ids = {item["key"]: item["id"] for item in _memory["resources"].values()}
    for key in keys:
        _memory["role_resources"].add((role_id, key_ids[key]))


def create_user(login: str, password_hash: str, role_name: str, status: bool = True) -> dict[str, Any]:
    ensure_site_state()
    if get_user_by_login(login) is not None:
        raise DuplicateUser(login)
    role_id = role_id_by_name(role_name)
    if role_id is None:
        raise UnknownRole(role_name)
    if _postgres:
        with _pg() as conn:
            try:
                row = conn.execute(
                    """
                    INSERT INTO users (login, password_hash, status, role_id)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id, login, password_hash, status, role_id
                    """,
                    (login, password_hash, status, role_id),
                ).fetchone()
            except psycopg.errors.UniqueViolation as exc:
                raise DuplicateUser(login) from exc
        assert row is not None
        return _user_from_row(row)
    assert _memory is not None
    user_id = int(_memory["ids"]["users"])
    _memory["ids"]["users"] = user_id + 1
    user = {
        "id": user_id,
        "login": login,
        "password_hash": password_hash,
        "status": status,
        "role_id": role_id,
    }
    _memory["users"][login] = user
    return copy.deepcopy(user)


def set_user_status(login: str, status: bool) -> None:
    ensure_site_state()
    if _postgres:
        with _pg() as conn:
            conn.execute("UPDATE users SET status = %s WHERE login = %s", (status, login))
        return
    assert _memory is not None
    user = _memory["users"].get(login)
    if user is not None:
        user["status"] = status
