"""Resumable final renders (P5-02, AT-13) on the mock engine, with an injected joiner. The real engine and real ffmpeg are in
test_render_resume_real.py (marker real_engine)."""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.renderjobs import PARTS, RenderJobs, RenderRefused, plan_parts
from motioncraft_engine.sidecar import Service


def join_bytes(files: list[Path], out: Path, ext: str) -> None:
    out.write_bytes(b"".join(f.read_bytes() for f in files))


class Rig:
    """A service whose engine can be told to fail, or to wait inside a part, and which records every part it was asked to render."""

    def __init__(self, tmp_path, ffmpeg="fake-ffmpeg", joiner=join_bytes, duration=10, fps=30):
        self.calls: list[tuple] = []
        self.fail_at: set[int] = set()          # 1-based call numbers that raise
        self.block_at: int | None = None
        self.release = threading.Event()
        self.adapters: list[MockAdapter] = []

        def factory(pkg):
            a = MockAdapter()
            a.render_hook = lambda job, a=a: self._hook(a, job)
            self.adapters.append(a)
            return a
        self.svc = Service(factory, data_dir=tmp_path / "data", renders=RenderJobs(factory, joiner=joiner, ffmpeg=ffmpeg))
        self.pkg = tmp_path / "P.motioncraft"
        (self.pkg / "assets" / "images").mkdir(parents=True)
        self.svc.handle("open", {"package": str(self.pkg), "settings": {"width": 640, "height": 360, "frame_rate": fps, "duration": duration}})
        self.svc.handle("add_text", {"text": "x"})
        self.n = 0

    def _hook(self, a, job):
        self.n += 1
        self.calls.append((job.start, job.end))
        if self.n in self.fail_at:
            raise RuntimeError("the engine crashed")
        if self.block_at == self.n:
            while not a._aborted and not self.release.is_set():
                time.sleep(0.01)

    def start(self, token, preset="h264", **kw):
        return self.svc.handle("render_start", {"preset": preset, "name": "My Piece", "spend_token": token, **kw})

    def wait(self, jid, until=("done", "failed", "interrupted")):
        end = time.time() + 15
        while time.time() < end:
            s = self.svc.handle("render_poll", {"job": jid})
            if s["state"] in until:
                return s
            time.sleep(0.02)
        raise AssertionError("render did not finish: " + json.dumps(s))

    def parts_dir(self, jid):
        return self.pkg / PARTS / jid


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


# ------------------------------------------------------------------------------------------------ the plan
def test_the_plan_cuts_on_exact_frames_and_says_why_when_it_does_not():
    parts, why = plan_parts(10, 30, "ffmpeg", False)
    assert why == "" and [(p["start"], p["end"], p["frames"]) for p in parts] == [(0.0, 2.0, 60), (2.0, 4.0, 60), (4.0, 6.0, 60), (6.0, 8.0, 60), (8.0, 10.0, 60)]
    parts, _ = plan_parts(7, 25, "ffmpeg", False)
    assert [p["frames"] for p in parts] == [50, 50, 50, 25] and parts[-1]["end"] == 7.0 and sum(p["frames"] for p in parts) == 175
    for args, text in (((10, 30, None, False), "ffmpeg was not found"), ((10, 30, "ffmpeg", True), "audio"), ((10, 29.97, "ffmpeg", False), "29.97"),
                       ((2, 30, "ffmpeg", False), "short enough"), ((0, 30, "ffmpeg", False), "short enough")):
        parts, why = plan_parts(*args)
        assert parts is None and text in why and "one piece" in why


# ------------------------------------------------------------------------------------------------ a render that finishes
def test_a_render_is_made_in_parts_and_joined_in_order(rig):
    s = rig.wait(rig.start("t1")["id"])
    assert s["state"] == "done" and s["output"].startswith("renders/My-Piece-h264-") and s["frames"] == 300
    assert s["parts"] == {"done": 5, "total": 5} and s["resumable"] is True
    assert rig.calls == [(0.0, 2.0), (2.0, 4.0), (4.0, 6.0), (6.0, 8.0), (8.0, 10.0)]
    lines = (rig.pkg / s["output"]).read_bytes().splitlines()
    assert [l.split(b"|")[2] for l in lines] == [b"0.0", b"2.0", b"4.0", b"6.0", b"8.0"], "parts are joined in timeline order"
    assert not rig.parts_dir(s["id"]).exists(), "the parts are removed once the movie exists"
    assert rig.svc.handle("render_jobs", {})["jobs"] == []
    with pytest.raises(RenderRefused, match="already used"):
        rig.start("t1")


# ------------------------------------------------------------------------------------------------ AT-13: interrupted, then resumed
def test_at13_an_interrupted_render_resumes_from_the_last_finished_part(rig):
    rig.fail_at = {3}                                             # the engine dies while rendering the third part
    first = rig.start("t1")
    s = rig.wait(first["id"])
    assert s["state"] == "interrupted" and "crashed" in s["error"] and s["parts"] == {"done": 2, "total": 5} and s["resumable"] is True
    assert (rig.parts_dir(first["id"]) / "job.json").is_file()
    listed = rig.svc.handle("render_jobs", {})["jobs"]
    assert len(listed) == 1 and listed[0]["id"] == first["id"] and listed[0]["framesDone"] == 120 and listed[0]["framesTotal"] == 300 and listed[0]["changed"] is False

    rig.calls.clear()
    r = rig.svc.handle("render_resume", {"job": first["id"], "spend_token": "t2"})
    s = rig.wait(r["id"])
    assert s["state"] == "done" and s["frames"] == 300
    assert rig.calls == [(4.0, 6.0), (6.0, 8.0), (8.0, 10.0)], "only the parts that were missing were rendered again"
    lines = (rig.pkg / s["output"]).read_bytes().splitlines()
    assert [l.split(b"|")[2] for l in lines] == [b"0.0", b"2.0", b"4.0", b"6.0", b"8.0"], "the finished movie is complete and in order"
    assert not rig.parts_dir(first["id"]).exists()


def test_cancel_stops_mid_part_keeps_the_finished_parts_and_can_be_resumed(rig):
    rig.block_at = 3
    j = rig.start("t1")
    end = time.time() + 10
    while len(rig.calls) < 3 and time.time() < end:
        time.sleep(0.01)
    assert len(rig.calls) == 3
    assert rig.svc.handle("render_cancel", {"job": j["id"]})["state"] in ("running", "interrupted")
    s = rig.wait(j["id"])
    assert s["state"] == "interrupted" and s["error"] == "Cancelled." and s["parts"] == {"done": 2, "total": 5}
    assert not (rig.parts_dir(j["id"]) / "part-0002.mp4").exists(), "the part that was in flight is never kept"
    rig.block_at, rig.calls = None, []
    s = rig.wait(rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t2"})["id"])
    assert s["state"] == "done" and rig.calls == [(4.0, 6.0), (6.0, 8.0), (8.0, 10.0)]


def test_a_finished_part_that_went_missing_or_was_damaged_is_rendered_again(rig):
    rig.fail_at = {4}
    j = rig.start("t1")
    rig.wait(j["id"])
    d = rig.parts_dir(j["id"])
    (d / "part-0001.mp4").write_bytes(b"x")                      # damaged: wrong size
    (d / "part-0000.mp4").unlink()                                # missing
    rig.calls.clear()
    s = rig.wait(rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t2"})["id"])
    assert s["state"] == "done"
    assert sorted(c[0] for c in rig.calls) == [0.0, 2.0, 6.0, 8.0], "the missing part, the damaged part, the failed part and the last one"
    assert (4.0, 6.0) not in rig.calls, "the intact finished part was kept"
    assert [l.split(b"|")[2] for l in (rig.pkg / s["output"]).read_bytes().splitlines()] == [b"0.0", b"2.0", b"4.0", b"6.0", b"8.0"]


# ------------------------------------------------------------------------------------------------ resume is refused when it would be wrong
def test_resume_is_refused_when_the_project_changed_and_the_token_is_not_spent(rig):
    rig.fail_at = {2}
    j = rig.start("t1")
    rig.wait(j["id"])
    rig.svc.handle("add_text", {"text": "a change after the render started"})
    assert rig.svc.handle("render_jobs", {})["jobs"][0]["changed"] is True
    with pytest.raises(RenderRefused, match="project changed"):
        rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t2"})
    rig.svc.handle("render_discard", {"job": j["id"]})
    s = rig.wait(rig.start("t2")["id"])                           # "t2" was not used up by the refused resume
    assert s["state"] == "done"


def test_resume_needs_a_fresh_token_a_real_job_and_nothing_running(rig):
    rig.fail_at = {2}
    j = rig.start("t1")
    rig.wait(j["id"])
    with pytest.raises(RenderRefused, match="confirmation"):
        rig.svc.handle("render_resume", {"job": j["id"]})
    with pytest.raises(RenderRefused, match="already used"):
        rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t1"})
    for bad in ("../../x", "zzzzzzzzzzzz", "", "a" * 12):
        with pytest.raises(RenderRefused, match="Unknown render"):
            rig.svc.handle("render_resume", {"job": bad, "spend_token": "tok-" + bad})
    rig.fail_at, rig.block_at = set(), 2
    r = rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t3"})
    with pytest.raises(RenderRefused, match="still running"):
        rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t4"})
    with pytest.raises(RenderRefused, match="already running"):
        rig.start("t5")
    rig.release.set()
    assert rig.wait(r["id"])["state"] == "done"
    with pytest.raises(RenderRefused, match="Unknown render"):
        rig.svc.handle("render_resume", {"job": j["id"], "spend_token": "t6"})      # finished jobs leave nothing to resume


# ------------------------------------------------------------------------------------------------ the app was killed
def test_a_render_left_running_by_a_killed_app_is_reported_interrupted_and_can_be_resumed(rig):
    rig.fail_at = {3}
    j = rig.start("t1")
    rig.wait(j["id"])
    f = rig.parts_dir(j["id"]) / "job.json"
    d = json.loads(f.read_text())
    d["state"] = "running"                                          # what a killed app leaves behind
    f.write_text(json.dumps(d))
    fresh = Rig.__new__(Rig)                                        # a new process: a new service that has never seen this job
    svc2 = Service(lambda pkg: MockAdapter(), data_dir=rig.pkg.parent / "data2", renders=RenderJobs(lambda pkg: MockAdapter(), joiner=join_bytes, ffmpeg="fake-ffmpeg"))
    svc2.handle("open", {"package": str(rig.pkg)})
    listed = svc2.handle("render_jobs", {})["jobs"]
    assert listed[0]["state"] == "interrupted" and "closed or crashed" in listed[0]["error"] and listed[0]["parts"] == {"done": 2, "total": 5}
    r = svc2.handle("render_resume", {"job": j["id"], "spend_token": "n1"})
    end = time.time() + 15
    while svc2.handle("render_poll", {"job": r["id"]})["state"] == "running" and time.time() < end:
        time.sleep(0.02)
    assert svc2.handle("render_poll", {"job": r["id"]})["state"] == "done"


# ------------------------------------------------------------------------------------------------ discard
def test_discard_removes_only_that_jobs_parts(rig):
    rig.fail_at = {3}
    j = rig.start("t1")
    rig.wait(j["id"])
    keep = rig.pkg / "assets" / "images" / "precious.png"
    keep.write_bytes(b"x")
    assert rig.svc.handle("render_discard", {"job": j["id"]}) == {"discarded": j["id"]}
    assert not rig.parts_dir(j["id"]).exists() and keep.exists() and (rig.pkg / "comp.ecproj").exists()
    for bad in ("../../assets", "..", j["id"], "zz"):
        with pytest.raises(RenderRefused):
            rig.svc.handle("render_discard", {"job": bad})


def test_a_running_render_cannot_be_discarded(rig):
    rig.block_at = 1
    j = rig.start("t1")
    end = time.time() + 5
    while not rig.calls and time.time() < end:
        time.sleep(0.01)
    with pytest.raises(RenderRefused, match="Cancel the render"):
        rig.svc.handle("render_discard", {"job": j["id"]})
    rig.release.set()
    rig.wait(j["id"])


# ------------------------------------------------------------------------------------------------ not splittable: one piece
def test_without_ffmpeg_it_renders_in_one_piece_and_says_it_cannot_be_resumed(tmp_path):
    r = Rig(tmp_path, ffmpeg=None)
    s = r.wait(r.start("t1")["id"])
    assert s["state"] == "done" and s["parts"] is None and s["resumable"] is False and "ffmpeg" in s["reason"]
    assert r.calls == [(None, None)] and not (r.pkg / PARTS).exists()


def test_audio_in_the_project_means_one_piece(rig):
    s = rig.wait(rig.start("t1", has_audio=True)["id"])
    assert s["state"] == "done" and s["parts"] is None and "audio" in s["reason"]


def test_cancelling_a_one_piece_render_ends_it_and_keeps_no_half_file(tmp_path):
    r = Rig(tmp_path, ffmpeg=None)
    r.block_at = 1
    j = r.start("t1")
    end = time.time() + 5
    while not r.calls and time.time() < end:
        time.sleep(0.01)
    r.svc.handle("render_cancel", {"job": j["id"]})
    s = r.wait(j["id"])
    assert s["state"] == "failed" and s["error"] == "Cancelled." and not list((r.pkg / "renders").glob("*.mp4"))


def test_a_failed_join_keeps_every_part_and_resume_only_joins_again(tmp_path):
    state = {"fail": True}

    def joiner(files, out, ext):
        if state["fail"]:
            raise RuntimeError("the parts could not be joined")
        join_bytes(files, out, ext)
    r = Rig(tmp_path, joiner=joiner)
    j = r.start("t1")
    s = r.wait(j["id"])
    assert s["state"] == "interrupted" and "could not be joined" in s["error"] and s["parts"] == {"done": 5, "total": 5}
    state["fail"] = False
    r.calls.clear()
    s = r.wait(r.svc.handle("render_resume", {"job": j["id"], "spend_token": "t2"})["id"])
    assert s["state"] == "done" and r.calls == [], "nothing was rendered again, the parts were just joined"
