"""T3 on the REAL engine (-m real_engine, EFFECTCRAFT_CLI set). A skip is "not checked", never "passed".
Numbers checked by hand on EffectCraft 0.24.1 on 2026-11-23: spike/t3_layer_timing.py, results in spike/results/t3_layer_timing.txt."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from motioncraft_engine.adapter import Command
from motioncraft_engine.adapter.errors import AdapterError
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


def keys(svc, lid):
    return [k.get("time") for k in svc.a._run(Command(id="prop.get", params={"layer": lid, "path": "transform.opacity"})).get("keys", [])]


def test_trim_move_clamp_refuse_and_keyframes_stay_put(svc):
    lid = svc.handle("add_text", {"text": "A", "size": 60})["layer"]
    svc.a._run(Command(id="prop.addKey", params={"layer": lid, "path": "transform.opacity", "time": 2.0, "value": 0}))
    svc.a._run(Command(id="prop.addKey", params={"layer": lid, "path": "transform.opacity", "time": 4.0, "value": 100}))
    r = svc.handle("layer_timing", {"layer": lid, "t_in": 1.0, "t_out": 8.0})
    assert (r["in"], r["out"]) == (1.0, 8.0)
    r = svc.handle("layer_timing", {"layer": lid, "delta": 2.0})
    assert (r["in"], r["out"]) == (3.0, 10.0)
    assert keys(svc, lid) == [2.0, 4.0]                                   # keyframes do not travel with a layer
    assert svc.handle("layer_timing", {"layer": lid, "t_out": 99.0})["out"] == 20.0     # EffectCraft would have accepted 99
    assert svc.handle("layer_timing", {"layer": lid, "delta": -99.0})["in"] == 0.0
    assert r["versions"]["before"] and r["versions"]["after"]
    svc.handle("lock", {"layers": [lid]})
    with pytest.raises(AdapterError, match="Unlock"):
        svc.handle("layer_timing", {"layer": lid, "t_in": 5.0})
