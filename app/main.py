from typing import Any

from fastapi import FastAPI, HTTPException

from app.content import load
from app.db import database_status

app = FastAPI(title="aboutme")


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
def me() -> dict[str, Any]:
    return load("about.json")


@app.get("/projects")
def projects() -> dict[str, Any]:
    return load("projects.json")
