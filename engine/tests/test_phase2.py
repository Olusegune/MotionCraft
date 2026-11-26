"""Primitives, audio analysis, extra layers and render jobs. Mock engine in CI; the real_engine tests render pictures and compare them."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from motioncraft_engine import audio
from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.adapter.errors import AdapterError, LockedLayerError
from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.primitives import library as prim
from motioncraft_engine.renderjobs import RenderJobs, RenderRefused
from motioncraft_engine.sidecar import Service

CLI = os.environ.get("EFFECTCRAFT_CLI", "")


# ------------------------------------------------------------------ primitive library (no engine)
def ctx(kind="Text", **kw):
    base = dict(layer=7, layer_kind=kind, fps=30.0, comp_duration=10.0, rest_position=[960.0, 540.0, 0.0], rest_scale=[100.0, 100.0, 100.0], rest_opacity=100.0)
    base.update(kw)
    return prim.Ctx(**base)


def test_every_primitive_builds_commands_that_name_their_layer_and_use_allowed_commands():
    from motioncraft_engine.adapter.policy import ALLOWED_FOR_AGENTS
    for pid, p in prim.LIBRARY.items():
        cmds = prim.build(pid, ctx("Text"), None)
        assert cmds, pid
        for c in cmds:
            assert c.id in ALLOWED_FOR_AGENTS, (pid, c.id)
            assert c.params.get("layer") == 7, (pid, c.id)


def test_defaults_ranges_and_unknown_parameters_are_checked_with_a_reason():
    assert prim.resolve_params(prim.LIBRARY["entrance.fade-in"], None)["duration"] == 0.8
    with pytest.raises(prim.PrimitiveError, match="between"):
        prim.build("entrance.fade-in", ctx(), {"duration": 99})
    with pytest.raises(prim.PrimitiveError, match="no parameter"):
        prim.build("entrance.fade-in", ctx(), {"bogus": 1})
    with pytest.raises(prim.PrimitiveError, match="one of"):
        prim.build("entrance.slide-in", ctx(), {"from": "diagonal"})
    with pytest.raises(prim.PrimitiveError, match="must be a number"):
        prim.build("emphasis.pulse", ctx(), {"amount": "lots"})
    with pytest.raises(prim.PrimitiveError, match="Unknown primitive"):
        prim.build("nope", ctx(), None)


def test_text_primitives_refuse_other_layers_and_double_animators_and_overruns():
    with pytest.raises(prim.PrimitiveError, match="works on Text"):
        prim.build("text.reveal-per-char", ctx("Shape"), None)
    with pytest.raises(prim.PrimitiveError, match="already has a text animator"):
        prim.build("text.reveal-per-char", ctx("Text", has_animators=True), None)
    with pytest.raises(prim.PrimitiveError, match="past the end"):
        prim.build("entrance.fade-in", ctx(comp_duration=2.0), {"start": 1.5, "duration": 1.0})


def test_slide_in_starts_off_screen_and_ends_at_the_rest_position():
    cmds = prim.build("entrance.slide-in", ctx(), {"from": "left", "distance": 300, "ease": "linear", "start": 1, "duration": 1})
    assert cmds[0].params["value"] == [660.0, 540.0, 0.0] and cmds[-1].params["value"] == [960.0, 540.0, 0.0]
    assert [c.params["time"] for c in cmds] == [1.0, 2.0]


# ------------------------------------------------------------------ audio
def test_tempo_and_beats_of_known_click_tracks(tmp_path):
    for bpm in (80, 120, 150):
        audio.make_click_track(tmp_path / "c.wav", bpm=bpm, seconds=16)
        r = audio.analyze(tmp_path / "c.wav")
        assert abs(r["bpm"] - bpm) <= 1.0, (bpm, r["bpm"])
        per = 60.0 / bpm
        worst = max(min(abs(b - k * per) for k in range(0, int(16 / per) + 2)) for b in r["beats"])
        assert worst < 0.04, (bpm, worst)          # within 40 ms, about one frame at 25 fps
        assert len(r["peaks"]) == 600 and r["estimate"] is True and r["downbeats"] == r["beats"][::4]


def test_silence_noise_and_bad_files_are_handled(tmp_path):
    import wave
    with wave.open(str(tmp_path / "s.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050); w.writeframes(b"\x00\x00" * 22050 * 5)
    r = audio.analyze(tmp_path / "s.wav")
    assert r["bpm"] is None and r["beats"] == [] and r["duration"] == 5.0
    (tmp_path / "x.wav").write_bytes(b"not audio")
    with pytest.raises(audio.AudioError):
        audio.analyze(tmp_path / "x.wav")
    (tmp_path / "a.mp3").write_bytes(b"ID3")
    if not shutil.which("ffmpeg"):
        with pytest.raises(audio.AudioError, match="ffmpeg"):
            audio.analyze(tmp_path / "a.mp3")


# ------------------------------------------------------------------ service on the mock
@pytest.fixture
def svc(tmp_path):
    factory = lambda pkg: MockAdapter()  # noqa: E731
    s = Service(factory, data_dir=tmp_path / "data", renders=RenderJobs(factory, ffmpeg=None))   # no ffmpeg: renders in one piece, whatever is installed here
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    (pkg / "assets" / "audio").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 10}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


def test_add_layers_shapes_solids_and_media(svc):
    (svc.pkg_path / "assets" / "images" / "a.png").write_bytes(b"\x89PNG....")
    assert svc.handle("add_shape", {"kind": "ellipse"})["layers"][0]["kind"] == "Shape"
    assert svc.handle("add_solid", {"color": [0.2, 0.3, 0.4]})["layers"][0]["kind"] == "Solid"
    assert svc.handle("add_media", {"rel": "assets/images/a.png"})["layers"][0]["kind"] == "Footage"
    with pytest.raises(AdapterError):
        svc.handle("add_shape", {"kind": "../x"})


@pytest.mark.parametrize("rel", ["../x.png", "/etc/passwd", "assets/images/../../x.png", "assets/other/a.png", "assets/images/missing.png", "a.png"])
def test_media_paths_are_confined_to_the_package_assets(svc, rel):
    with pytest.raises(AdapterError):
        svc.handle("add_media", {"rel": rel})


def test_apply_primitive_writes_keyframes_and_respects_locks(svc):
    lid = svc.handle("add_text", {"text": "Hi"})["layer"]
    r = svc.handle("apply_primitive", {"layer": lid, "primitive": "entrance.fade-in", "params": {"duration": 1.0}})
    assert r["commands"] >= 2
    keys = svc.a.layer_props(None, lid)["props"]["transform/opacity"]["keys"]
    assert [k["value"] for k in keys][0] == 0.0 and keys[-1]["value"] == 100.0
    svc.handle("lock", {"layers": [lid]})
    with pytest.raises(LockedLayerError):
        svc.handle("apply_primitive", {"layer": lid, "primitive": "emphasis.pulse"})
    with pytest.raises(prim.PrimitiveError):
        svc.handle("apply_primitive", {"layer": svc.handle("add_shape", {})["layer"], "primitive": "text.reveal-per-char"})


def test_audio_analysis_and_marker_sync(svc):
    audio.make_click_track(svc.pkg_path / "assets" / "audio" / "t.wav", bpm=120, seconds=8)
    a = svc.handle("audio_analyze", {"rel": "assets/audio/t.wav"})
    assert abs(a["bpm"] - 120) <= 1
    r = svc.handle("sync_markers", {"times": a["beats"], "replace": True})
    assert r["markers"] == len(a["beats"])
    assert len(svc.a.inspect().comp(None).markers) == len(a["beats"])
    with pytest.raises(AdapterError):
        svc.handle("sync_markers", {"times": []})
    with pytest.raises(AdapterError):
        svc.handle("audio_analyze", {"rel": "assets/images/a.png"})


def wait(svc, method, job, tries=200):
    for _ in range(tries):
        s = svc.handle(method, {"job": job})
        if s["state"] != "running":
            return s
        time.sleep(0.02)
    raise AssertionError("render did not finish")


def test_preview_movie_and_final_render_jobs(svc):
    svc.handle("add_text", {"text": "x"})
    j = svc.handle("preview_movie_start", {})
    s = wait(svc, "render_poll", j["id"])
    assert s["state"] == "done" and s["output"].startswith("previews/preview-") and (svc.pkg_path / s["output"]).exists()
    with pytest.raises(RenderRefused, match="confirmation"):
        svc.handle("render_start", {"preset": "h264", "name": "Demo"})
    f = svc.handle("render_start", {"preset": "h264", "name": "My Piece!", "spend_token": "tok1"})
    done = wait(svc, "render_poll", f["id"])
    assert done["state"] == "done" and done["output"].startswith("renders/My-Piece-h264-")
    with pytest.raises(RenderRefused, match="already used"):
        svc.handle("render_start", {"preset": "h264", "name": "again", "spend_token": "tok1"})
    with pytest.raises(RenderRefused, match="Unknown output"):
        svc.handle("render_start", {"preset": "gif", "name": "x", "spend_token": "tok2"})


# ------------------------------------------------------------------ real engine: pictures must really change
real = pytest.mark.skipif(not CLI or not Path(CLI).exists(), reason="EFFECTCRAFT_CLI not set: real engine NOT CHECKED")


@pytest.fixture
def rsvc(tmp_path):
    s = Service(lambda pkg: EffectCraftAdapter(Path(CLI), read_roots=[pkg], write_roots=[pkg]), data_dir=tmp_path / "data")
    pkg = tmp_path / "R.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    (pkg / "assets" / "audio").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 6}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    yield s
    s.handle("close", {})


def frame_hash(svc, t: float) -> str:
    out = svc.a.preview(None, [t], max_side=320)
    return hashlib.sha256(out.png).hexdigest()


@pytest.mark.real_engine
@real
@pytest.mark.parametrize("pid,params,t_a,t_b", [
    ("entrance.fade-in", {"duration": 2.0, "ease": "linear"}, 0.0, 2.5),
    ("exit.fade-out", {"start": 3.0, "duration": 2.0, "ease": "linear"}, 2.5, 5.5),
    ("entrance.slide-in", {"duration": 2.0, "from": "left", "distance": 400}, 0.0, 2.5),
    ("entrance.rise", {"duration": 2.0}, 0.0, 2.5),
    ("entrance.scale-pop", {"duration": 1.0}, 0.0, 1.5),
    ("emphasis.pulse", {"start": 1.0, "duration": 1.0, "amount": 40}, 0.5, 1.3),
    ("motion.drift", {"duration": 4.0, "dx": 200}, 0.0, 3.5),
    ("entrance.spin-in", {"duration": 2.0, "degrees": 180}, 0.0, 2.5),
    ("text.reveal-per-char", {"duration": 2.0}, 0.0, 2.5),
    ("text.rise-per-char", {"duration": 2.0}, 0.0, 2.5),
])
def test_primitive_changes_the_picture_over_time_on_the_real_engine(rsvc, pid, params, t_a, t_b):
    lid = rsvc.handle("add_text", {"text": "MotionCraft", "size": 90})["layer"]
    before_a, before_b = frame_hash(rsvc, t_a), frame_hash(rsvc, t_b)
    assert before_a == before_b, "a still layer must look the same at both times before the primitive"
    rsvc.handle("apply_primitive", {"layer": lid, "primitive": pid, "params": params})
    assert frame_hash(rsvc, t_a) != frame_hash(rsvc, t_b), f"{pid}: frames at {t_a}s and {t_b}s are identical"


@pytest.mark.real_engine
@real
def test_media_shape_solid_and_audio_layers_and_markers_on_the_real_engine(rsvc):
    from PIL import Image
    Image.new("RGB", (320, 180), (200, 60, 40)).save(rsvc.pkg_path / "assets" / "images" / "red.png")
    audio.make_click_track(rsvc.pkg_path / "assets" / "audio" / "t.wav", bpm=120, seconds=6)
    kinds = []
    for call in (("add_solid", {"color": [0.1, 0.1, 0.2]}), ("add_shape", {"kind": "star"}), ("add_media", {"rel": "assets/images/red.png"}),
                 ("add_media", {"rel": "assets/audio/t.wav"})):
        kinds = [l["kind"] for l in rsvc.handle(*call)["layers"]]
    assert sorted(kinds) == ["Footage", "Footage", "Shape", "Solid"], kinds       # the engine calls audio files footage too
    a = rsvc.handle("audio_analyze", {"rel": "assets/audio/t.wav"})
    assert rsvc.handle("sync_markers", {"times": a["beats"][:8], "replace": True})["markers"] == 8


@pytest.mark.real_engine
@real
def test_preview_movie_and_final_h264_render_have_the_right_frame_count(rsvc):
    rsvc.handle("add_text", {"text": "Render me", "size": 90})
    rsvc.handle("apply_primitive", {"layer": rsvc.handle("inspect", {})["layers"][0]["id"], "primitive": "entrance.fade-in", "params": {"duration": 1.0}})
    prev = wait(rsvc, "render_poll", rsvc.handle("preview_movie_start", {})["id"], tries=600)
    assert prev["state"] == "done", prev
    fin = wait(rsvc, "render_poll", rsvc.handle("render_start", {"preset": "h264", "name": "T", "spend_token": "t"})["id"], tries=600)
    assert fin["state"] == "done" and fin["frames"] == 180, fin          # 6 s x 30 fps
    if shutil.which("ffprobe"):
        r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "json",
                            str(rsvc.pkg_path / fin["output"])], capture_output=True, text=True)
        s = json.loads(r.stdout)["streams"][0]
        assert (int(s["nb_read_frames"]), s["width"], s["height"]) == (180, 640, 360)
