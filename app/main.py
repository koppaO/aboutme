from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.content import load
from app.db import database_status

app = FastAPI(title="aboutme")

NO_STORE = {"Cache-Control": "no-store"}


@app.get("/health")
def health() -> dict[str, str]:
    body = {"status": "ok"}
    try:
        db = database_status()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    if db is not None:
        body["database"] = db
    return body


@app.get("/me")
def me() -> JSONResponse:
    return JSONResponse(load("about.json"), headers=NO_STORE)


@app.get("/projects")
def projects() -> JSONResponse:
    return JSONResponse(load("projects.json"), headers=NO_STORE)
