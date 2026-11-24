"""Scene pictures: each picture goes behind its scene, timed to it (mock engine; the real engine is in test_place_pictures_real)."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


def make(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    for n in ("a.png", "b.png"):
        (pkg / "assets" / "images" / n).write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 64)
    s.handle("open", {"package": str(pkg), "settings": {"width": 1920, "height": 1080, "frame_rate": 30, "duration": 10}})
    return s


def test_pictures_are_placed_in_order_and_need_a_sensible_request(tmp_path):
    s = make(tmp_path)
    for bad in ([], "x", [{"rel": "assets/images/missing.png", "t_in": 0, "t_out": 1}], [3]):
        with pytest.raises(Exception):
            s.handle("place_pictures", {"items": bad})
