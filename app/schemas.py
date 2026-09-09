import re
from typing import Any
from urllib.parse import urlparse

COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
COLOR_KEYS = ("--shade", "--text", "--muted", "--gold", "--fail")

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
MAX_PASSWORD = 256
LOGIN_RE = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


class PayloadError(ValueError):
    pass


def _clip(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        raise PayloadError("invalid text")
    return value.strip()[:limit]


def _number(value: Any, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PayloadError("invalid number")
    number = float(value)
    if number < lo or number > hi:
        raise PayloadError("invalid number")
    return number


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


def parse_theme(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadError("invalid theme")
    colors_raw = raw.get("colors")
    sun_raw = raw.get("sun")
    grain_raw = raw.get("grain")
    tree_raw = raw.get("tree")
    if not isinstance(colors_raw, dict):
        raise PayloadError("invalid theme")
    if not isinstance(sun_raw, dict):
        raise PayloadError("invalid theme")
    if not isinstance(grain_raw, dict):
        raise PayloadError("invalid theme")
    if not isinstance(tree_raw, dict):
        raise PayloadError("invalid theme")

    colors = {key: _color(colors_raw.get(key)) for key in COLOR_KEYS}
    return {
        "colors": colors,
        "sun": {
            "top": _number(sun_raw.get("top"), -200, 200),
            "right": _number(sun_raw.get("right"), -200, 200),
            "size": _number(sun_raw.get("size"), 1, 200),
        },
        "grain": {"opacity": _number(grain_raw.get("opacity"), 0, 1)},
        "tree": {"opacity": _number(tree_raw.get("opacity"), 0, 1)},
    }


def parse_about(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PayloadError("invalid about")
    name = _clip(raw.get("name"), MAX_NAME)
    if not name:
        raise PayloadError("invalid about")
    return {
        "name": name,
        "headline": _clip(raw.get("headline") or "", MAX_HEADLINE),
        "about": _clip(raw.get("about") or "", MAX_ABOUT),
        "socials": _named_links(raw.get("socials") or [], MAX_SOCIALS),
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
                "description": _clip(item.get("description") or "", MAX_DESCRIPTION),
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
    if not isinstance(password, str) or not password or len(password) > MAX_PASSWORD:
        raise PayloadError("invalid user")
    role = _clip(raw.get("role"), MAX_LOGIN)
    if not LOGIN_RE.fullmatch(role):
        raise PayloadError("invalid user")
    return {
        "login": parse_login(raw.get("login")),
        "password": password,
        "role": role,
    }
