"""comp.settings on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip is "not checked", never "passed"."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine


def test_an_empty_composition_takes_new_size_rate_and_length_but_not_once_it_has_layers(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 30, "duration": 15}})
    c = s.a.inspect().comp(None)
    assert (c.width, c.height, c.duration) == (1280, 720, 15.0)
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 3840, "height": 2160, "frame_rate": 24, "duration": 10}})
    c = s.a.inspect().comp(None)
    assert (c.width, c.height, c.frame_rate, c.duration) == (3840, 2160, 24.0, 10.0)
    s.handle("add_text", {"text": "Hello"})
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 640, "height": 360, "frame_rate": 30, "duration": 5}})
    c = s.a.inspect().comp(None)
    assert (c.width, c.height, c.duration) == (3840, 2160, 10.0)
    s.handle("close", {})
