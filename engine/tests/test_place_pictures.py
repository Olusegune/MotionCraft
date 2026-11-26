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


def test_image_sizes_are_read_from_headers(tmp_path):
    import struct
    from motioncraft_engine.sidecar import _image_size
    png = tmp_path / "a.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 1408, 768) + b"\x08\x02\x00\x00\x00")
    assert _image_size(png) == (1408, 768)
    webp = tmp_path / "b.webp"
    webp.write_bytes(b"RIFF" + b"\0\0\0\0" + b"WEBPVP8X" + b"\0\0\0\0" + b"\0\0\0\0" + (1407).to_bytes(3, "little") + (767).to_bytes(3, "little"))
    assert _image_size(webp) == (1408, 768)
    assert _image_size(tmp_path / "missing.png") is None
    bad = tmp_path / "c.png"
    bad.write_bytes(b"not an image")
    assert _image_size(bad) is None


def test_a_clip_can_be_a_scenes_background_and_a_wrong_folder_is_refused(tmp_path):
    s = make(tmp_path)
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "video").mkdir(parents=True)
    (pkg / "assets" / "video" / "c.mp4").write_bytes(b"\0\0\0\x18ftypmp42" + b"0" * 64)
    r = s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 2, "t_out": 6}]})
    assert len(r["placed"]) == 1
    (pkg / "assets" / "audio").mkdir(parents=True)
    (pkg / "assets" / "audio" / "t.wav").write_bytes(b"RIFF" + b"0" * 40)
    with pytest.raises(Exception):
        s.handle("place_pictures", {"items": [{"rel": "assets/audio/t.wav", "t_in": 0, "t_out": 1}]})
