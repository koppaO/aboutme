import hashlib
import hmac
import time

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
    assert "domain=" not in cookie
    assert PASSWORD not in response.text
    assert PASSWORD_HASH not in response.text


def test_put_theme_invalid_color_422() -> None:
    assert _login().status_code == 200
    body = seed_theme()
    body["dark"]["colors"]["--signal"] = "red"
    response = client.put("/theme", json=body, headers=ORIGIN)
    assert response.status_code == 422
    assert client.get("/theme").json() == seed_theme()


def test_put_theme_needs_both_modes_422() -> None:
    assert _login().status_code == 200
    body = seed_theme()
    del body["dark"]
    assert client.put("/theme", json=body, headers=ORIGIN).status_code == 422


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
    body["light"]["colors"]["--signal"] = "#ABC"
    body["sun"] = {"top": 1, "right": 1, "size": 1}
    saved = client.put("/theme", json=body, headers=ORIGIN)
    assert saved.status_code == 200
    assert saved.json()["light"]["colors"]["--signal"] == "#abc"
    assert "sun" not in saved.json()
    assert client.get("/theme").json() == saved.json()


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
    assert saved.json()["headline"] == {"ru": "x", "en": ""}
    assert saved.json()["timeline"] == []
    assert saved.json()["now_playing"] is None
    assert client.get("/me").json() == saved.json()


def _me_with(**fields):
    body = {"name": "koppaO", "headline": "", "about": "", "socials": []}
    body.update(fields)
    return client.put("/me", json=body, headers=ORIGIN)


def _track(**fields):
    track = {"title": "Song", "artist": "Band", "src": "/media/song.mp3", "cover": None}
    track.update(fields)
    return track


def _event(**fields):
    event = {"start": "2023", "end": None, "title": "Uni", "place": "", "kind": "study"}
    event.update(fields)
    return event


def test_put_me_localized_and_timeline_roundtrip() -> None:
    assert _login().status_code == 200
    saved = _me_with(
        headline={"ru": "Привет", "en": "Hi", "de": "Hallo"},
        timeline=[_event(), _event(start="2025-09", end="2026", kind="project")],
        now_playing=_track(src="/media/a.mp3", cover="/media/c.webp"),
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["headline"] == {"ru": "Привет", "en": "Hi"}
    assert body["timeline"][0]["title"] == {"ru": "Uni", "en": ""}
    assert body["timeline"][0]["end"] is None
    assert [e["kind"] for e in body["timeline"]] == ["study", "project"]
    assert body["now_playing"]["src"] == "/media/a.mp3"
    assert client.get("/me").json() == body


def test_put_me_skills_roundtrip() -> None:
    assert _login().status_code == 200
    skills = [{"name": "Python", "kind": "language"}, {"name": "nginx", "kind": "infra"}]
    saved = _me_with(skills=skills)
    assert saved.status_code == 200
    assert saved.json()["skills"] == skills
    assert client.get("/me").json()["skills"] == skills


@pytest.mark.parametrize(
    "skills",
    [
        [{"name": "Python", "kind": "language"}, {"name": "PYTHON", "kind": "language"}],
        [{"name": "Python", "kind": "snake"}],
        [{"name": f"s{i}", "kind": "tool"} for i in range(41)],
    ],
)
def test_put_me_bad_skills_422(skills) -> None:
    assert _login().status_code == 200
    before = client.get("/me").json()
    assert _me_with(skills=skills).status_code == 422
    assert client.get("/me").json() == before


def test_put_me_now_playing_null_ok() -> None:
    assert _login().status_code == 200
    saved = _me_with(now_playing=None)
    assert saved.status_code == 200
    assert saved.json()["now_playing"] is None


@pytest.mark.parametrize("kind", ["school", "", None, 1, "Study"])
def test_put_me_bad_timeline_kind_422(kind) -> None:
    assert _login().status_code == 200
    assert _me_with(timeline=[_event(kind=kind)]).status_code == 422


def test_put_me_timeline_title_required_422() -> None:
    assert _login().status_code == 200
    assert _me_with(timeline=[_event(title={"ru": "", "en": "x"})]).status_code == 422


@pytest.mark.parametrize(
    "src",
    [
        "/media/../secret.mp3",
        "/media/..",
        "/media/a/b.mp3",
        "/etc/passwd",
        "javascript:alert(1)",
        "http://example.com/a.mp3",
        "https://cdn.example.com/a.mp3",
        "HTTPS://cdn.example.com/media/a.mp3",
        "https://example.com/../a.mp3",
        "https://user:pw@example.com/a.mp3",
        "https://",
        "data:audio/mp3;base64,AAAA",
        "//example.com/a.mp3",
        "https://example.com/" + "a" * 500,
        "",
        None,
    ],
)
def test_put_me_bad_media_src_422(src) -> None:
    assert _login().status_code == 200
    assert _me_with(now_playing=_track(src=src)).status_code == 422
    assert _me_with(now_playing=_track(cover=src or "javascript:x")).status_code == 422


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
    assert saved.json()["projects"][0]["description"] == {"ru": "d", "en": ""}
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


def test_session_without_cookie_401() -> None:
    client.cookies.clear()
    assert client.get("/session").status_code == 401
    assert client.get("/authz").status_code == 404


def test_session_ok_without_origin() -> None:
    assert _login().status_code == 200
    session = client.get("/session")
    assert session.status_code == 200
    assert session.json() == {
        "ok": True,
        "login": LOGIN,
        "resources": ["theme", "me", "projects", "users"],
    }
    assert "password" not in session.text


def test_session_lists_only_role_resources() -> None:
    db.create_role("editor")
    db.set_role_resources("editor", ["users", "me"])
    db.create_user("editor", PASSWORD_HASH, "editor")
    assert _login(login="editor").status_code == 200
    body = client.get("/session").json()
    assert body["login"] == "editor"
    assert body["resources"] == ["me", "users"]


def test_session_role_without_resources() -> None:
    db.create_role("viewer")
    db.create_user("viewer", PASSWORD_HASH, "viewer")
    assert _login(login="viewer").status_code == 200
    assert client.get("/session").json()["resources"] == []


def test_inactive_session_gets_403() -> None:
    assert _login().status_code == 200
    db.set_user_status(LOGIN, False)
    assert client.get("/session").status_code == 403


def test_spoofed_forwarded_for_does_not_bypass_lockout(monkeypatch) -> None:
    monkeypatch.setattr(auth, "MAX_FAILURES", 2)
    assert _login("nope").status_code == 401
    assert _login("nope").status_code == 401
    response = client.post(
        "/login",
        json={"login": LOGIN, "password": PASSWORD},
        headers={
            **ORIGIN,
            "X-Forwarded-For": "203.0.113.9",
            "X-Real-IP": "203.0.113.8",
        },
    )
    assert response.status_code == 429


def test_placeholder_session_secret_cannot_login(monkeypatch) -> None:
    monkeypatch.setenv("SESSION_SECRET", "replace-with-long-random-string")
    response = _login()
    assert response.status_code == 401
    assert "session=" not in response.headers.get("set-cookie", "").lower()


def test_session_rejected_when_password_changes() -> None:
    assert _login().status_code == 200
    user = db.get_user_by_login(LOGIN)
    assert user is not None
    db.set_password_hash(user["id"], auth.hash_password("new-password", iterations=2))
    assert client.get("/session").status_code == 401


def test_old_signed_cookie_format_is_rejected() -> None:
    expires = int(time.time()) + 3600
    payload = f"user.{LOGIN}.{expires}.{'0' * 16}"
    sig = hmac.new(b"s" * 32, payload.encode(), hashlib.sha256).hexdigest()
    client.cookies.set("session", f"{payload}.{sig}", domain="koppa0.dev")
    assert client.get("/session").status_code == 401


def _cookie() -> str:
    value = client.cookies.get("session")
    assert value
    return value


def test_token_is_random_and_only_its_hash_is_stored() -> None:
    assert _login().status_code == 200
    token = _cookie()
    assert LOGIN not in token
    assert len(token) >= 43
    stored = db._memory["sessions"]
    assert token not in stored
    assert hashlib.sha256(token.encode()).hexdigest() in stored


def test_logout_revokes_the_cookie() -> None:
    assert _login().status_code == 200
    token = _cookie()
    assert client.post("/logout", headers=ORIGIN).status_code == 200
    client.cookies.set("session", token, domain="koppa0.dev")
    assert client.get("/session").status_code == 401
    assert client.put("/theme", json=seed_theme(), headers=ORIGIN).status_code == 401
    assert db._memory["sessions"] == {}


def test_two_sessions_are_independent() -> None:
    other = TestClient(app, base_url="https://koppa0.dev")
    assert _login().status_code == 200
    second = other.post("/login", json={"login": LOGIN, "password": PASSWORD}, headers=ORIGIN)
    assert second.status_code == 200
    assert other.cookies.get("session") != _cookie()
    assert other.post("/logout", headers=ORIGIN).status_code == 200
    assert other.get("/session").status_code == 401
    assert client.get("/session").status_code == 200


def test_expired_session_401(monkeypatch) -> None:
    assert _login().status_code == 200
    later = time.time() + auth.SESSION_TTL_SEC + 1
    monkeypatch.setattr(auth, "_now", lambda: later)
    assert client.get("/session").status_code == 401


def test_login_purges_expired_sessions(monkeypatch) -> None:
    assert _login().status_code == 200
    assert len(db._memory["sessions"]) == 1
    later = time.time() + auth.SESSION_TTL_SEC + 1
    monkeypatch.setattr(auth, "_now", lambda: later)
    client.cookies.clear()
    assert _login().status_code == 200
    assert len(db._memory["sessions"]) == 1
    assert client.get("/session").status_code == 200


def _login_from(ip: str, login: str = LOGIN, password: str = PASSWORD):
    return client.post(
        "/login",
        json={"login": login, "password": password},
        headers={**ORIGIN, "X-Real-IP": ip},
    )


def test_login_lockout_spans_ips(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY", "1")
    for i in range(auth.LOGIN_MAX_FAILURES):
        assert _login_from(f"198.51.100.{i}", password="wrong").status_code == 401
    assert _login_from("198.51.100.200").status_code == 429
    assert _login_from("198.51.100.201", login=" ADMIN ").status_code == 429
    assert "session" not in client.cookies


def test_locked_login_skips_password_check(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY", "1")
    for i in range(auth.LOGIN_MAX_FAILURES):
        _login_from(f"198.51.100.{i}", password="wrong")
    calls = []
    monkeypatch.setattr(auth, "verify_password", lambda *args: calls.append(args) or True)
    assert _login_from("198.51.100.99").status_code == 429
    assert calls == []


def test_unknown_login_locks_the_same_way(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY", "1")
    known, unknown = [], []
    for i in range(auth.LOGIN_MAX_FAILURES + 1):
        known.append(_login_from(f"198.51.100.{i}", password="wrong"))
        unknown.append(_login_from(f"203.0.113.{i}", login="ghost", password="wrong"))
    assert [r.status_code for r in known] == [r.status_code for r in unknown]
    assert known[-1].status_code == 429
    assert known[-1].json() == unknown[-1].json()
    assert known[0].json() == unknown[0].json()


def test_success_resets_login_counter(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY", "1")
    for i in range(auth.LOGIN_MAX_FAILURES - 1):
        assert _login_from(f"198.51.100.{i}", password="wrong").status_code == 401
    assert _login_from("198.51.100.50").status_code == 200
    for i in range(auth.LOGIN_MAX_FAILURES - 1):
        assert _login_from(f"192.0.2.{i}", password="wrong").status_code == 401
    assert _login_from("192.0.2.50").status_code == 200


def test_login_lock_expires(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY", "1")
    for i in range(auth.LOGIN_MAX_FAILURES):
        _login_from(f"198.51.100.{i}", password="wrong")
    assert _login_from("198.51.100.77").status_code == 429
    later = time.time() + auth.LOGIN_LOCKOUT_SEC + 1
    monkeypatch.setattr(auth, "_now", lambda: later)
    assert _login_from("198.51.100.78").status_code == 200


def test_tracked_logins_are_bounded(monkeypatch) -> None:
    monkeypatch.setattr(auth, "MAX_TRACKED_LOGINS", 5)
    for i in range(20):
        auth.register_login_failure(f"user{i}")
    assert len(auth._login_attempts) <= 5


def test_login_upgrades_weak_hash(monkeypatch) -> None:
    monkeypatch.setattr(auth, "HASH_ITERATIONS", 600_000)
    weak = auth.hash_password("weak-user-pass", iterations=200_000)
    db.create_user("legacy", weak, "admin")
    old_session = auth.make_session(db.get_user_by_login("legacy"))
    assert old_session is not None

    response = client.post(
        "/login",
        json={"login": "legacy", "password": "weak-user-pass"},
        headers=ORIGIN,
    )
    assert response.status_code == 200
    stored = db.get_user_by_login("legacy")["password_hash"]
    assert auth.hash_iterations(stored) == 600_000
    assert auth.verify_password("weak-user-pass", stored)
    assert client.get("/session").json()["login"] == "legacy"

    stale = TestClient(app, base_url="https://koppa0.dev")
    stale.cookies.set("session", old_session, domain="koppa0.dev")
    assert stale.get("/session").status_code == 401


def test_strong_hash_is_not_rewritten() -> None:
    before = db.get_user_by_login(LOGIN)["password_hash"]
    assert _login().status_code == 200
    assert db.get_user_by_login(LOGIN)["password_hash"] == before


def test_put_rejects_oversized_body() -> None:
    assert _login().status_code == 200
    response = client.put(
        "/theme",
        content=b"{" + b"a" * (300 * 1024),
        headers={**ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_post_users_short_password_422() -> None:
    assert _login().status_code == 200
    response = client.post(
        "/users",
        json={"login": "other", "password": "short", "role": "admin"},
        headers=ORIGIN,
    )
    assert response.status_code == 422
