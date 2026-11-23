"""AT-13 on the REAL engine and real ffmpeg (run with -m real_engine and EFFECTCRAFT_CLI set; ffmpeg and ffprobe must be installed).
A skip here is "not checked", never "passed".

The engine process is killed in the middle of a render; the render is resumed; the finished movie must have every frame and, for
ProRes (which is intra-only), be bit-identical to a render that was never interrupted.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from motioncraft_engine.adapter import Command
from motioncraft_engine.adapter.models import FinalRenderJob
from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.renderjobs import RenderJobs
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine
FF, FP = shutil.which("ffmpeg"), shutil.which("ffprobe")


def make(tmp_path, seconds: int, w: int = 960, h: int = 540):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not FF or not FP:
        pytest.skip("ffmpeg/ffprobe not installed: resumable rendering NOT CHECKED")
    factory = lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p])  # noqa: E731
    svc = Service(factory, data_dir=tmp_path / "d", renders=RenderJobs(factory))
    pkg = tmp_path / "R.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    svc.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": w, "height": h, "frame_rate": 30, "duration": seconds}})
    svc.handle("builder_execute", {"plan": {"layers": [
        {"kind": "solid", "name": "Back", "color": [0.1, 0.2, 0.4]},
        {"kind": "text", "name": "Title", "text": "Resume me", "size": 120, "animations": [{"primitive": "motion.drift", "start": 0, "duration": float(seconds), "params": {"dx": 300}}]}]}})
    return svc, pkg, factory


def wait(svc, jid, states=("done", "failed", "interrupted"), timeout=300):
    end = time.time() + timeout
    while time.time() < end:
        s = svc.handle("render_poll", {"job": jid})
        if s["state"] in states:
            return s
        time.sleep(0.02)
    raise AssertionError("timed out")


def frames_md5(path: Path) -> list[str]:
    out = subprocess.run([FF, "-v", "error", "-i", str(path), "-map", "0:v:0", "-f", "framemd5", "-"], capture_output=True, text=True).stdout
    return [l.split(",")[-1].strip() for l in out.splitlines() if l and not l.startswith("#")]


def count_frames(path: Path) -> int:
    out = subprocess.run([FP, "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    return int(out.strip().splitlines()[-1])


def test_at13_killed_engine_then_resume_gives_a_complete_movie_identical_to_an_uninterrupted_render(tmp_path):
    svc, pkg, factory = make(tmp_path, seconds=60)
    j = svc.handle("render_start", {"preset": "prores4444", "name": "Kill", "spend_token": "k1"})
    assert j["state"] == "running"
    end = time.time() + 120
    while time.time() < end:                                         # wait until a few parts are done, then pull the plug on the engine
        s = svc.handle("render_poll", {"job": j["id"]})
        if s["parts"] and s["parts"]["done"] >= 3 or s["state"] != "running":
            break
        time.sleep(0.01)
    assert s["state"] == "running", f"the render finished before it could be interrupted: {json.dumps(s)[:200]}"
    svc.handle("render_cancel", {"job": j["id"]})                    # kills the engine process mid-part
    s = wait(svc, j["id"])
    assert s["state"] == "interrupted" and 3 <= s["parts"]["done"] < s["parts"]["total"], s
    done_before = s["parts"]["done"]
    assert svc.handle("render_jobs", {})["jobs"][0]["framesDone"] == done_before * 60

    r = svc.handle("render_resume", {"job": j["id"], "spend_token": "k2"})
    s = wait(svc, r["id"])
    assert s["state"] == "done", s
    movie = pkg / s["output"]
    assert count_frames(movie) == 1800 == s["frames"]

    # an uninterrupted single-piece render of the same saved project, for comparison
    ref = pkg / "renders" / "reference.mov"        # inside the project: the engine is confined to it
    a = factory(pkg)
    a.open(pkg / "comp.ecproj")
    a._spend_ok = lambda t: t == "ref"
    a.render_final(FinalRenderJob(comp=a.inspect().active_comp, preset="prores4444", output=ref), "ref")
    a.close()
    got, want = frames_md5(movie), frames_md5(ref)
    assert len(got) == len(want) == 1800
    assert got == want, f"{sum(1 for x, y in zip(got, want) if x != y)} frames differ from the uninterrupted render"
    assert not (pkg / "renders" / ".parts" / j["id"]).exists()


def test_h264_parts_join_to_the_right_frame_count_and_look_the_same(tmp_path):
    svc, pkg, _ = make(tmp_path, seconds=10, w=640, h=360)
    s = wait(svc, svc.handle("render_start", {"preset": "h264", "name": "H", "spend_token": "h1"})["id"])
    assert s["state"] == "done" and s["parts"] == {"done": 5, "total": 5}
    movie = pkg / s["output"]
    assert count_frames(movie) == 300
    ref = tmp_path / "ref.mp4"
    cli = os.environ["EFFECTCRAFT_CLI"]
    a = EffectCraftAdapter(Path(cli), read_roots=[pkg, tmp_path], write_roots=[pkg, tmp_path])
    a.open(pkg / "comp.ecproj")
    a._spend_ok = lambda t: t == "r"
    a.render_final(FinalRenderJob(comp=a.inspect().active_comp, preset="h264", output=ref), "r")
    a.close()
    r = subprocess.run([FF, "-v", "info", "-i", str(ref), "-i", str(movie), "-lavfi", "psnr", "-f", "null", "-"], capture_output=True, text=True).stderr
    avg = float([l for l in r.splitlines() if "average:" in l][-1].split("average:")[1].split()[0])
    assert avg > 50, f"PSNR {avg} dB: the joined video should be visually identical (measured 64.6 dB in the spike)"


def test_a_project_with_audio_or_no_ffmpeg_is_not_split(tmp_path):
    svc, pkg, _ = make(tmp_path, seconds=10, w=640, h=360)
    s = wait(svc, svc.handle("render_start", {"preset": "h264", "name": "A", "spend_token": "a1", "has_audio": True})["id"])
    assert s["state"] == "done" and s["parts"] is None and "audio" in s["reason"]
    assert count_frames(pkg / s["output"]) == 300
