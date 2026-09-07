import json
from pathlib import Path
from typing import Any

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"


def load(name: str) -> Any:
    path = CONTENT_DIR / name
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)
