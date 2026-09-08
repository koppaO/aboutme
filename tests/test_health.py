from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_docs_are_disabled() -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


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


def test_health_skips_db_without_credentials(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
