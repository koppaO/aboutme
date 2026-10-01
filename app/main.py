import asyncio
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app import auth, db, schemas

NO_STORE = {"Cache-Control": "no-store"}
MAX_JSON_BYTES = 256 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_site_state()
    yield
    db.close_pool()


app = FastAPI(
    title="aboutme",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


def _json(payload: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers=NO_STORE)


async def _read_limited(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared:
        try:
            size = int(declared)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid json") from exc
        if size > MAX_JSON_BYTES:
            raise HTTPException(status_code=413, detail="payload too large")
    raw = await request.body()
    if len(raw) > MAX_JSON_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")
    return raw


async def _json_body(request: Request) -> Any:
    await _read_limited(request)
    try:
        return await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid json") from exc


def _parse_or_422(parse, raw: Any) -> Any:
    try:
        return parse(raw)
    except schemas.PayloadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _login_body(request: Request) -> tuple[str, str] | None:
    await _read_limited(request)
    try:
        body = await request.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    login = body.get("login")
    password = body.get("password")
    if not isinstance(login, str) or not login or len(login) > schemas.MAX_LOGIN:
        return None
    if not isinstance(password, str) or not password or len(password) > schemas.MAX_PASSWORD:
        return None
    return login, password


@app.get("/health")
def health() -> dict[str, str]:
    body = {"status": "ok"}
    try:
        status = db.database_status()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    if status is not None:
        body["database"] = status
    return body


@app.get("/theme")
def theme() -> JSONResponse:
    return _json(db.get_theme())


@app.get("/me")
def me() -> JSONResponse:
    return _json(db.get_about())


@app.get("/projects")
def projects() -> JSONResponse:
    return _json(db.get_projects())


@app.post("/login")
async def login(request: Request) -> JSONResponse:
    auth.require_origin(request)
    ip = auth.client_ip(request)
    await auth.login_allowed(ip)
    pair = await _login_body(request)
    user = None
    if pair is not None:
        user = await asyncio.to_thread(auth.authenticate, pair[0], pair[1])
    if user is None:
        await auth.reject_login(ip)
    token = auth.make_session(user["login"], user["password_hash"])
    if token is None:
        await auth.reject_login(ip)
    auth.clear_failures(ip)
    response = _json({"ok": True})
    auth.set_session_cookie(response, token, request)
    return response


@app.post("/logout")
def logout(request: Request) -> JSONResponse:
    auth.require_origin(request)
    response = _json({"ok": True})
    auth.clear_session_cookie(response, request)
    return response


@app.get("/session")
def session(request: Request) -> JSONResponse:
    user = auth.require_user(request)
    return _json({"ok": True, "login": user["login"]})


@app.put("/theme")
async def put_theme(request: Request) -> JSONResponse:
    auth.require_resource(request, "theme")
    payload = _parse_or_422(schemas.parse_theme, await _json_body(request))
    return _json(await asyncio.to_thread(db.put_theme, payload))


@app.put("/me")
async def put_me(request: Request) -> JSONResponse:
    auth.require_resource(request, "me")
    payload = _parse_or_422(schemas.parse_about, await _json_body(request))
    return _json(await asyncio.to_thread(db.put_about, payload))


@app.put("/projects")
async def put_projects(request: Request) -> JSONResponse:
    auth.require_resource(request, "projects")
    payload = _parse_or_422(schemas.parse_projects, await _json_body(request))
    return _json(await asyncio.to_thread(db.put_projects, payload))


@app.post("/users")
async def post_users(request: Request) -> JSONResponse:
    auth.require_resource(request, "users")
    payload = _parse_or_422(schemas.parse_new_user, await _json_body(request))
    encoded = await asyncio.to_thread(
        auth.hash_password,
        payload["password"],
        iterations=auth.HASH_ITERATIONS,
    )
    try:
        created = await asyncio.to_thread(
            db.create_user,
            payload["login"],
            encoded,
            payload["role"],
        )
    except db.UnknownRole as exc:
        raise HTTPException(status_code=422, detail="invalid user") from exc
    except db.DuplicateUser as exc:
        raise HTTPException(status_code=409, detail="user exists") from exc
    return _json(
        {
            "login": created["login"],
            "role": payload["role"],
            "status": bool(created["status"]),
        },
        status=201,
    )
