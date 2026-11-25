"""Which video files the REAL engine can use as layers (run with -m real_engine, EFFECTCRAFT_CLI set, ffmpeg on PATH).
A skip is "not checked", never "passed". The results decide which formats MotionCraft promises on import."""
from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine

# name, ffmpeg arguments after the input. 2 seconds of a bright test pattern with a tone.
CASES = {
    "h264.mp4": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
    "h264.mov": ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
    "vp9.webm": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-c:a", "libopus"],
    "hevc.mp4": ["-c:v", "libx265", "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-c:a", "aac"],
    "prores.mov": ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"],
}


def make_clip(path: Path, args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", *args, "-shortest", str(path)], check=True)


@pytest.mark.parametrize("name", list(CASES))
def test_video_clip_becomes_a_timed_layer_that_shows_pictures(tmp_path, name):
    Image = pytest.importorskip("PIL.Image")
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed: NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "video").mkdir(parents=True)
    make_clip(pkg / "assets" / "video" / name, CASES[name])
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Background"})
    lid = s.handle("add_media", {"rel": f"assets/video/{name}"})["layer"]
    s.handle("layer_timing", {"layer": lid, "t_in": 2.0, "t_out": 4.0})
    by = {l["name"]: l for l in s.handle("timeline_read", {})["layers"]}
    clip = by[name]
    assert clip["in"] == pytest.approx(2.0, abs=0.05) and clip["out"] == pytest.approx(4.0, abs=0.05)   # the engine snaps to its own frame grid
    im = Image.open(io.BytesIO(base64.b64decode(s.handle("preview", {"times": [3.0], "max_side": 320})["png"]))).convert("RGB")
    colourful = {im.getpixel((x, y)) for x in range(0, im.width, 16) for y in range(0, im.height, 16)}
    assert len(colourful) > 6, f"{name}: the clip did not draw (preview is flat)"
    s.handle("close", {})


def test_a_clip_placed_as_a_scene_background_starts_late_fills_the_frame_and_sits_behind_text(tmp_path):
    Image = pytest.importorskip("PIL.Image")
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed: NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "video").mkdir(parents=True)
    make_clip(pkg / "assets" / "video" / "c.mp4", CASES["h264.mp4"])        # 320x180, smaller than the 1280x720 frame
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Background"})
    s.handle("add_text", {"text": "Hello"})
    r = s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 6, "t_out": 8}]})
    assert len(r["placed"]) == 1
    by = {l["name"]: l for l in s.handle("timeline_read", {})["layers"]}
    assert by["c.mp4"]["in"] == pytest.approx(6.0, abs=0.05) and by["c.mp4"]["out"] == pytest.approx(8.0, abs=0.05)
    assert by["Hello"]["index"] < by["c.mp4"]["index"] < by["Background"]["index"]
    im = Image.open(io.BytesIO(base64.b64decode(s.handle("preview", {"times": [7.0], "max_side": 320})["png"]))).convert("RGB")
    for xy in ((2, 2), (im.width - 3, 2), (2, im.height - 3), (im.width - 3, im.height - 3)):
        assert sum(im.getpixel(xy)) > 90, f"black at {xy}: the clip does not cover the frame"
    s.handle("close", {})
