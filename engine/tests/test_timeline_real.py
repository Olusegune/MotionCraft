"""The timeline read on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip here is "not checked", never "passed".

Checked by hand on 2026-11-23 against EffectCraft 0.24.1: 60 layers read in one call, in and out matching layer.tree for every one.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from motioncraft_engine.adapter import Command
from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine


@pytest.fixture
def svc(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 30, "duration": 20}})
    yield s
    s.handle("close", {})


def test_in_and_out_match_what_the_engine_reports_for_each_layer(svc):
    ids = [svc.handle("add_text", {"text": f"L{i}", "size": 60})["layer"] for i in range(6)]
    for k, lid in enumerate(ids[:3]):
        svc.a.execute([Command(id="layer.timing", params={"layers": [lid], "in": float(k), "out": float(k + 5)})], actor="user")
    tl = svc.handle("timeline_read", {})
    assert tl["duration"] == 20 and len(tl["layers"]) == 6
    for l in tl["layers"]:
        tree = svc.a._run(Command(id="layer.tree", params={"layer": l["id"]}))
        assert abs(tree["in"] - l["in"]) <= 0.002 and abs(tree["out"] - l["out"]) <= 0.002
