import pytest

from app import schemas
from app.content import seed_theme


def test_localized_from_string() -> None:
    assert schemas._localized("  привет ", 10) == {"ru": "привет", "en": ""}


def test_localized_from_object_drops_extra_keys() -> None:
    assert schemas._localized({"ru": "a", "en": "b", "de": "c"}, 10) == {"ru": "a", "en": "b"}


def test_localized_missing_parts_are_empty() -> None:
    assert schemas._localized(None, 10) == {"ru": "", "en": ""}
    assert schemas._localized({"en": "only"}, 10) == {"ru": "", "en": "only"}


def test_localized_limit_applies_per_language() -> None:
    assert schemas._localized({"ru": "я" * 30, "en": "e" * 30}, 5) == {"ru": "яяяяя", "en": "eeeee"}


@pytest.mark.parametrize("value", [1, ["ru"], {"ru": 1}, {"ru": "a", "en": ["b"]}, True])
def test_localized_rejects_non_text(value) -> None:
    with pytest.raises(schemas.PayloadError):
        schemas._localized(value, 10)


def test_localized_required_needs_ru() -> None:
    with pytest.raises(schemas.PayloadError):
        schemas._localized({"ru": " ", "en": "x"}, 10, required=True)
    assert schemas._localized("x", 10, required=True) == {"ru": "x", "en": ""}


def test_about_timeline_limits() -> None:
    event = {"start": "2023", "title": "t", "kind": "work"}
    with pytest.raises(schemas.PayloadError):
        schemas.parse_about({"name": "n", "timeline": [event] * (schemas.MAX_TIMELINE + 1)})
    parsed = schemas.parse_about({"name": "n", "timeline": [{**event, "extra": 1, "start": "9" * 50}]})
    assert parsed["timeline"] == [
        {
            "start": "9" * schemas.MAX_DATE,
            "end": None,
            "title": {"ru": "t", "en": ""},
            "place": {"ru": "", "en": ""},
            "kind": "work",
        }
    ]


@pytest.mark.parametrize("bad", [{"start": "", "title": "t", "kind": "work"}, {"title": "t", "kind": "work"}, "x"])
def test_about_timeline_rejects_bad_items(bad) -> None:
    with pytest.raises(schemas.PayloadError):
        schemas.parse_about({"name": "n", "timeline": [bad]})


def test_about_now_playing_requires_title_and_src() -> None:
    with pytest.raises(schemas.PayloadError):
        schemas.parse_about({"name": "n", "now_playing": {"src": "/media/a.mp3"}})
    with pytest.raises(schemas.PayloadError):
        schemas.parse_about({"name": "n", "now_playing": {"title": "t"}})
    with pytest.raises(schemas.PayloadError):
        schemas.parse_about({"name": "n", "now_playing": "/media/a.mp3"})
    parsed = schemas.parse_about({"name": "n", "now_playing": {"title": "t", "src": "/media/a-1_b.mp3"}})
    assert parsed["now_playing"] == {"title": "t", "artist": "", "src": "/media/a-1_b.mp3", "cover": None}


def test_theme_requires_all_color_keys() -> None:
    body = seed_theme()
    del body["light"]["colors"]["--panel"]
    with pytest.raises(schemas.PayloadError):
        schemas.parse_theme(body)


def test_theme_drops_unknown_keys() -> None:
    body = seed_theme()
    body["dark"]["colors"]["--evil"] = "url(javascript:x)"
    body["grain"] = {"opacity": 1}
    assert schemas.parse_theme(body) == seed_theme()
    assert not schemas.is_current_theme(body)
