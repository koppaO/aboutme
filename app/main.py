from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app import auth, db, schemas

NO_STORE = {"Cache-Control": "no-store"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_site_state()
    yield


app = FastAPI(
    title="aboutme",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


def _json(payload: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers=NO_STORE)


async def _json_body(request: Request) -> Any:
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
    if pair is None or not auth.credentials_ok(pair[0], pair[1]):
        await auth.reject_login(ip)
    token = auth.make_session(pair[0])
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


@app.get("/authz")
def authz(request: Request) -> JSONResponse:
    auth.require_session_resource(request, "apps")
    return _json({"ok": True})


@app.put("/theme")
async def put_theme(request: Request) -> JSONResponse:
    auth.require_resource(request, "theme")
    payload = _parse_or_422(schemas.parse_theme, await _json_body(request))
    return _json(db.put_theme(payload))


@app.put("/me")
async def put_me(request: Request) -> JSONResponse:
    auth.require_resource(request, "me")
    payload = _parse_or_422(schemas.parse_about, await _json_body(request))
    return _json(db.put_about(payload))


@app.put("/projects")
async def put_projects(request: Request) -> JSONResponse:
    auth.require_resource(request, "projects")
    payload = _parse_or_422(schemas.parse_projects, await _json_body(request))
    return _json(db.put_projects(payload))


@app.post("/users")
async def post_users(request: Request) -> JSONResponse:
    auth.require_resource(request, "users")
    payload = _parse_or_422(schemas.parse_new_user, await _json_body(request))
    encoded = auth.hash_password(payload["password"], iterations=auth.HASH_ITERATIONS)
    try:
        created = db.create_user(payload["login"], encoded, payload["role"])
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
