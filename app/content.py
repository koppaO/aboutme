import copy
import json
from pathlib import Path
from typing import Any

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"

DEFAULT_THEME: dict[str, Any] = {
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


def load(name: str) -> Any:
    path = CONTENT_DIR / name
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def seed_theme() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_THEME)


def seed_about() -> Any:
    return load("about.json")


def seed_projects() -> Any:
    return load("projects.json")
