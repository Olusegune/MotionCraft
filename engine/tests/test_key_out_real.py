"""The flat green (or blue) screen of a generated clip is really taken out on the real engine (run with -m real_engine and EFFECTCRAFT_CLI set, ffmpeg on PATH).
A skip is "not checked", never "passed"."""
from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine

MAGENTA = [1.0, 0.0, 1.0]


def pixel(svc: Service, xy):
    p = svc.handle("preview", {"times": [0.5], "max_side": 320})
    im = Image.open(io.BytesIO(base64.b64decode(p["png"]))).convert("RGB")
    return im.getpixel(xy)


def screen_picture(pkg: Path, colour_hex: str) -> None:
    (pkg / "assets" / "images").mkdir(parents=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x{colour_hex}:s=320x180", "-vf",
                    "drawbox=x=120:y=60:w=80:h=60:color=red:t=fill", "-frames:v", "1", str(pkg / "assets" / "images" / "s.png")], check=True)


@pytest.mark.parametrize("name,hex_", [("green", "00B140"), ("blue", "0047FF")])
def test_the_screen_goes_and_the_subject_stays(tmp_path, name, hex_):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed: NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    screen_picture(pkg, hex_)
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 320, "height": 180, "frame_rate": 24, "duration": 2}})
    s.handle("add_solid", {"name": "Behind", "color": MAGENTA})
    lid = s.handle("add_media", {"rel": "assets/images/s.png"})["layer"]
    r0, g0, b0 = pixel(s, (10, 10))
    assert (r0, g0, b0) != (255, 0, 255) and abs(g0 - b0) > 20 or name == "blue"      # before: the screen covers the magenta
    done = s.handle("key_out", {"layers": [lid], "colour": name})
    assert done["keyed"] == [lid]
    r, g, b = pixel(s, (10, 10))
    assert r > 200 and b > 200 and g < 60, f"the {name} screen should show the magenta behind it, got {(r, g, b)}"
    sr, sg, sb = pixel(s, (160, 90))
    assert sr > 200 and sg < 60 and sb < 60, f"the subject should stay red, got {(sr, sg, sb)}"
    s.handle("close", {})


def test_bad_key_requests_are_refused(tmp_path):
    s = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 24, "duration": 5}})
    for bad in ({"layers": [1], "colour": "red"}, {"layers": [], "colour": "green"}, {"layers": list(range(30)), "colour": "green"}):
        with pytest.raises(Exception):
            s.handle("key_out", bad)
