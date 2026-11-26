"""The background behind keyed clips: one layer called Backdrop, replaced each time, sitting above a Background solid and below the scene pictures (mock adapter)."""
from __future__ import annotations

import pytest
from PIL import Image

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


@pytest.fixture()
def svc(tmp_path):
    s = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "images").mkdir(parents=True)
    Image.new("RGB", (64, 36), (200, 40, 40)).save(pkg / "assets" / "images" / "bg.png")
    Image.new("RGB", (64, 36), (40, 40, 200)).save(pkg / "assets" / "images" / "scene.png")
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 24, "duration": 10}})
    return s


def names(s):
    """Layer names from the front of the stack to the back."""
    return [l["name"] for l in s.handle("inspect", {})["layers"]]


def test_a_colour_backdrop_is_one_layer_and_is_replaced(svc):
    svc.handle("set_backdrop", {"kind": "colour", "color": [1, 1, 1]})
    svc.handle("set_backdrop", {"kind": "colour", "color": [0, 0, 0]})
    assert names(svc).count("Backdrop") == 1


def test_none_takes_it_away(svc):
    svc.handle("set_backdrop", {"kind": "colour", "color": [1, 1, 1]})
    svc.handle("set_backdrop", {"kind": "none"})
    assert "Backdrop" not in names(svc)


def test_a_picture_backdrop_is_named_and_swapped_for_a_colour(svc):
    svc.handle("set_backdrop", {"kind": "picture", "rel": "assets/images/bg.png"})
    assert names(svc).count("Backdrop") == 1
    svc.handle("set_backdrop", {"kind": "colour", "color": [0.5, 0.5, 0.5]})
    assert names(svc).count("Backdrop") == 1


def test_backdrop_sits_above_the_background_solid_and_below_scene_pictures_even_after_placing(svc):
    svc.handle("add_solid", {"name": "Background"})
    svc.handle("set_backdrop", {"kind": "colour", "color": [1, 1, 1]})
    assert names(svc) == ["Backdrop", "Background"]
    svc.handle("place_pictures", {"items": [{"rel": "assets/images/scene.png", "t_in": 0, "t_out": 5}]})
    order = names(svc)
    assert order[-1] == "Background" and order[-2] == "Backdrop", order       # the picture is in front of both


@pytest.mark.parametrize("bad", [{"kind": "sky"}, {"kind": "colour"}, {"kind": "colour", "color": [1, 1]}, {"kind": "picture"}, {"kind": "picture", "rel": "../x.png"}])
def test_bad_requests_are_refused(svc, bad):
    with pytest.raises(Exception):
        svc.handle("set_backdrop", bad)
