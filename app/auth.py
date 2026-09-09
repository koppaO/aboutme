import asyncio
import functools
import hashlib
import hmac
import os
import time
from typing import Any, NoReturn

from fastapi import HTTPException, Request, Response

COOKIE_NAME = "session"
ALLOWED_ORIGIN = "https://koppa0.dev"
SESSION_TTL_SEC = 60 * 60 * 24
HASH_SCHEME = "pbkdf2_sha256"
HASH_ITERATIONS = 200_000
MIN_SECRET_LEN = 16
MAX_FAILURES = 5
LOCKOUT_SEC = 60
FAIL_DELAY_SEC = 0.4

_attempts: dict[str, dict[str, Any]] = {}


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


@functools.lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password("invalid", salt=b"\x00" * 16, iterations=HASH_ITERATIONS)


def credentials_ok(login: str, password: str) -> bool:
    from app import db

    user = db.get_user_by_login(login)
    if user is None:
        verify_password(password, _dummy_hash())
        return False
    if not verify_password(password, user["password_hash"]):
        return False
    return bool(user["status"])


def _secret() -> bytes | None:
    value = os.getenv("SESSION_SECRET") or ""
    if len(value) < MIN_SECRET_LEN:
        return None
    return value.encode("utf-8")


def make_session(login: str) -> str | None:
    secret = _secret()
    if secret is None:
        return None
    expires = int(time.time()) + SESSION_TTL_SEC
    payload = f"user.{login}.{expires}"
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def session_login(token: str) -> str | None:
    secret = _secret()
    if secret is None or not token:
        return None
    try:
        payload, sig = token.rsplit(".", 1)
    except ValueError:
        return None
    expected = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        kind, login, exp_s = payload.split(".")
        expires = int(exp_s)
    except ValueError:
        return None
    if kind != "user" or expires < int(time.time()):
        return None
    return login


def current_user(request: Request) -> dict[str, Any] | None:
    from app import db

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    login = session_login(token)
    if login is None:
        return None
    return db.get_user_by_login(login)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip() or "unknown"
    if request.client:
        return request.client.host
    return "unknown"


def reset_rate_limits() -> None:
    _attempts.clear()


def _locked_until(ip: str) -> float:
    row = _attempts.get(ip)
    if not row:
        return 0
    return float(row.get("locked_until") or 0)


def is_locked(ip: str) -> bool:
    return _locked_until(ip) > time.time()


def register_failure(ip: str) -> None:
    row = _attempts.setdefault(ip, {"count": 0, "locked_until": 0.0})
    row["count"] = int(row["count"]) + 1
    if row["count"] >= MAX_FAILURES:
        row["locked_until"] = time.time() + LOCKOUT_SEC


def clear_failures(ip: str) -> None:
    _attempts.pop(ip, None)


def require_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin != ALLOWED_ORIGIN:
        raise HTTPException(status_code=403, detail="forbidden")


def require_admin(request: Request) -> dict[str, Any]:
    require_origin(request)
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not user["status"]:
        raise HTTPException(status_code=403, detail="forbidden")
    return user


def require_resource(request: Request, key: str) -> dict[str, Any]:
    from app import db

    user = require_admin(request)
    if not db.role_has_resource(int(user["role_id"]), key):
        raise HTTPException(status_code=403, detail="forbidden")
    return user


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=SESSION_TTL_SEC,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )


async def login_allowed(ip: str) -> None:
    if is_locked(ip):
        raise HTTPException(status_code=429, detail="too many attempts")


async def reject_login(ip: str) -> NoReturn:
    register_failure(ip)
    if FAIL_DELAY_SEC:
        await asyncio.sleep(FAIL_DELAY_SEC)
    raise HTTPException(status_code=401, detail="unauthorized")


if __name__ == "__main__":
    import getpass

    print(hash_password(getpass.getpass("Password: ")))
