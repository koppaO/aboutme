"""Login, sessions and rights.

Trade-off: anyone who knows a login can lock it out for LOGIN_LOCKOUT_SEC by failing on purpose.
"""

import asyncio
import functools
import hashlib
import hmac
import os
import secrets
import time
from typing import Any, NoReturn
from urllib.parse import urlparse

from fastapi import HTTPException, Request, Response

COOKIE_NAME = "session"
ALLOWED_ORIGIN = "https://koppa0.dev"
SESSION_TTL_SEC = 60 * 60 * 24
SESSION_TOKEN_BYTES = 32
MAX_TOKEN_LEN = 128
HASH_SCHEME = "pbkdf2_sha256"
HASH_ITERATIONS = 600_000
MIN_SECRET_LEN = 16
# По IP: 5 неудач подряд закрывают вход с этого адреса на минуту.
MAX_FAILURES = 5
LOCKOUT_SEC = 60
MAX_TRACKED_IPS = 4096
# По логину: 10 неудач за 15 минут закрывают этот логин на 15 минут с любого адреса.
LOGIN_MAX_FAILURES = 10
LOGIN_WINDOW_SEC = 15 * 60
LOGIN_LOCKOUT_SEC = 15 * 60
MAX_TRACKED_LOGINS = 4096
FAIL_DELAY_SEC = 0.4
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})
_PLACEHOLDER_SECRETS = frozenset(
    {
        "replace-with-long-random-string",
        "changeme",
        "change-me",
    }
)

_attempts: dict[str, dict[str, Any]] = {}
_login_attempts: dict[str, dict[str, Any]] = {}


def _now() -> float:
    return time.time()


def hash_password(
    password: str,
    *,
    salt: bytes | None = None,
    iterations: int = HASH_ITERATIONS,
) -> str:
    if salt is None:
        salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return f"{HASH_SCHEME}${iterations}${salt.hex()}${digest.hex()}"


def _parse_hash(encoded: str) -> tuple[int, bytes, bytes] | None:
    try:
        scheme, iter_s, salt_hex, digest_hex = encoded.split("$", 3)
        if scheme != HASH_SCHEME:
            return None
        iterations = int(iter_s)
        if iterations < 1 or iterations > 5_000_000:
            return None
        salt = bytes.fromhex(salt_hex)
        digest = bytes.fromhex(digest_hex)
    except (ValueError, AttributeError):
        return None
    if not salt or not digest:
        return None
    return iterations, salt, digest


def hash_format_ok(encoded: str) -> bool:
    return _parse_hash(encoded) is not None


def hash_iterations(encoded: str) -> int | None:
    parsed = _parse_hash(encoded)
    return None if parsed is None else parsed[0]


def verify_password(password: str, encoded: str) -> bool:
    parsed = _parse_hash(encoded)
    if parsed is None:
        return False
    iterations, salt, expected = parsed
    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(actual, expected)


# Ключ кэша — число итераций: неизвестный логин проверяется так же долго, как настоящий.
@functools.lru_cache(maxsize=2)
def _dummy_hash(iterations: int) -> str:
    return hash_password("invalid", salt=b"\x00" * 16, iterations=iterations)


def authenticate(login: str, password: str) -> dict[str, Any] | None:
    from app import db

    user = db.get_user_by_login(login)
    if user is None:
        verify_password(password, _dummy_hash(HASH_ITERATIONS))
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    if not user["status"]:
        return None
    iterations = hash_iterations(user["password_hash"])
    if iterations is not None and iterations < HASH_ITERATIONS:
        # Открытый пароль есть только сейчас, поэтому слабый хэш усиливаем при входе.
        # Тег сессий считается от хэша: прежние сессии этого пользователя перестают действовать.
        upgraded = hash_password(password, iterations=HASH_ITERATIONS)
        db.set_password_hash(int(user["id"]), upgraded)
        user = {**user, "password_hash": upgraded}
    return user


def credentials_ok(login: str, password: str) -> bool:
    return authenticate(login, password) is not None


def _secret() -> bytes | None:
    value = (os.getenv("SESSION_SECRET") or "").strip()
    if len(value) < MIN_SECRET_LEN or value in _PLACEHOLDER_SECRETS:
        return None
    return value.encode("utf-8")


def _password_tag(password_hash: str) -> str | None:
    secret = _secret()
    if secret is None:
        return None
    return hmac.new(secret, password_hash.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def make_session(user: dict[str, Any]) -> str | None:
    """Store a new session and return its token; only the token's sha256 is stored."""
    from app import db

    tag = _password_tag(user["password_hash"])
    if tag is None:
        return None
    now = _now()
    db.purge_sessions(now)
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    db.create_session(_token_hash(token), int(user["id"]), tag, now, now + SESSION_TTL_SEC)
    return token


def _session_token(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > MAX_TOKEN_LEN:
        return None
    return token


def current_user(request: Request) -> dict[str, Any] | None:
    from app import db

    token = _session_token(request)
    if token is None:
        return None
    row = db.get_session(_token_hash(token))
    if row is None or row["expires_at"] <= _now():
        return None
    user = row["user"]
    expected = _password_tag(user["password_hash"])
    if expected is None or not hmac.compare_digest(row["password_tag"], expected):
        return None
    return user


def end_session(request: Request) -> None:
    from app import db

    token = _session_token(request)
    if token is not None:
        db.delete_session(_token_hash(token))


def client_ip(request: Request) -> str:
    if os.getenv("TRUST_PROXY") == "1":
        real = (request.headers.get("x-real-ip") or "").strip()
        if real and "\n" not in real and "\r" not in real:
            # Extracts the first IP in case of multiple comma-separated IPs
            first_ip = real.split(",")[0].strip()
            if first_ip and len(first_ip) <= 64:
                return first_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def reset_rate_limits() -> None:
    _attempts.clear()
    _login_attempts.clear()


def _prune_attempts(now: float) -> None:
    stale = [
        ip
        for ip, row in _attempts.items()
        if float(row.get("locked_until") or 0) <= now
        and now - float(row.get("seen") or 0) > LOCKOUT_SEC
    ]
    for ip in stale:
        _attempts.pop(ip, None)
    if len(_attempts) <= MAX_TRACKED_IPS:
        return
    unlocked = sorted(
        (
            ip
            for ip, row in _attempts.items()
            if float(row.get("locked_until") or 0) <= now
        ),
        key=lambda ip: float(_attempts[ip].get("seen") or 0),
    )
    for ip in unlocked:
        if len(_attempts) <= MAX_TRACKED_IPS:
            break
        _attempts.pop(ip, None)


def _locked_until(ip: str) -> float:
    row = _attempts.get(ip)
    if not row:
        return 0
    return float(row.get("locked_until") or 0)


def is_locked(ip: str) -> bool:
    row = _attempts.get(ip)
    if not row:
        return False
    if float(row.get("locked_until") or 0) > time.time():
        return True
    if int(row.get("count") or 0) >= MAX_FAILURES:
        row["count"] = 0
        row["locked_until"] = 0.0
    return False


def register_failure(ip: str) -> None:
    now = time.time()
    _prune_attempts(now)
    row = _attempts.setdefault(ip, {"count": 0, "locked_until": 0.0, "seen": now})
    row["seen"] = now
    row["count"] = int(row["count"]) + 1
    if row["count"] >= MAX_FAILURES:
        row["locked_until"] = now + LOCKOUT_SEC
    _prune_attempts(now)


def clear_failures(ip: str) -> None:
    _attempts.pop(ip, None)


def login_key(login: str) -> str:
    return login.strip().lower()


def _recent(fails: list[float], now: float) -> list[float]:
    return [moment for moment in fails if now - moment < LOGIN_WINDOW_SEC]


def _prune_login_attempts(now: float) -> None:
    stale = [
        key
        for key, row in _login_attempts.items()
        if row["locked_until"] <= now and not _recent(row["fails"], now)
    ]
    for key in stale:
        _login_attempts.pop(key, None)
    if len(_login_attempts) <= MAX_TRACKED_LOGINS:
        return
    # Заблокированные логины не вытесняем, иначе поток мусорных логинов снимал бы блокировку.
    unlocked = sorted(
        (key for key, row in _login_attempts.items() if row["locked_until"] <= now),
        key=lambda key: _login_attempts[key]["seen"],
    )
    for key in unlocked:
        if len(_login_attempts) <= MAX_TRACKED_LOGINS:
            break
        _login_attempts.pop(key, None)


def login_locked(login: str) -> bool:
    row = _login_attempts.get(login_key(login))
    return bool(row) and row["locked_until"] > _now()


def register_login_failure(login: str) -> None:
    now = _now()
    key = login_key(login)
    row = _login_attempts.setdefault(key, {"fails": [], "locked_until": 0.0, "seen": now})
    row["seen"] = now
    row["fails"] = _recent(row["fails"], now)
    row["fails"].append(now)
    if len(row["fails"]) >= LOGIN_MAX_FAILURES:
        row["locked_until"] = now + LOGIN_LOCKOUT_SEC
        row["fails"] = []
    _prune_login_attempts(now)


def clear_login_failures(login: str) -> None:
    _login_attempts.pop(login_key(login), None)


def _origin_hostname(origin: str) -> str | None:
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    return parsed.hostname.lower()


def require_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin == ALLOWED_ORIGIN:
        return
    host = (request.url.hostname or "").lower()
    if (
        origin
        and host in _LOCAL_HOSTS
        and _origin_hostname(origin) == host
        and urlparse(origin).scheme == "http"
    ):
        return
    raise HTTPException(status_code=403, detail="forbidden")


def require_user(request: Request) -> dict[str, Any]:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not user["status"]:
        raise HTTPException(status_code=403, detail="forbidden")
    return user


def require_admin(request: Request) -> dict[str, Any]:
    require_origin(request)
    return require_user(request)


def require_session_resource(request: Request, key: str) -> dict[str, Any]:
    from app import db

    user = require_user(request)
    if not db.role_has_resource(int(user["role_id"]), key):
        raise HTTPException(status_code=403, detail="forbidden")
    return user


def require_resource(request: Request, key: str) -> dict[str, Any]:
    require_origin(request)
    return require_session_resource(request, key)


def _cookie_secure(request: Request) -> bool:
    host = (request.url.hostname or "").lower()
    return not (host in _LOCAL_HOSTS and request.url.scheme == "http")


def set_session_cookie(response: Response, token: str, request: Request) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="strict",
        max_age=SESSION_TTL_SEC,
        path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        secure=_cookie_secure(request),
        httponly=True,
        samesite="strict",
    )


# Попытка засчитывается неудачной сразу после проверки блокировки, до медленного PBKDF2,
# без await между ними. Иначе параллельные запросы все видят «не заблокирован» и обходят
# лимит. Успешный вход потом обнуляет счётчики.
async def login_allowed(ip: str) -> None:
    if is_locked(ip):
        raise HTTPException(status_code=429, detail="too many attempts")
    register_failure(ip)


async def login_name_allowed(login: str) -> None:
    # Один ответ для любого логина, есть он или нет. Пароль при блокировке не проверяем.
    if login_locked(login):
        raise HTTPException(status_code=429, detail="too many attempts")
    register_login_failure(login)


async def reject_login(ip: str) -> NoReturn:
    if FAIL_DELAY_SEC:
        await asyncio.sleep(FAIL_DELAY_SEC)
    raise HTTPException(status_code=401, detail="unauthorized")


if __name__ == "__main__":
    import getpass

    print(hash_password(getpass.getpass("Password: ")))
