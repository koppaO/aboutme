import copy
import json
from pathlib import Path
from typing import Any

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"

DEFAULT_THEME: dict[str, Any] = {
    "light": {
        "colors": {
            "--bg": "#ffffff",
            "--ink": "#000000",
            "--muted": "#5c5c5c",
            "--line": "#000000",
            "--panel": "#f5f5f5",
            "--signal": "#000000",
        }
    },
    "dark": {
        "colors": {
            "--bg": "#0f1633",
            "--ink": "#dfe6ff",
            "--muted": "#8f9bd0",
            "--line": "#2a3566",
            "--panel": "#0a1028",
            "--signal": "#7cf0c8",
        }
    },
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
