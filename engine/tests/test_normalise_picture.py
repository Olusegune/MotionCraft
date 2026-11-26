"""Generated WebP pictures become PNG so every editor hand-off can carry them."""
from __future__ import annotations

from PIL import Image

from motioncraft_engine.providers.jobs import normalise_picture


def test_webp_becomes_png_and_the_original_goes(tmp_path):
    src = tmp_path / "gen-1.webp"
    Image.new("RGB", (8, 6), (200, 30, 30)).save(src, "WEBP")
    out = normalise_picture(src)
    assert out.suffix == ".png" and out.exists() and not src.exists()
    assert Image.open(out).size == (8, 6)


def test_other_files_and_unreadable_webp_are_left_alone(tmp_path):
    png = tmp_path / "a.png"
    Image.new("RGB", (2, 2)).save(png)
    assert normalise_picture(png) == png
    bad = tmp_path / "b.webp"
    bad.write_bytes(b"not a picture")
    assert normalise_picture(bad) == bad and bad.exists()
