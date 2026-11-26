"""Scene pictures on the REAL engine (run with -m real_engine and EFFECTCRAFT_CLI set). A skip is "not checked", never "passed"."""
from __future__ import annotations

import os
import struct
import zlib
from pathlib import Path

import pytest

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine


def png(path: Path, rgb):
    w = h = 64
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def ch(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))


def test_each_picture_sits_behind_its_scene_above_the_background_and_below_the_text(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "images").mkdir(parents=True)
    png(pkg / "assets" / "images" / "a.png", (200, 30, 30))
    png(pkg / "assets" / "images" / "b.png", (30, 30, 200))
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Background"})
    s.handle("add_text", {"text": "Hello"})
    r = s.handle("place_pictures", {"items": [{"rel": "assets/images/a.png", "t_in": 0, "t_out": 5}, {"rel": "assets/images/b.png", "t_in": 5, "t_out": 10}]})
    assert len(r["placed"]) == 2
    by = {l["name"]: l for l in s.handle("timeline_read", {})["layers"]}
    assert (by["a.png"]["in"], by["a.png"]["out"]) == (0.0, 5.0) and (by["b.png"]["in"], by["b.png"]["out"]) == (5.0, 10.0)
    assert by["Hello"]["index"] < by["b.png"]["index"] < by["Background"]["index"] and by["Hello"]["index"] < by["a.png"]["index"] < by["Background"]["index"]
    s.handle("close", {})


def test_a_small_picture_fills_the_whole_frame(tmp_path):
    """A picture smaller than the composition is scaled to cover it, so no black shows at the corners."""
    import base64
    import io
    Image = pytest.importorskip("PIL.Image")
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "images").mkdir(parents=True)
    png(pkg / "assets" / "images" / "a.png", (200, 30, 30))
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Background"})
    s.handle("place_pictures", {"items": [{"rel": "assets/images/a.png", "t_in": 0, "t_out": 10}]})
    im = Image.open(io.BytesIO(base64.b64decode(s.handle("preview", {"times": [5.0], "max_side": 320})["png"]))).convert("RGB")
    for xy in ((2, 2), (im.width - 3, 2), (2, im.height - 3), (im.width - 3, im.height - 3)):
        assert sum(im.getpixel(xy)) > 90, f"black at {xy}: the picture does not cover the frame"
    s.handle("close", {})
