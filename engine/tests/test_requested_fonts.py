"""The fonts a brief names are checked against the installed fonts."""
from __future__ import annotations

from motioncraft_engine.qa.checks import Scene, requested_fonts


def scene(**kw):
    return Scene(width=1920, height=1080, fps=24, duration=10, layers=[], deliverable={}, **kw)


def test_nothing_named_is_a_pass_and_no_font_list_is_not_checked():
    assert requested_fonts(scene()).state == "passed"
    r = requested_fonts(scene(requested_fonts=["Inter"], installed_fonts=None))
    assert r.state == "not-checked" and "installed fonts" in r.reason


def test_an_installed_family_passes_even_with_a_weight_in_its_name():
    r = requested_fonts(scene(requested_fonts=["Space Grotesk", "Inter"], installed_fonts={"Space Grotesk Medium", "Inter", "Arial"}))
    assert r.state == "passed" and not r.findings


def test_a_missing_family_is_a_warning_that_names_it():
    r = requested_fonts(scene(requested_fonts=["Space Grotesk", "Inter"], installed_fonts={"Inter", "Arial"}))
    assert r.state == "findings" and [f["severity"] for f in r.findings] == ["warn"] and "Space Grotesk" in r.findings[0]["evidence"]["detail"]
