import re
from typing import Any
from urllib.parse import urlparse

COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
COLOR_KEYS = ("--bg", "--ink", "--muted", "--line", "--panel", "--signal")
THEME_MODES = ("light", "dark")
LEGACY_THEME_KEYS = ("sun", "grain", "tree")

MAX_NAME = 100
MAX_HEADLINE = 200
MAX_ABOUT = 5000
MAX_LABEL = 80
MAX_URL = 500
MAX_TITLE = 200
MAX_DESCRIPTION = 2000
MAX_STACK_ITEM = 50
MAX_SLUG = 80
MAX_SOCIALS = 20
MAX_PROJECTS = 50
MAX_STACK = 20
MAX_LINKS = 10
MAX_LOGIN = 32
MIN_PASSWORD = 8
MAX_PASSWORD = 256
MAX_TIMELINE = 30
MAX_DATE = 20
MAX_TRACK = 200
LOGIN_RE = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")
MEDIA_RE = re.compile(r"^/media/[A-Za-z0-9._-]+$")
TIMELINE_KINDS = frozenset({"study", "work", "project"})
LANGS = ("ru", "en")


class PayloadError(ValueError):
    pass


def _clip(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        raise PayloadError("invalid text")
    return value.strip()[:limit]


def _localized(value: Any, limit: int, required: bool = False) -> dict[str, str]:
    if value is None:
        value = ""
    if isinstance(value, str):
        text = {"ru": _clip(value, limit), "en": ""}
    elif isinstance(value, dict):
        text = {}
        for lang in LANGS:
            part = value.get(lang)
            text[lang] = _clip("" if part is None else part, limit)
    else:
        raise PayloadError("invalid text")
    if required and not text["ru"]:
        raise PayloadError("invalid text")
    return text


def _color(value: Any) -> str:
    if not isinstance(value, str) or not COLOR_RE.fullmatch(value):
        raise PayloadError("invalid color")
    return value.lower()


def _url(value: Any) -> str:
    url = _clip(value, MAX_URL)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PayloadError("invalid url")
    if url.split(":", 1)[0].lower() not in ("http", "https"):
        raise PayloadError("invalid url")
    return url


def _named_links(value: Any, limit: int) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) > limit:
        raise PayloadError("invalid links")
    links: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            raise PayloadError("invalid links")
        name = _clip(item.get("name"), MAX_LABEL)
        if not name:
            raise PayloadError("invalid links")
        links.append({"name": name, "url": _url(item.get("url"))})
    return links


def _media(value: Any) -> str:
    if not isinstance(value, str):
        raise PayloadError("invalid media")
    src = value.strip()
    if not src or len(src) > MAX_URL or ".." in src:
        raise PayloadError("invalid media")
    if not MEDIA_RE.fullmatch(src) or not src.rsplit("/", 1)[1].strip("."):
        raise PayloadError("invalid media")
    return src


def _theme_colors(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict) or not isinstance(raw.get("colors"), dict):
        raise PayloadError("invalid theme")
    colors_raw = raw["colors"]
    return {key: _color(colors_raw.get(key)) for key in COLOR_KEYS}


def parse_theme(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadError("invalid theme")
    return {mode: {"colors": _theme_colors(raw.get(mode))} for mode in THEME_MODES}


def is_current_theme(raw: Any) -> bool:
    if not isinstance(raw, dict) or any(key in raw for key in LEGACY_THEME_KEYS):
        return False
    try:
        parse_theme(raw)
    except PayloadError:
        return False
    return True


def _timeline(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_TIMELINE:
        raise PayloadError("invalid timeline")
    events: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise PayloadError("invalid timeline")
        start = _clip(item.get("start"), MAX_DATE)
        if not start:
            raise PayloadError("invalid timeline")
        end_raw = item.get("end")
        end = None if end_raw is None else _clip(end_raw, MAX_DATE) or None
        kind = item.get("kind")
        if not isinstance(kind, str) or kind not in TIMELINE_KINDS:
            raise PayloadError("invalid timeline")
        events.append(
            {
                "start": start,
                "end": end,
                "title": _localized(item.get("title"), MAX_TITLE, required=True),
                "place": _localized(item.get("place"), MAX_TITLE),
                "kind": kind,
            }
        )
    return events


def _now_playing(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise PayloadError("invalid now_playing")
    title = _clip(value.get("title"), MAX_TRACK)
    if not title:
        raise PayloadError("invalid now_playing")
    artist = value.get("artist")
    cover = value.get("cover")
    return {
        "title": title,
        "artist": _clip("" if artist is None else artist, MAX_TRACK),
        "src": _media(value.get("src")),
        "cover": None if cover is None or cover == "" else _media(cover),
    }


def parse_about(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadError("invalid about")
    name = _clip(raw.get("name"), MAX_NAME)
    if not name:
        raise PayloadError("invalid about")
    return {
        "name": name,
        "headline": _localized(raw.get("headline"), MAX_HEADLINE),
        "about": _localized(raw.get("about"), MAX_ABOUT),
        "socials": _named_links(raw.get("socials") or [], MAX_SOCIALS),
        "timeline": _timeline(raw.get("timeline")),
        "now_playing": _now_playing(raw.get("now_playing")),
    }


def parse_projects(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadError("invalid projects")
    items = raw.get("projects")
    if not isinstance(items, list) or len(items) > MAX_PROJECTS:
        raise PayloadError("invalid projects")
    projects: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise PayloadError("invalid projects")
        title = _clip(item.get("title") or item.get("slug") or "", MAX_TITLE)
        if not title:
            raise PayloadError("invalid projects")
        slug = _clip(item.get("slug") or title, MAX_SLUG)
        stack_raw = item.get("stack") or []
        if not isinstance(stack_raw, list) or len(stack_raw) > MAX_STACK:
            raise PayloadError("invalid projects")
        stack = [_clip(part, MAX_STACK_ITEM) for part in stack_raw]
        if any(not part for part in stack):
            raise PayloadError("invalid projects")
        projects.append(
            {
                "slug": slug,
                "title": title,
                "description": _localized(item.get("description"), MAX_DESCRIPTION),
                "stack": stack,
                "links": _named_links(item.get("links") or [], MAX_LINKS),
            }
        )
    return {"projects": projects}


def parse_login(value: Any) -> str:
    login = _clip(value, MAX_LOGIN)
    if not LOGIN_RE.fullmatch(login):
        raise PayloadError("invalid login")
    return login


def parse_new_user(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise PayloadError("invalid user")
    password = raw.get("password")
    if (
        not isinstance(password, str)
        or len(password) < MIN_PASSWORD
        or len(password) > MAX_PASSWORD
    ):
        raise PayloadError("invalid user")
    role = _clip(raw.get("role"), MAX_LOGIN)
    if not LOGIN_RE.fullmatch(role):
        raise PayloadError("invalid user")
    return {
        "login": parse_login(raw.get("login")),
        "password": password,
        "role": role,
    }
