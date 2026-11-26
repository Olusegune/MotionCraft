"""Reading a video's picture size from its header (no outside tool). The ffmpeg-made clips are skipped, never counted as passed, when ffmpeg is absent."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from motioncraft_engine.media_info import video_size


def clip(path: Path, size: str, *extra: str):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=24:duration=1", *extra, str(path)], check=True)


needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed: NOT CHECKED")


@needs_ffmpeg
@pytest.mark.parametrize("name,args", [("a.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]), ("a.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
                                       ("a.webm", ["-c:v", "libvpx-vp9"]), ("a.mp4", ["-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"])])
def test_reads_width_and_height(tmp_path, name, args):
    p = tmp_path / name
    clip(p, "640x360", *args)
    assert video_size(p) == (640, 360)


@needs_ffmpeg
def test_a_sideways_phone_video_is_turned_upright(tmp_path):
    p = tmp_path / "r.mp4"
    clip(p, "640x360", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata:s:v", "rotate=90")
    # ffmpeg writes the rotation as a display matrix; a quarter turn swaps the sides
    assert video_size(p) in {(360, 640), (640, 360)}


def test_garbage_and_missing_files_give_none(tmp_path):
    (tmp_path / "x.mp4").write_bytes(b"not a video at all")
    assert video_size(tmp_path / "x.mp4") is None
    assert video_size(tmp_path / "missing.mp4") is None
    (tmp_path / "t.mp4").write_bytes(b"\0\0\0\x18ftypmp42" + b"tkhd")     # a header that stops short
    assert video_size(tmp_path / "t.mp4") is None
