"""Saved versions on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip here is "not checked", never "passed".

Checked by hand on 2026-11-23 against EffectCraft 0.24.1: save 24 ms, diff / preview / restore about 0.2 s each, and an untouched
composition hashes identically in a second engine process (so "unchanged" is trustworthy).
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

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
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 30, "duration": 6}})
    yield s
    s.handle("close", {})


def names(svc):
    return sorted(l["name"] for l in svc.handle("inspect", {})["layers"])


def test_an_untouched_composition_is_unchanged_in_a_second_process_and_edits_show_up(svc):
    a = svc.handle("add_text", {"text": "First", "size": 100})["layer"]
    svc.handle("add_shape", {"kind": "ellipse", "name": "Dot"})
    v = svc.handle("snapshot_save", {})["id"]
    d = svc.handle("snapshot_diff", {"id": v})
    assert d["items"] == [] and d["unchanged"] == 2
    svc.handle("set_text", {"layer": a, "text": "Changed"})
    svc.handle("add_text", {"text": "Second", "size": 80})
    d = svc.handle("snapshot_diff", {"id": v})
    assert sorted((i["name"], i["state"]) for i in d["items"]) == [("Changed", "changed"), ("Second", "added")]


def test_preview_restore_and_undo(svc):
    a = svc.handle("add_text", {"text": "First", "size": 100})["layer"]
    v = svc.handle("snapshot_save", {})["id"]
    svc.handle("set_text", {"layer": a, "text": "Changed"})
    old = svc.handle("snapshot_preview", {"id": v, "time": 1.0, "max_side": 480})
    cur = svc.handle("snapshot_preview", {"id": "current", "time": 1.0, "max_side": 480})
    assert old["png"] != cur["png"] and old["width"] == 480
    r = svc.handle("snapshot_restore", {"id": v})
    assert svc.a.layer_props(None, a)["props"]["text/sourceText"]["value"] == "First"
    svc.handle("snapshot_restore", {"id": r["before"]})
    assert svc.a.layer_props(None, a)["props"]["text/sourceText"]["value"] == "Changed"
    assert svc.handle("add_text", {"text": "after", "size": 60})["layer"]


def test_a_builder_run_is_undone_and_redone_by_its_versions(svc):
    svc.handle("add_text", {"text": "Mine", "size": 90})
    plan = {"layers": [{"kind": "solid", "name": "Background", "color": [0.1, 0.1, 0.2]},
                       {"kind": "text", "name": "Title", "text": "Launch", "size": 120, "animations": [{"primitive": "text.rise-per-char", "start": 0.2, "duration": 1.0}]}]}
    out = svc.handle("builder_execute", {"plan": plan})
    v = out["versions"]
    assert v["before"] and v["after"] and out["warnings"] == []
    svc.handle("snapshot_restore", {"id": v["before"]})
    assert names(svc) == ["Mine"]
    svc.handle("snapshot_restore", {"id": v["after"]})
    assert names(svc) == ["Background", "Mine", "Title"]
