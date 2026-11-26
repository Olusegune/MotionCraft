"""Handing the composition to After Effects, Resolve and Premiere: what is asked, what is refused, where files go (mock adapter; the real files are in test_bridge_real.py)."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


@pytest.fixture()
def svc(tmp_path):
    s = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"name": "My Film", "width": 640, "height": 360, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Back"})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


def test_every_editor_has_a_file_in_its_own_new_folder_inside_the_project(svc):
    seen = set()
    for kind, ext in (("aep", ".aep"), ("fcpxml", ".fcpxml"), ("xml", ".xml"), ("otio", ".otio"), ("edl", ".edl")):
        r = svc.handle("export_bridge", {"kind": kind})
        assert r["ok"] and r["path"].startswith(f"exports/{kind}-") and r["path"].endswith(ext)
        assert (svc.pkg_path / r["path"]).exists() and r["files"]
        seen.add(r["target"])
    assert {"After Effects", "Premiere Pro"} <= seen and any("Resolve" in t for t in seen)


@pytest.mark.parametrize("kind", ["", "mov", "../x", "AEP", None, 3])
def test_only_the_known_editors_are_accepted(svc, kind):
    with pytest.raises(Exception, match="Choose one of"):
        svc.handle("export_bridge", {"kind": kind})


def test_the_file_name_is_made_from_a_safe_composition_name(svc):
    r = svc.handle("export_bridge", {"kind": "aep"})
    assert "/" not in r["path"].split("exports/", 1)[1].split("/", 1)[1] and ".." not in r["path"]
