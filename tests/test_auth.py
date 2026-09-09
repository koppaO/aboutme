import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.content import seed_theme
from app.main import app

ORIGIN = {"Origin": "https://koppa0.dev"}
LOGIN = "admin"
PASSWORD = "test-admin-pass"
PASSWORD_HASH = auth.hash_password(
    PASSWORD,
    salt=bytes.fromhex("ab" * 16),
    iterations=2,
)

client = TestClient(app, base_url="https://koppa0.dev")


@pytest.fixture(autouse=True)
def isolate(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_LOGIN", LOGIN)
    monkeypatch.setenv("ADMIN_PASSWORD_HASH", PASSWORD_HASH)
    monkeypatch.setenv("SESSION_SECRET", "s" * 32)
    monkeypatch.setattr(auth, "FAIL_DELAY_SEC", 0)
    monkeypatch.setattr(auth, "HASH_ITERATIONS", 2)
    auth.reset_rate_limits()
    client.cookies.clear()
    db.reload_seed()
    yield
    client.cookies.clear()
    auth.reset_rate_limits()
    db.reload_seed()


def _login(password: str = PASSWORD, login: str = LOGIN):
    return client.post(
        "/login",
        json={"login": login, "password": password},
        headers=ORIGIN,
    )


def test_unknown_path_404() -> None:
    assert client.get("/no-such-route").status_code == 404


def test_login_wrong_password_401() -> None:
    response = _login("not-the-password")
    assert response.status_code == 401
    assert "not-the-password" not in response.text
    assert PASSWORD not in response.text


def test_put_without_cookie_401() -> None:
    client.cookies.clear()
    theme = seed_theme()
    assert client.put("/theme", json=theme, headers=ORIGIN).status_code == 401
    assert client.put("/me", json={"name": "x"}, headers=ORIGIN).status_code == 401
    assert client.put("/projects", json={"projects": []}, headers=ORIGIN).status_code == 401


def test_login_wrong_origin_403() -> None:
    response = client.post(
        "/login",
        json={"login": LOGIN, "password": PASSWORD},
        headers={"Origin": "https://example.com"},
    )
    assert response.status_code == 403


def test_login_sets_httponly_cookie() -> None:
    response = _login()
    assert response.status_code == 200
    cookie = response.headers.get("set-cookie", "").lower()
    assert "session=" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=strict" in cookie
    assert PASSWORD not in response.text
    assert PASSWORD_HASH not in response.text


def test_put_theme_invalid_color_422() -> None:
    assert _login().status_code == 200
    body = seed_theme()
    body["colors"]["--gold"] = "red"
    response = client.put("/theme", json=body, headers=ORIGIN)
    assert response.status_code == 422
    assert client.get("/theme").json()["colors"]["--gold"] == seed_theme()["colors"]["--gold"]


def test_put_me_invalid_url_422() -> None:
    assert _login().status_code == 200
    response = client.put(
        "/me",
        json={
            "name": "koppaO",
            "headline": "",
            "about": "",
            "socials": [{"name": "x", "url": "javascript:alert(1)"}],
        },
        headers=ORIGIN,
    )
    assert response.status_code == 422


def test_put_theme_roundtrip() -> None:
    assert _login().status_code == 200
    body = seed_theme()
    body["colors"]["--gold"] = "#abc"
    body["grain"]["opacity"] = 0.5
    saved = client.put("/theme", json=body, headers=ORIGIN)
    assert saved.status_code == 200
    assert saved.json()["colors"]["--gold"] == "#abc"
    assert client.get("/theme").json()["grain"]["opacity"] == 0.5


def test_login_rate_limited_429(monkeypatch) -> None:
    monkeypatch.setattr(auth, "MAX_FAILURES", 3)
    for _ in range(3):
        assert _login("nope").status_code == 401
    assert _login("nope").status_code == 429
    assert _login(PASSWORD).status_code == 429


def test_hash_does_not_contain_password() -> None:
    encoded = auth.hash_password("secret", salt=b"x" * 16, iterations=2)
    assert "secret" not in encoded
    assert encoded.startswith("pbkdf2_sha256$")
    assert auth.verify_password("secret", encoded)
    assert not auth.verify_password("other", encoded)


def test_plaintext_password_env_is_ignored(monkeypatch) -> None:
    auth._dummy_hash.cache_clear()
    monkeypatch.setenv("ADMIN_PASSWORD", PASSWORD)
    monkeypatch.delenv("ADMIN_PASSWORD_HASH", raising=False)
    db.reload_seed()
    try:
        response = _login()
        assert response.status_code == 401
        assert not auth.credentials_ok(LOGIN, PASSWORD)
    finally:
        auth._dummy_hash.cache_clear()


def test_inactive_user_cannot_login() -> None:
    db.set_user_status(LOGIN, False)
    assert _login().status_code == 401


def test_deactivated_session_gets_403() -> None:
    assert _login().status_code == 200
    db.set_user_status(LOGIN, False)
    response = client.put("/theme", json=seed_theme(), headers=ORIGIN)
    assert response.status_code == 403


def test_role_without_resource_gets_403() -> None:
    db.create_role("editor")
    db.set_role_resources("editor", ["me"])
    db.create_user("editor", PASSWORD_HASH, "editor")
    assert _login(login="editor").status_code == 200
    assert client.put("/theme", json=seed_theme(), headers=ORIGIN).status_code == 403
    allowed = client.put(
        "/me",
        json={"name": "koppaO", "headline": "", "about": "", "socials": []},
        headers=ORIGIN,
    )
    assert allowed.status_code == 200


def test_post_users_creates_second_admin() -> None:
    assert _login().status_code == 200
    response = client.post(
        "/users",
        json={"login": "other", "password": "other-pass", "role": "admin"},
        headers=ORIGIN,
    )
    assert response.status_code == 201
    body = response.json()
    assert body == {"login": "other", "role": "admin", "status": True}
    assert "other-pass" not in response.text
    client.cookies.clear()
    assert _login(password="other-pass", login="other").status_code == 200


def test_post_users_forbidden_without_resource() -> None:
    db.create_role("editor")
    db.set_role_resources("editor", ["me"])
    db.create_user("editor", PASSWORD_HASH, "editor")
    assert _login(login="editor").status_code == 200
    response = client.post(
        "/users",
        json={"login": "third", "password": "x", "role": "admin"},
        headers=ORIGIN,
    )
    assert response.status_code == 403


def test_put_wrong_origin_403() -> None:
    assert _login().status_code == 200
    response = client.put(
        "/theme",
        json=seed_theme(),
        headers={"Origin": "https://example.com"},
    )
    assert response.status_code == 403


def test_logout_clears_session() -> None:
    assert _login().status_code == 200
    assert client.post("/logout", headers=ORIGIN).status_code == 200
    assert client.put("/theme", json=seed_theme(), headers=ORIGIN).status_code == 401


def test_get_public_without_login() -> None:
    client.cookies.clear()
    assert client.get("/theme").status_code == 200
    assert client.get("/me").status_code == 200
    assert client.get("/projects").status_code == 200


def test_put_me_roundtrip() -> None:
    assert _login().status_code == 200
    body = {
        "name": "koppaO",
        "headline": "x",
        "about": "y",
        "socials": [{"name": "GitHub", "url": "https://github.com/koppaO"}],
    }
    saved = client.put("/me", json=body, headers=ORIGIN)
    assert saved.status_code == 200
    assert saved.json()["headline"] == "x"
    assert client.get("/me").json()["about"] == "y"


def test_put_projects_roundtrip() -> None:
    assert _login().status_code == 200
    body = {
        "projects": [
            {
                "slug": "other",
                "title": "other",
                "description": "d",
                "stack": ["FastAPI"],
                "links": [{"name": "GitHub", "url": "https://github.com/example/x"}],
            }
        ]
    }
    saved = client.put("/projects", json=body, headers=ORIGIN)
    assert saved.status_code == 200
    assert saved.json()["projects"][0]["slug"] == "other"
    assert client.get("/projects").json()["projects"][0]["title"] == "other"


def test_put_invalid_json_400() -> None:
    assert _login().status_code == 200
    response = client.put(
        "/theme",
        content=b"not-json",
        headers={**ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 400


def test_post_users_without_cookie_401() -> None:
    client.cookies.clear()
    response = client.post(
        "/users",
        json={"login": "other", "password": "x", "role": "admin"},
        headers=ORIGIN,
    )
    assert response.status_code == 401


def test_post_users_duplicate_409() -> None:
    assert _login().status_code == 200
    payload = {"login": "other", "password": "other-pass", "role": "admin"}
    assert client.post("/users", json=payload, headers=ORIGIN).status_code == 201
    again = client.post("/users", json=payload, headers=ORIGIN)
    assert again.status_code == 409
    assert "other-pass" not in again.text


def test_post_users_unknown_role_422() -> None:
    assert _login().status_code == 200
    response = client.post(
        "/users",
        json={"login": "other", "password": "other-pass", "role": "ghost"},
        headers=ORIGIN,
    )
    assert response.status_code == 422


def test_login_unknown_user_same_401() -> None:
    response = _login(login="nobody")
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


def test_json_responses_are_not_cached() -> None:
    public = client.get("/theme")
    assert public.headers.get("cache-control") == "no-store"
    assert _login().status_code == 200
    saved = client.put("/theme", json=seed_theme(), headers=ORIGIN)
    assert saved.headers.get("cache-control") == "no-store"
