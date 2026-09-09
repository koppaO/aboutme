import pytest
from fastapi.testclient import TestClient

from app import db
from app.content import load, seed_theme
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_seed() -> None:
    db.reload_seed()
    yield
    db.reload_seed()


def test_me_returns_about_file() -> None:
    response = client.get("/me")
    assert response.status_code == 200
    assert response.json() == load("about.json")
    assert "name" in response.json()
    assert "socials" in response.json()


def test_projects_returns_projects_file() -> None:
    response = client.get("/projects")
    assert response.status_code == 200
    body = response.json()
    assert body == load("projects.json")
    assert len(body["projects"]) >= 1
    assert body["projects"][0]["slug"] == "aboutme"


def test_theme_returns_default() -> None:
    response = client.get("/theme")
    assert response.status_code == 200
    assert response.json() == seed_theme()
