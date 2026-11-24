"""The brief can change a project's size, frame rate and length until the first layer exists (mock engine; the real engine is in test_comp_settings_real)."""
from __future__ import annotations

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


def make(tmp_path, **first):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 1920, "height": 1080, "frame_rate": 30, "duration": 15, **first}})
    return s, pkg


def comp(s):
    c = s.a.inspect().comp(None)
    return c.width, c.height, c.frame_rate, c.duration


def test_an_empty_composition_follows_the_projects_current_settings(tmp_path):
    s, pkg = make(tmp_path)
    assert comp(s) == (1920, 1080, 30.0, 15.0)
    s.handle("open", {"package": str(pkg), "settings": {"width": 3840, "height": 2160, "frame_rate": 24, "duration": 10}})
    assert comp(s) == (3840, 2160, 24.0, 10.0)
    s.handle("open", {"package": str(pkg), "settings": {}})                    # nothing asked: nothing changed
    assert comp(s) == (3840, 2160, 24.0, 10.0)


def test_once_a_layer_exists_the_settings_are_left_alone(tmp_path):
    s, pkg = make(tmp_path)
    s.handle("add_text", {"text": "Hello"})
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 24, "duration": 5}})
    assert comp(s) == (1920, 1080, 30.0, 15.0)


def test_settings_that_do_not_validate_are_ignored(tmp_path):
    s, pkg = make(tmp_path)
    s.handle("open", {"package": str(pkg), "settings": {"width": 3, "height": 99999999, "frame_rate": -1, "duration": 0}})
    assert comp(s) == (1920, 1080, 30.0, 15.0)
