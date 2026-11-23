"""Text boxes for QA: calibrated against real EffectCraft renders, and fed by the size recorded when MotionCraft makes a text layer.

EffectCraft 0.24.1 does not report a text layer's font or size, so QA estimates the box. The numbers below were MEASURED on
2026-11-23 by rendering real text with the installed EffectCraft 0.24.1 (1920x1080 composition, default font, white on black)
and taking the bounding box of the lit pixels. They are the evidence for the two assumptions in `checks.box`:
text is centred horizontally on its position, and the first line's baseline is at the position's y.
"""
from __future__ import annotations

import json

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.qa import checks as C
from motioncraft_engine.sidecar import Service

# (text, size, position, ink left, ink top, ink right, ink bottom) measured on the real engine
REAL = [
    ("Launch day", 140, (960, 540), 589, 438, 1338, 568),
    ("Launch day", 70, (960, 540), 775, 489, 1148, 553),
    ("Hello", 140, (960, 540), 804, 438, 1121, 540),
    ("WWWWWWWWWW", 140, (960, 540), 259, 438, 1660, 539),
    ("iiiiiiiiii", 140, (960, 540), 799, 435, 1120, 539),
    ("Launch day", 140, (400, 300), 29, 198, 778, 328),
    ("Two\nlines here", 100, (960, 540), 739, 467, 1183, 660),
]


@pytest.mark.parametrize("text,size,pos,x0,y0,x1,y1", REAL)
def test_the_estimated_box_matches_what_the_real_engine_drew(text, size, pos, x0, y0, x1, y1):
    b = C.box(C.Layer(id=1, name="t", kind="Text", text=text, size=size, position=pos))
    ink_w = x1 - x0
    assert abs((b[0] + b[2]) / 2 - (x0 + x1) / 2) < 12, "centred horizontally on the position"
    assert 0.9 * ink_w <= b[2] - b[0] <= 1.15 * ink_w, f"width {b[2] - b[0]:.0f} against measured {ink_w}"
    assert abs(b[1] - y0) < 8, f"top {b[1]:.0f} against measured {y0}: the baseline is at the position's y"
    assert b[3] >= y1 - 2 and b[3] - y1 < 0.25 * size, f"bottom {b[3]:.0f} against measured {y1}"


def test_the_old_flat_estimate_would_have_been_far_off_for_wide_and_narrow_letters():
    # Documents why the width comes from per-letter proportions: 0.55 x size per character is wrong by 2x for these.
    wide = C.box(C.Layer(id=1, name="t", kind="Text", text="WWWWWWWWWW", size=140, position=(960, 540)))
    narrow = C.box(C.Layer(id=2, name="t", kind="Text", text="iiiiiiiiii", size=140, position=(960, 540)))
    assert (wide[2] - wide[0]) > 3 * (narrow[2] - narrow[0]) and (wide[2] - wide[0]) > 1200 and (narrow[2] - narrow[0]) < 400


# ---------------------------------------------------------------------------------------------------- the recorded size
@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    (pkg / "fonts").mkdir()
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"width": 1920, "height": 1080, "frame_rate": 30, "duration": 10}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


DELIV = {"aspect": "16:9", "width": 1920, "height": 1080, "fps": 30, "durationSec": 10, "alpha": False}


def results(svc, contrast=False):
    return {r["check"]: r for r in svc.handle("qa_run", {"facts": {"deliverable": DELIV}, "contrast": contrast})["results"]}


def test_text_the_app_makes_has_its_size_recorded_and_qa_can_use_it(svc):
    lid = svc.handle("add_text", {"text": "Far left edge text", "size": 120})["layer"]
    rec = json.loads((svc.pkg_path / "logs" / "text-layers.json").read_text())
    assert rec == {str(lid): {"size": 120}}
    svc.a.execute([__import__("motioncraft_engine.adapter", fromlist=["Command"]).Command(id="prop.set", params={"layer": lid, "path": "transform/position", "value": [40.0, 540.0, 0.0]})], actor="user")
    r = results(svc)["safe-title"]
    assert r["state"] == "findings" and r["findings"][0]["at"]["layerId"] == lid and r["findings"][0]["evidence"]["estimated"] is True


def test_builder_text_is_recorded_too(svc):
    out = svc.handle("builder_execute", {"plan": {"layers": [{"kind": "text", "name": "Title", "text": "Hi", "size": 90, "animations": []}]}})
    lid = out["created"][0]["layer"]
    assert json.loads((svc.pkg_path / "logs" / "text-layers.json").read_text())[str(lid)] == {"size": 90}


def test_text_the_app_did_not_make_has_no_size_and_qa_says_so(svc):
    from motioncraft_engine.adapter import Command
    r = svc.a.execute([Command(id="layer.newText", params={"text": "Made elsewhere", "size": 100})], actor="user")
    assert r.results[0].result["layer"]
    res = results(svc, contrast=True)        # contrast on, so frames exist and the missing size is the only thing in the way
    for check in ("safe-title", "contrast"):
        assert res[check]["state"] == "not-checked" and "size of the text is not known" in res[check]["reason"], check


def test_a_damaged_record_is_ignored_not_fatal(svc):
    svc.handle("add_text", {"text": "x", "size": 100})
    (svc.pkg_path / "logs" / "text-layers.json").write_text("{ not json")
    assert results(svc)["safe-title"]["state"] == "not-checked"
    svc.handle("add_text", {"text": "y", "size": 100})            # recording again repairs it
    assert json.loads((svc.pkg_path / "logs" / "text-layers.json").read_text())
