"""The Builder times the on-screen text from the script, not from a small model's guess (found by the Civilization I-VII stress test).
The plan below is what a local 8-billion-parameter model actually returned for that script: markdown marks in the words, short motion names,
the tag written into the label, a title with "/" and no times."""
from __future__ import annotations

from motioncraft_engine.agents import builder

SEGMENTS = [
    {"start": 0, "end": 8, "onScreen": "CIVILIZATION I–VII / What Would We Become?"},
    {"start": 8, "end": 18, "onScreen": "TYPE I · PLANETARY"},
    {"start": 43, "end": 53, "onScreen": "TYPE IV · UNIVERSAL"},
    {"start": 53, "end": 63, "onScreen": "TYPE V · MULTIVERSAL"},
    {"start": 83, "end": 90, "onScreen": ""},
]
BRIEF = "Use a small **SPECULATIVE** tag with Types IV–VII."

RAW = {"summary": "s", "layers": [
    {"kind": "solid", "name": "Background", "animations": [{"primitive": "fade-in", "start": 0, "duration": 1}]},
    {"kind": "text", "name": "Title_00:00", "text": "CIVILIZATION I–VII / *What Would We Become?*", "size": 150, "animations": [{"primitive": "fade-in", "start": 0, "duration": 1}]},
    {"kind": "text", "name": "Type_I", "text": "TYPE I · PLANETARY", "size": 110, "animations": [{"primitive": "slide-in", "start": 8, "duration": 1}]},
    {"kind": "text", "name": "Type_IV", "text": "TYPE IV · UNIVERSAL SPECULATIVE", "size": 110, "animations": []},
    {"kind": "shape", "name": "Gold_Light", "shape": "ellipse", "animations": [{"primitive": "motion-drift", "start": 0, "duration": 20}]},
]}


def plan():
    out = builder.validate(RAW, duration_sec=90, fps=24)
    builder.apply_script(out, SEGMENTS, BRIEF, 90, 24)
    return out


def by_name(out):
    return {l["name"]: l for l in out["plan"]["layers"]}


def test_short_motion_names_are_understood_not_dropped():
    out = builder.validate(RAW, duration_sec=90, fps=24)
    assert not [w for w in out["warnings"] if "unknown motion" in w]
    assert builder.resolve_primitive("fade-in").id == "entrance.fade-in"
    assert builder.resolve_primitive("motion-drift").id == "motion.drift"
    assert builder.resolve_primitive("entrance.rise").id == "entrance.rise"
    assert builder.resolve_primitive("teleport") is None and builder.resolve_primitive(None) is None


def test_markdown_marks_are_removed_and_a_slash_makes_a_second_line():
    L = by_name(plan())["Title_00:00"]
    assert L["text"] == "CIVILIZATION I–VII\nWhat Would We Become?"


def test_each_line_is_timed_to_its_script_row():
    b = by_name(plan())
    assert (b["Title_00:00"]["in"], b["Title_00:00"]["out"]) == (0.0, 8.0)
    assert (b["Type_I"]["in"], b["Type_I"]["out"]) == (8.0, 18.0)
    assert (b["Type_IV"]["in"], b["Type_IV"]["out"]) == (43.0, 53.0)


def test_a_tag_written_into_a_label_becomes_its_own_small_layer_under_it():
    out = plan()
    b = by_name(out)
    assert b["Type_IV"]["text"] == "TYPE IV · UNIVERSAL"
    tag = b["Type_IV_tag"]
    assert tag["text"] == "SPECULATIVE" and tag["size"] < b["Type_IV"]["size"] / 2 and tag["slot"] == "tag"
    assert (tag["in"], tag["out"]) == (43.0, 53.0)
    names = [l["name"] for l in out["plan"]["layers"]]
    assert names.index("Type_IV_tag") == names.index("Type_IV") + 1
    assert "Type_I_tag" not in b                                   # Type I is not speculative


def test_a_row_the_model_left_out_gets_a_layer_and_the_tag_the_brief_asks_for():
    b = by_name(plan())
    made = b["Text_00:53"]
    assert made["text"] == "TYPE V · MULTIVERSAL" and (made["in"], made["out"]) == (53.0, 63.0)
    assert "Text_00:53_tag" in b and b["Text_00:53_tag"]["text"] == "SPECULATIVE"      # Type V in the brief's list of types
    assert not [l for l in plan()["plan"]["layers"] if l["kind"] == "text" and l["text"] == ""]   # the row without text makes no layer


def test_lines_come_and_go_with_a_fade_and_sit_in_their_slots():
    b = by_name(plan())
    prims = [a["primitive"] for a in b["Type_I"]["animations"]]
    assert "exit.fade-out" in prims
    fade_out = next(a for a in b["Type_I"]["animations"] if a["primitive"] == "exit.fade-out")
    assert 17 < fade_out["params"]["start"] < 18                  # ends with the row
    assert b["Title_00:00"]["slot"] == "title" and b["Type_I"]["slot"] == "label"
    assert builder.text_params(b["Type_I"], 2560, 1080)["position"] == [1280, round(1080 * 0.86)]
    assert builder.text_params(b["Title_00:00"], 2560, 1080)["position"] == [1280, round(1080 * 0.46)]
    assert "position" not in builder.text_params({"text": "x", "size": 10, "name": "n"}, 100, 100)


def test_the_slot_and_timing_survive_the_second_check_before_building():
    again = builder.validate(plan()["plan"], duration_sec=90, fps=24)
    b = by_name(again)
    assert b["Type_I"]["slot"] == "label" and (b["Type_I"]["in"], b["Type_I"]["out"]) == (8.0, 18.0)
    assert b["Type_IV_tag"]["slot"] == "tag"


def test_nothing_changes_without_script_rows():
    out = builder.validate(RAW, duration_sec=90, fps=24)
    before = [dict(l) for l in out["plan"]["layers"]]
    builder.apply_script(out, [], BRIEF, 90, 24)
    builder.apply_script(out, [{"start": 5, "end": 2, "onScreen": "bad"}, "junk", {"start": 0, "end": 5}], BRIEF, 90, 24)
    assert out["plan"]["layers"] == before


def test_a_motions_start_survives_the_second_check_before_building():
    """Regression (found building Civilization I-VII): the second check read start and duration only from the model's raw shape, so every
    checked motion lost its start and ran from time zero with the default length."""
    first = builder.validate({"layers": [{"kind": "text", "name": "L", "text": "x", "start": 4, "end": 12, "animations": [
        {"primitive": "entrance.fade-in", "start": 4.0, "duration": 0.5}, {"primitive": "exit.fade-out", "start": 11.5, "duration": 0.5}]}]}, duration_sec=20, fps=24)
    again = builder.validate(first["plan"], duration_sec=20, fps=24)
    got = [(a["primitive"], a["params"]["start"], a["params"]["duration"]) for a in again["plan"]["layers"][0]["animations"]]
    assert got == [("entrance.fade-in", 4.0, 0.5), ("exit.fade-out", 11.5, 0.5)]
    assert again["plan"]["layers"][0]["animations"] == first["plan"]["layers"][0]["animations"]
