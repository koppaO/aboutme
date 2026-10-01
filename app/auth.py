import asyncio
import functools
import hashlib
import hmac
import os
import time
from typing import Any, NoReturn
from urllib.parse import urlparse

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
MAX_TRACKED_IPS = 4096
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})
_PLACEHOLDER_SECRETS = frozenset(
    {
        "replace-with-long-random-string",
        "changeme",
        "change-me",
    }
)

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


def authenticate(login: str, password: str) -> dict[str, Any] | None:
    from app import db

    user = db.get_user_by_login(login)
    if user is None:
        verify_password(password, _dummy_hash())
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    if not user["status"]:
        return None
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


def make_session(login: str, password_hash: str) -> str | None:
    secret = _secret()
    tag = _password_tag(password_hash)
    if secret is None or tag is None:
        return None
    expires = int(time.time()) + SESSION_TTL_SEC
    payload = f"user.{login}.{expires}.{tag}"
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def session_claims(token: str) -> tuple[str, str] | None:
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
        kind, login, exp_s, tag = payload.split(".")
        expires = int(exp_s)
    except ValueError:
        return None
    if kind != "user" or not login or expires < int(time.time()):
        return None
    if len(tag) != 16:
        return None
    return login, tag


def current_user(request: Request) -> dict[str, Any] | None:
    from app import db

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    claims = session_claims(token)
    if claims is None:
        return None
    login, tag = claims
    user = db.get_user_by_login(login)
    if user is None:
        return None
    expected = _password_tag(user["password_hash"])
    if expected is None or not hmac.compare_digest(tag, expected):
        return None
    return user


def client_ip(request: Request) -> str:
    if os.getenv("TRUST_PROXY") == "1":
        real = (request.headers.get("x-real-ip") or "").strip()
        if real and len(real) <= 64 and "\n" not in real and "\r" not in real and "," not in real:
            return real
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def reset_rate_limits() -> None:
    _attempts.clear()


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
