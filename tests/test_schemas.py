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


def _about_with_skills(skills):
    return schemas.parse_about({"name": "n", "skills": skills})


def test_skills_accepted_in_order() -> None:
    skills = [
        {"name": " Python ", "kind": "language", "extra": 1},
        {"name": "FastAPI", "kind": "framework"},
        {"name": "Postgres", "kind": "database"},
        {"name": "Docker", "kind": "infra"},
        {"name": "git", "kind": "tool"},
    ]
    assert _about_with_skills(skills)["skills"] == [
        {"name": "Python", "kind": "language"},
        {"name": "FastAPI", "kind": "framework"},
        {"name": "Postgres", "kind": "database"},
        {"name": "Docker", "kind": "infra"},
        {"name": "git", "kind": "tool"},
    ]


def test_skills_missing_or_null_is_empty() -> None:
    assert schemas.parse_about({"name": "n"})["skills"] == []
    assert _about_with_skills(None)["skills"] == []


def test_skill_name_clipped_to_limit() -> None:
    parsed = _about_with_skills([{"name": "x" * 80, "kind": "tool"}])
    assert parsed["skills"][0]["name"] == "x" * schemas.MAX_SKILL


@pytest.mark.parametrize(
    "skills",
    [
        [{"name": "Python", "kind": "language"}, {"name": "python", "kind": "tool"}],
        [{"name": "Docker", "kind": "infra"}, {"name": " DOCKER ", "kind": "infra"}],
    ],
)
def test_skills_reject_case_insensitive_duplicates(skills) -> None:
    with pytest.raises(schemas.PayloadError):
        _about_with_skills(skills)


@pytest.mark.parametrize(
    "skill",
    [
        {"name": "Python", "kind": "lang"},
        {"name": "Python", "kind": "Language"},
        {"name": "Python"},
        {"name": "Python", "kind": 1},
        {"name": "", "kind": "tool"},
        {"name": "   ", "kind": "tool"},
        {"kind": "tool"},
        {"name": 5, "kind": "tool"},
        "Python",
    ],
)
def test_skills_reject_bad_items(skill) -> None:
    with pytest.raises(schemas.PayloadError):
        _about_with_skills([skill])


def test_skills_limit() -> None:
    skills = [{"name": f"s{i}", "kind": "tool"} for i in range(schemas.MAX_SKILLS)]
    assert len(_about_with_skills(skills)["skills"]) == schemas.MAX_SKILLS
    with pytest.raises(schemas.PayloadError):
        _about_with_skills(skills + [{"name": "one-more", "kind": "tool"}])
    with pytest.raises(schemas.PayloadError):
        _about_with_skills({"name": "Python", "kind": "language"})
