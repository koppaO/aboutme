import json

import pytest
from fastapi.testclient import TestClient

from app import db, schemas
from app.content import load, seed_theme
from app.main import app

client = TestClient(app)

LEGACY_THEME = {
    "colors": {
        "--shade": "#0c100b",
        "--text": "#f3ead4",
        "--muted": "#cbbfa2",
        "--gold": "#e4c36a",
        "--fail": "#e8b4a8",
    },
    "sun": {"top": -8, "right": 8, "size": 42},
    "grain": {"opacity": 0.18},
    "tree": {"opacity": 0.92},
}


@pytest.fixture(autouse=True)
def reset_seed() -> None:
    db.reload_seed()
    yield
    db.reload_seed()


def _store_raw(column: str, value) -> None:
    db._memory[column] = value
    db._cache.clear()


def test_me_returns_about_file() -> None:
    response = client.get("/me")
    assert response.status_code == 200
    body = response.json()
    assert body == schemas.parse_about(load("about.json"))
    assert body["headline"]["ru"]
    assert body["headline"]["en"]
    assert body["now_playing"] is None
    assert {event["kind"] for event in body["timeline"]} <= schemas.TIMELINE_KINDS


def test_seed_files_are_already_in_api_shape() -> None:
    assert schemas.parse_about(load("about.json")) == load("about.json")
    assert schemas.parse_projects(load("projects.json")) == load("projects.json")


def test_projects_returns_projects_file() -> None:
    response = client.get("/projects")
    assert response.status_code == 200
    body = response.json()
    assert body == schemas.parse_projects(load("projects.json"))
    assert body["projects"][0]["slug"] == "aboutme"
    assert set(body["projects"][0]["description"]) == {"ru", "en"}


def test_theme_returns_default() -> None:
    response = client.get("/theme")
    assert response.status_code == 200
    body = response.json()
    assert body == seed_theme()
    assert set(body) == {"light", "dark"}
    for mode in body.values():
        assert tuple(mode["colors"]) == schemas.COLOR_KEYS


def test_legacy_about_is_read_in_new_shape() -> None:
    _store_raw(
        "about",
        {
            "name": "koppaO",
            "headline": "Студент",
            "about": "Текст",
            "socials": [{"name": "GitHub", "url": "https://github.com/koppaO"}],
        },
    )
    body = client.get("/me").json()
    assert body["headline"] == {"ru": "Студент", "en": ""}
    assert body["about"] == {"ru": "Текст", "en": ""}
    assert body["timeline"] == []
    assert body["now_playing"] is None
    assert body["socials"][0]["name"] == "GitHub"


def test_legacy_projects_are_read_in_new_shape() -> None:
    _store_raw(
        "projects",
        {"projects": [{"slug": "x", "title": "x", "description": "старое", "stack": [], "links": []}]},
    )
    body = client.get("/projects").json()
    assert body["projects"][0]["description"] == {"ru": "старое", "en": ""}


def test_broken_stored_about_falls_back_to_seed() -> None:
    _store_raw("about", {"headline": 42})
    response = client.get("/me")
    assert response.status_code == 200
    assert response.json() == schemas.parse_about(load("about.json"))


def test_legacy_theme_is_served_as_default() -> None:
    _store_raw("theme", LEGACY_THEME)
    assert client.get("/theme").json() == seed_theme()


class _FakeConn:
    def __init__(self, theme) -> None:
        self.theme = theme
        self.updates: list[tuple] = []

    def execute(self, sql: str, params: tuple = ()):
        if sql.lstrip().startswith("UPDATE"):
            self.updates.append(params)
            self.theme = json.loads(params[0])
            return self
        self._row = (self.theme,)
        return self

    def fetchone(self):
        return self._row


@pytest.mark.parametrize(
    "stored",
    [
        LEGACY_THEME,
        {**seed_theme(), "sun": {"top": 0, "right": 0, "size": 1}},
        {"light": seed_theme()["light"]},
        "not a theme",
    ],
)
def test_startup_replaces_legacy_theme(stored) -> None:
    conn = _FakeConn(stored)
    db._upgrade_legacy_theme(conn)
    assert len(conn.updates) == 1
    assert conn.updates[0][1] == db.SITE_ROW_ID
    assert conn.theme == seed_theme()


def test_startup_keeps_current_theme() -> None:
    custom = seed_theme()
    custom["dark"]["colors"]["--signal"] = "#ff00ff"
    conn = _FakeConn(custom)
    db._upgrade_legacy_theme(conn)
    assert conn.updates == []
    assert conn.theme == custom
