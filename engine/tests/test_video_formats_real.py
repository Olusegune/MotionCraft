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


def _open_with_clip(tmp_path, width=320, height=180):
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
    make_clip(pkg / "assets" / "video" / "c.mp4", CASES["h264.mp4"])        # 2 seconds
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": width, "height": height, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Background"})
    return s, Image


def _frame(s, Image, t):
    return Image.open(io.BytesIO(base64.b64decode(s.handle("preview", {"times": [t], "max_side": 320})["png"]))).convert("RGB")


def _diff(a, b):
    return sum(sum(abs(x - y) for x, y in zip(pa, pb)) for pa, pb in zip(a.getdata(), b.getdata())) / (a.width * a.height)


def test_a_clip_shorter_than_its_scene_holds_its_last_frame_unless_asked_to_loop(tmp_path):
    s, Image = _open_with_clip(tmp_path)
    s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 0, "t_out": 6}]})
    clips = [l for l in s.handle("timeline_read", {})["layers"] if l["name"] == "c.mp4"]
    assert len(clips) == 1
    assert _diff(_frame(s, Image, 3.0), _frame(s, Image, 5.0)) < 1.0, "after the clip ends it should stay on one frame"
    s.handle("close", {})


def test_looping_repeats_the_clip_back_to_back_to_the_end_of_the_scene(tmp_path):
    s, Image = _open_with_clip(tmp_path)
    s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 1, "t_out": 6, "loop": True}]})
    clips = sorted((l for l in s.handle("timeline_read", {})["layers"] if l["name"].startswith("c.mp4")), key=lambda l: l["in"])   # the engine numbers the copies
    assert len(clips) == 3                                                     # 5 s of scene, 2 s clip: 2 + 2 + 1
    assert [round(l["in"]) for l in clips] == [1, 3, 5] and round(clips[-1]["out"]) == 6
    assert _diff(_frame(s, Image, 1.5), _frame(s, Image, 3.5)) < 12.0, "the second round should look like the first"
    assert _diff(_frame(s, Image, 1.5), _frame(s, Image, 1.9)) > 3.0, "the clip should be moving within a round"
    s.handle("close", {})


def test_a_clip_too_short_to_loop_is_refused_with_a_plain_reason(tmp_path):
    s, _ = _open_with_clip(tmp_path)
    with pytest.raises(Exception, match="copies"):
        s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 0, "t_out": 60, "loop": True}]})
    s.handle("close", {})


def test_a_clip_placed_late_really_plays_from_its_first_frame_then_holds(tmp_path):
    """Regression: a clip only trimmed to start at 4 s kept its own start at 0 and was already over, so only its last frame ever showed."""
    s, Image = _open_with_clip(tmp_path)
    s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 4, "t_out": 8}]})
    assert _diff(_frame(s, Image, 4.2), _frame(s, Image, 5.0)) > 3.0, "the clip should be playing between 4 s and 6 s"
    assert _diff(_frame(s, Image, 6.5), _frame(s, Image, 7.5)) < 1.0, "after its 2 seconds it holds the last frame to the end of the scene"
    s.handle("close", {})


def test_a_long_clip_is_trimmed_at_the_end_of_a_short_scene(tmp_path):
    s, Image = _open_with_clip(tmp_path)
    s.handle("place_pictures", {"items": [{"rel": "assets/video/c.mp4", "t_in": 9, "t_out": 10}]})
    clip = [l for l in s.handle("timeline_read", {})["layers"] if l["name"].startswith("c.mp4")][0]
    assert clip["in"] == pytest.approx(9.0, abs=0.05) and clip["out"] == pytest.approx(10.0, abs=0.05)
    s.handle("close", {})
