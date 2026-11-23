"""The director's timeline read (ADR-0007, T1): every layer's in and out in one call, read-only. Mock engine; the real engine is in test_timeline_real."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 12}})
    return s


def test_every_layer_is_listed_inside_the_composition_length(svc):
    a = svc.handle("add_text", {"text": "One"})["layer"]
    b = svc.handle("add_shape", {"kind": "rect", "name": "Box"})["layer"]
    tl = svc.handle("timeline_read", {})
    assert tl["duration"] == 12 and tl["frameRate"] == 30
    assert sorted(l["id"] for l in tl["layers"]) == sorted([a, b])
    for l in tl["layers"]:
        assert 0 <= l["in"] <= l["out"] <= 12
        assert {"name", "kind", "index", "nativeLocked", "approvedHere"} <= set(l)


def test_reading_changes_nothing(svc):
    svc.handle("add_text", {"text": "One"})
    before = svc.handle("inspect", {})
    for _ in range(3):
        svc.handle("timeline_read", {})
    assert svc.handle("inspect", {}) == before


def test_a_layer_cut_short_shows_its_own_in_and_out(svc):
    lid = svc.handle("add_text", {"text": "Short"})["layer"]
    svc.a._comp(svc.handle("inspect", {})["activeComp"])["layers"][0].update({"in": 2.0, "out": 5.5})
    (l,) = [x for x in svc.handle("timeline_read", {})["layers"] if x["id"] == lid]
    assert (l["in"], l["out"]) == (2.0, 5.5)


def test_odd_values_from_the_engine_are_clamped_not_trusted(svc):
    svc.handle("add_text", {"text": "Odd"})
    svc.a._comp(svc.handle("inspect", {})["activeComp"])["layers"][0].update({"in": -4.0, "out": 99.0})
    (l,) = svc.handle("timeline_read", {})["layers"]
    assert (l["in"], l["out"]) == (0.0, 12.0)


def test_it_needs_an_open_composition(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    with pytest.raises(Exception):
        s.handle("timeline_read", {})
