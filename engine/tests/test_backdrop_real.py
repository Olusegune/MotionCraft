"""The background picker on the real engine: a keyed green screen picture shows the chosen colour, then a chosen picture, then nothing (run with
-m real_engine and EFFECTCRAFT_CLI set, ffmpeg on PATH). A skip is "not checked", never "passed"."""
from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine


def pixel(svc: Service, xy):
    p = svc.handle("preview", {"times": [0.5], "max_side": 320})
    return Image.open(io.BytesIO(base64.b64decode(p["png"]))).convert("RGB").getpixel(xy)


def test_the_chosen_background_shows_through_the_key(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed: NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "images").mkdir(parents=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x00B140:s=320x180", "-vf",
                    "drawbox=x=120:y=60:w=80:h=60:color=red:t=fill", "-frames:v", "1", str(pkg / "assets" / "images" / "s.png")], check=True)
    Image.new("RGB", (320, 180), (20, 60, 220)).save(pkg / "assets" / "images" / "sky.png")
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 320, "height": 180, "frame_rate": 24, "duration": 2}})
    s.handle("add_solid", {"name": "Background", "color": [0.1, 0.1, 0.1]})
    lid = s.handle("add_media", {"rel": "assets/images/s.png"})["layer"]
    s.handle("key_out", {"layers": [lid], "colour": "green"})

    s.handle("set_backdrop", {"kind": "colour", "color": [1, 1, 1]})
    r, g, b = pixel(s, (10, 10))
    assert min(r, g, b) > 200, f"a white background should show through the keyed screen, got {(r, g, b)}"
    sr, sg, sb = pixel(s, (160, 90))
    assert sr > 200 and sg < 60 and sb < 60, f"the subject should stay red, got {(sr, sg, sb)}"

    s.handle("set_backdrop", {"kind": "picture", "rel": "assets/images/sky.png"})
    r, g, b = pixel(s, (10, 10))
    assert b > 150 and r < 90, f"the blue picture should show behind the subject, got {(r, g, b)}"
    assert pixel(s, (160, 90))[0] > 200                                     # still red in front

    s.handle("set_backdrop", {"kind": "none"})
    r, g, b = pixel(s, (10, 10))
    assert max(r, g, b) < 60, f"with no backdrop the dark Background solid shows, got {(r, g, b)}"
    s.handle("close", {})
