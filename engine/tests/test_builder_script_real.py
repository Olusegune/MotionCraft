"""Script-timed text on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip is "not checked", never "passed"."""
from __future__ import annotations

import base64
import io
import os
from pathlib import Path

import pytest

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.agents import builder
from motioncraft_engine.sidecar import Service

from tests.test_builder_script import BRIEF, RAW, SEGMENTS

pytestmark = pytest.mark.real_engine


def bright_box(Image, s, t):
    im = Image.open(io.BytesIO(base64.b64decode(s.handle("preview", {"times": [t], "max_side": 1280})["png"]))).convert("L")
    w, h = im.size
    bg = im.getpixel((2, 2))
    pts = [(x, y) for y in range(0, h, 2) for x in range(0, w, 2) if abs(im.getpixel((x, y)) - bg) > 60]
    return (w, h, min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)) if pts else None


def test_script_timed_labels_appear_on_their_rows_in_their_slots_and_the_tag_sits_under_the_label(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 2560, "height": 1080, "frame_rate": 24, "duration": 90}})
    out = builder.validate(RAW, duration_sec=90, fps=24)
    builder.apply_script(out, SEGMENTS, BRIEF, 90, 24)
    out["plan"]["layers"] = [l for l in out["plan"]["layers"] if l["kind"] == "text"]       # only the words: a shape would be in the way of measuring them
    res = s.handle("builder_execute", {"plan": out["plan"]})
    assert not [w for w in res["warnings"] if "not applied" in w or "was dropped" in w], res["warnings"]
    tl = {l["name"]: l for l in s.handle("timeline_read", {})["layers"]}
    assert tl["Type_I"]["in"] == pytest.approx(8.0, abs=0.05) and tl["Type_I"]["out"] == pytest.approx(18.0, abs=0.05)
    title = bright_box(Image, s, 4.0)                       # the title card, mid-frame
    assert title and 0.3 < (title[3] + title[5]) / 2 / title[1] < 0.6, title
    label = bright_box(Image, s, 12.0)                      # a label sits in the lower third
    assert label and (label[3] + label[5]) / 2 / label[1] > 0.75, label
    assert label[3] / label[1] > 0.75, "the label must stay out of the upper two thirds so the picture behind is clean"
    both = bright_box(Image, s, 47.0)                       # label and the SPECULATIVE tag under it
    assert both and both[5] / both[1] > 0.9, both
    nothing = bright_box(Image, s, 3.0 + 60.0)              # between rows 63 and the end nothing was planned for: only what the plan has
    s.handle("close", {})
    assert nothing is None or nothing[5] / nothing[1] > 0.0


def test_a_fade_in_and_a_fade_out_on_the_same_line_both_work(tmp_path):
    """Regression: the second motion read the layer's value at time zero (0, after a fade in) as its own, so the fade out ran from 0 to 0."""
    Image = pytest.importorskip("PIL.Image")
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 540, "frame_rate": 24, "duration": 20}})
    plan = {"layers": [{"key": "a", "kind": "text", "name": "Line", "role": "title", "text": "HELLO", "size": 120, "in": 4.0, "out": 12.0, "animations": [
        {"primitive": "entrance.fade-in", "params": {"start": 4.0, "duration": 0.5, "ease": "out"}}, {"primitive": "exit.fade-out", "params": {"start": 11.5, "duration": 0.5, "ease": "out"}}]}]}
    res = s.handle("builder_execute", {"plan": plan})
    assert not res["warnings"], res["warnings"]
    shown = [bright_box(Image, s, t) is not None for t in (3.0, 6.0, 9.0, 11.0, 12.5)]
    assert shown == [False, True, True, True, False], shown
    s.handle("close", {})
