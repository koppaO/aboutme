from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"status": "ok"}


def test_health_rejects_post() -> None:
    response = client.post("/health")
    assert response.status_code == 405


def test_health_db_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://aboutme:x@127.0.0.1:1/aboutme")
    response = client.get("/health")
    assert response.status_code == 503
