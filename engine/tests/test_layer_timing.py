"""T3: move and trim one unlocked layer (mock engine). Real-engine numbers are in test_layer_timing_real."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.adapter.errors import AdapterError
from motioncraft_engine.sidecar import Service


@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 20}})
    return s


def span(svc, lid):
    return next(l for l in svc.handle("timeline_read", {})["layers"] if l["id"] == lid)


def test_trim_changes_in_and_out_only(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    r = svc.handle("layer_timing", {"layer": lid, "t_in": 2.0, "t_out": 9.0})
    assert (r["in"], r["out"]) == (2.0, 9.0)
    assert span(svc, lid)["start"] == 0.0                      # trimming leaves the source start alone


def test_move_slides_in_out_and_source_start(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    svc.handle("layer_timing", {"layer": lid, "t_in": 1.0, "t_out": 8.0})
    r = svc.handle("layer_timing", {"layer": lid, "delta": 2.0})
    assert (r["in"], r["out"]) == (3.0, 10.0) and span(svc, lid)["start"] == 2.0


def test_values_are_clamped_into_the_composition(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    svc.handle("layer_timing", {"layer": lid, "t_in": 1.0, "t_out": 8.0})
    assert svc.handle("layer_timing", {"layer": lid, "t_out": 99.0})["out"] == 20.0
    assert svc.handle("layer_timing", {"layer": lid, "t_in": -5.0})["in"] == 0.0
    r = svc.handle("layer_timing", {"layer": lid, "t_in": 50.0})            # past the out point: held one frame short of it
    assert r["in"] == pytest.approx(20.0 - 1 / 30, abs=0.002)


def test_a_move_cannot_push_the_layer_outside_the_composition(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    svc.handle("layer_timing", {"layer": lid, "t_in": 1.0, "t_out": 8.0})
    r = svc.handle("layer_timing", {"layer": lid, "delta": 100.0})
    assert (r["in"], r["out"]) == (13.0, 20.0)
    r = svc.handle("layer_timing", {"layer": lid, "delta": -100.0})
    assert (r["in"], r["out"]) == (0.0, 7.0)


def test_an_approved_layer_is_refused_and_nothing_changes(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    svc.handle("layer_timing", {"layer": lid, "t_in": 1.0, "t_out": 8.0})
    svc.handle("lock", {"layers": [lid]})
    with pytest.raises(AdapterError, match="Unlock"):
        svc.handle("layer_timing", {"layer": lid, "t_in": 3.0})
    assert (span(svc, lid)["in"], span(svc, lid)["out"]) == (1.0, 8.0)


def test_bad_input_is_refused(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    for bad in ({"t_in": "x"}, {"t_in": float("nan")}, {"delta": 1, "t_in": 1}, {}, {"t_in": True}):
        with pytest.raises(AdapterError):
            svc.handle("layer_timing", {"layer": lid, **bad})
    with pytest.raises(AdapterError):
        svc.handle("layer_timing", {"layer": 9999, "t_in": 1.0})


def test_one_saved_version_before_and_after_so_it_can_be_undone(svc):
    lid = svc.handle("add_text", {"text": "A"})["layer"]
    svc.handle("layer_timing", {"layer": lid, "t_in": 1.0, "t_out": 8.0})
    r = svc.handle("layer_timing", {"layer": lid, "t_in": 4.0})
    assert r["versions"]["before"] and r["versions"]["after"] and r["versions"]["before"] != r["versions"]["after"]
    svc.handle("snapshot_restore", {"id": r["versions"]["before"]})
    assert span(svc, lid)["in"] == 1.0
