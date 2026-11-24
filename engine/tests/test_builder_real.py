"""The Builder's layer timing on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip is "not checked", never "passed"."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service
from .test_builder import TIMED

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
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 24, "duration": 10}})
    yield s
    s.handle("close", {})


def test_a_built_plan_puts_each_layer_on_screen_when_the_plan_says(svc):
    r = svc.handle("builder_execute", {"plan": TIMED})
    assert len(r["created"]) == 6 and not any("timing was not applied" in w for w in r["warnings"])
    spans = {l["name"]: l for l in svc.handle("timeline_read", {})["layers"]}
    assert (spans["First line"]["in"], spans["First line"]["out"]) == (0.0, 2.0)
    assert (spans["Title"]["in"], spans["Title"]["out"]) == (5.0, 10.0)
    assert (spans["Sphere 3"]["in"], spans["Sphere 3"]["out"]) == (3.5, 10.0)
    assert spans["Background"]["in"] == 0.0 and spans["Background"]["out"] == 10.0
