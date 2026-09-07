from fastapi.testclient import TestClient

from app.content import load
from app.main import app

client = TestClient(app)


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
