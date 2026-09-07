from typing import Any

from fastapi import FastAPI

from app.content import load

app = FastAPI(title="aboutme")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/me")
def me() -> dict[str, Any]:
    return load("about.json")


@app.get("/projects")
def projects() -> dict[str, Any]:
    return load("projects.json")
