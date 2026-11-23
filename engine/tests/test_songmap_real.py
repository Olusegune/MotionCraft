"""Section, lyric and beat markers on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip here is "not checked".

EffectCraft cannot report markers back (comp.info has none), so the check reads them out of the saved composition file: that is where
they live. Checked by hand on 2026-11-23 against EffectCraft 0.24.1 with Pulseframe's 191 s sample: 170 markers written, 170 found.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from motioncraft_engine import songmap
from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine
FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def svc(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "R.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 30, "duration": 200}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    yield s
    s.handle("close", {})


def counts(svc) -> dict[str, int]:
    b = (svc.pkg_path / "comp.ecproj").read_bytes()
    return {k: b.count(f"motioncraft:{k}".encode()) for k in ("section:", "lyric:", "beat")}


def test_a_whole_songs_markers_land_in_the_composition_and_replace_replaces(svc):
    m = songmap.from_pulseframe(json.loads((FIX / "pulseframe_exit_plan.songmap.json").read_text()))
    items = songmap.markers_for(beats=m["downbeats"], sections=m["sections"], lyrics=m["lyrics"])
    r = svc.handle("sync_labelled_markers", {"items": items, "replace": True})
    assert r["kinds"] == {"beat": 96, "section": 10, "lyric": 64}
    assert counts(svc) == {"section:": 10, "lyric:": 64, "beat": 96}
    svc.handle("sync_labelled_markers", {"items": items[:3], "replace": True})
    assert sum(counts(svc).values()) == 3, "replace leaves exactly the new markers"
