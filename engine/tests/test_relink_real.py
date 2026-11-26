"""A project copied somewhere else still finds its media (run with -m real_engine and EFFECTCRAFT_CLI set). A skip is "not checked", never "passed".
Found by the Civilization I-VII walkthrough: the composition keeps the full path of every file, so the example project shipped with the app, a saved copy,
an exported package and a moved project all pointed at the folder they were made in."""
from __future__ import annotations

import base64
import io
import os
import shutil
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


def service(cli, tmp_path, name):
    return Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / name)


def test_a_copied_project_finds_its_pictures_again_and_survives_the_original_being_deleted(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    a_dir = tmp_path / "A.motioncraft"
    (a_dir / "fonts").mkdir(parents=True)
    (a_dir / "fonts" / "manifest.json").write_text("[]")
    (a_dir / "assets" / "images").mkdir(parents=True)
    png(a_dir / "assets" / "images" / "imp-1-red.png", (220, 30, 30))
    s = service(cli, tmp_path, "d1")
    s.handle("open", {"package": str(a_dir), "settings": {"name": "Main", "width": 640, "height": 360, "frame_rate": 24, "duration": 5}})
    s.handle("place_pictures", {"items": [{"rel": "assets/images/imp-1-red.png", "t_in": 0, "t_out": 5}]})
    s.handle("close", {})

    b_dir = tmp_path / "B.motioncraft"
    shutil.copytree(a_dir, b_dir)
    shutil.rmtree(a_dir)                                       # the folder the composition remembers is gone
    s2 = service(cli, tmp_path, "d2")
    s2.handle("open", {"package": str(b_dir)})
    missing = s2._need().execute([__import__("motioncraft_engine.adapter", fromlist=["Command"]).Command(id="footage.missing", params={})],
                                 actor=__import__("motioncraft_engine.adapter", fromlist=["USER"]).USER).results[0].result
    assert not missing.get("missing"), missing
    im = Image.open(io.BytesIO(base64.b64decode(s2.handle("preview", {"times": [2.0], "max_side": 320})["png"]))).convert("RGB")
    r, g, b = im.getpixel((im.width // 2, im.height // 2))
    assert r > 150 and g < 90 and b < 90, f"the picture did not draw: {(r, g, b)}"
    s2.handle("close", {})
