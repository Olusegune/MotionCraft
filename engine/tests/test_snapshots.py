"""Saved versions (P4-05): save, compare, preview, restore and undo. Mock engine; the real engine is covered by test_real_snapshots (marker real_engine)."""
from __future__ import annotations

import base64

import pytest

from motioncraft_engine import snapshots as S
from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.snapshots import SnapshotError
from motioncraft_engine.sidecar import Service


@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 10}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


def names(svc):
    return sorted(l["name"] for l in svc.handle("inspect", {})["layers"])


def test_save_keeps_a_copy_under_revisions_and_validates_ids(svc):
    svc.handle("add_text", {"text": "One"})
    v = svc.handle("snapshot_save", {})
    assert S.SAFE_ID.match(v["id"]) and v["bytes"] > 0
    assert (svc.pkg_path / "revisions" / f"{v['id']}.ecproj").is_file()
    assert svc.handle("snapshot_save", {})["id"] != v["id"]
    for bad in ("../comp", "a", "x/y", "", "..\\x", "nope-but-valid-looking", "a" * 100, None, 5):
        with pytest.raises(SnapshotError):
            svc.handle("snapshot_diff", {"id": bad})


def test_diff_names_what_was_added_changed_and_removed(svc):
    keep = svc.handle("add_text", {"text": "Keep"})["layer"]
    edit = svc.handle("add_text", {"text": "Edit me"})["layer"]
    gone = svc.handle("add_shape", {"kind": "rect", "name": "Soon gone"})["layer"]
    v = svc.handle("snapshot_save", {})["id"]
    assert svc.handle("snapshot_diff", {"id": v})["items"] == [] and svc.handle("snapshot_diff", {"id": v})["unchanged"] == 3
    svc.handle("set_text", {"layer": edit, "text": "Edited"})
    new = svc.handle("add_solid", {"name": "Fresh"})["layer"]
    svc.a.execute([__import__("motioncraft_engine.adapter", fromlist=["Command"]).Command(id="edit.clear", params={"layers": [gone]})], actor="user")
    d = svc.handle("snapshot_diff", {"id": v})
    got = {(i["id"], i["state"]) for i in d["items"]}
    assert (edit, "changed") in got and (new, "added") in got and (gone, "removed") in got and not any(i == keep for i, _ in got)
    assert d["unchanged"] == 1 and d["then"]["layers"] == 3 and d["now"]["layers"] == 3


def test_preview_of_an_old_version_does_not_touch_the_live_composition(svc):
    svc.handle("add_text", {"text": "A"})
    v = svc.handle("snapshot_save", {})["id"]
    svc.handle("add_text", {"text": "B"})
    before = svc.a.hash_layers(None)
    old = svc.handle("snapshot_preview", {"id": v, "time": 1.0})
    cur = svc.handle("snapshot_preview", {"id": "current", "time": 1.0})
    assert old["png"] != cur["png"] and old["width"] > 0 and base64.b64decode(old["png"])[:4] == b"\x89PNG"
    assert svc.a.hash_layers(None) == before and names(svc) == ["A", "B"]
    assert svc.handle("snapshot_preview", {"id": v, "time": 999})["time"] < 10, "time is clamped into the composition"


def test_restore_puts_the_old_version_back_and_can_itself_be_undone(svc):
    svc.handle("add_text", {"text": "First"})
    v1 = svc.handle("snapshot_save", {})["id"]
    svc.handle("add_text", {"text": "Second"})
    assert names(svc) == ["First", "Second"]
    r = svc.handle("snapshot_restore", {"id": v1})
    assert names(svc) == ["First"] and r["restored"] == v1 and [l["name"] for l in r["layers"]] == ["First"]
    undo = svc.handle("snapshot_restore", {"id": r["before"]})          # the state just before the restore
    assert names(svc) == ["First", "Second"] and undo["restored"] == r["before"]
    assert svc.handle("add_text", {"text": "Still editable"})["layer"], "the engine is live again after a restore"


def test_restore_clears_engine_side_locks_for_the_page_to_reapply(svc):
    lid = svc.handle("add_text", {"text": "Approved"})["layer"]
    v = svc.handle("snapshot_save", {})["id"]
    svc.handle("lock", {"layers": [lid]})
    assert svc.a.is_locked(None, lid)
    svc.handle("snapshot_restore", {"id": v})
    assert not svc.a.is_locked(None, lid)
    svc.handle("lock", {"layers": [lid]})                              # the page re-applies an approval that still matches
    assert svc.a.is_locked(None, lid)


def test_restore_refuses_a_bad_version_before_touching_anything(svc):
    svc.handle("add_text", {"text": "Safe"})
    n = len(list((svc.pkg_path / "revisions").glob("*"))) if (svc.pkg_path / "revisions").exists() else 0
    for bad in ("../../comp", "missing-version-id", ""):
        with pytest.raises(SnapshotError):
            svc.handle("snapshot_restore", {"id": bad})
    assert names(svc) == ["Safe"]
    assert (len(list((svc.pkg_path / "revisions").glob("*"))) if (svc.pkg_path / "revisions").exists() else 0) == n, "no 'before' version was made for a refused restore"


def test_builder_and_qa_fix_keep_a_before_and_after_so_they_can_be_undone(svc):
    base = svc.handle("add_text", {"text": "Mine"})["layer"]
    out = svc.handle("builder_execute", {"plan": {"layers": [{"kind": "solid", "name": "Back"}, {"kind": "text", "name": "Title", "text": "Hi", "size": 100, "animations": []}]}})
    v = out["versions"]
    assert v["before"] and v["after"] and v["before"] != v["after"] and "Title" in names(svc)
    svc.handle("snapshot_restore", {"id": v["before"]})
    assert names(svc) == ["Mine"], "restoring the 'before' version undoes the whole Builder run"
    svc.handle("snapshot_restore", {"id": v["after"]})
    assert names(svc) == ["Back", "Mine", "Title"]
    from motioncraft_engine.adapter import Command
    svc.a.execute([Command(id="prop.set", params={"layer": base, "path": "text/fontSize", "value": 120}), Command(id="prop.set", params={"layer": base, "path": "transform/position", "value": [40.0, 300.0, 0.0]})], actor="user")
    svc._record_text(base, 120)
    facts = {"deliverable": {"aspect": "16:9", "width": 640, "height": 360, "fps": 30, "durationSec": 10, "alpha": False}}
    fx = svc.handle("qa_fix", {"check": "safe-title", "layer": base, "facts": facts})
    assert fx["versions"]["before"] and fx["versions"]["after"]
    svc.handle("snapshot_restore", {"id": fx["versions"]["before"]})
    assert svc.a.layer_props(None, base)["props"]["transform/position"]["value"][0] == 40.0, "the fix is undone"


def test_a_full_revisions_folder_refuses_instead_of_deleting(svc, monkeypatch):
    monkeypatch.setattr(S, "MAX_SNAPSHOTS", 2)
    svc.handle("add_text", {"text": "x"})
    a, b = svc.handle("snapshot_save", {})["id"], svc.handle("snapshot_save", {})["id"]
    with pytest.raises(SnapshotError, match="Nothing is deleted"):
        svc.handle("snapshot_save", {})
    assert (svc.pkg_path / "revisions" / f"{a}.ecproj").is_file() and (svc.pkg_path / "revisions" / f"{b}.ecproj").is_file()


def test_a_failed_automatic_version_does_not_stop_the_change_but_says_so(svc, monkeypatch):
    monkeypatch.setattr(S, "MAX_SNAPSHOTS", 0)
    out = svc.handle("builder_execute", {"plan": {"layers": [{"kind": "solid", "name": "Back"}]}})
    assert out["versions"] == {"before": None, "after": None} and any("could not be saved" in w for w in out["warnings"])
    assert "Back" in names(svc)
