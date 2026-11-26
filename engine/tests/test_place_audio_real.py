"""A voiceover placed at a scene's start really starts there on the real engine (run with -m real_engine and EFFECTCRAFT_CLI set, ffmpeg on PATH).
A skip is "not checked", never "passed"."""
from __future__ import annotations

import math
import os
import shutil
import struct
import subprocess
from pathlib import Path

import pytest

from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.providers import speech
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine


def tone(seconds: float, hz: float = 440.0, rate: int = 24000) -> bytes:
    pcm = b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(int(seconds * rate)))
    return speech.wav(pcm, rate)


def test_a_voiceover_starts_at_its_scene_and_is_heard_there_and_not_before(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed: NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "audio").mkdir(parents=True)
    (pkg / "assets" / "audio" / "vo-1.wav").write_bytes(tone(2.0))
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 320, "height": 180, "frame_rate": 24, "duration": 10}})
    s.handle("add_solid", {"name": "Background"})
    s.handle("place_audio", {"items": [{"rel": "assets/audio/vo-1.wav", "t_in": 5}]})
    lay = next(l for l in s.handle("timeline_read", {})["layers"] if l["name"].endswith("vo-1.wav"))
    assert lay["in"] == pytest.approx(5.0, abs=0.06) and lay["out"] == pytest.approx(7.0, abs=0.08)
    s.handle("close", {})


def test_music_can_be_lowered_under_a_voice_on_the_real_engine(tmp_path):
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    s = Service(lambda p: EffectCraftAdapter(Path(cli), read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "audio").mkdir(parents=True)
    (pkg / "assets" / "audio" / "m.wav").write_bytes(tone(2.0))
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 320, "height": 180, "frame_rate": 24, "duration": 5}})
    lid = s.handle("place_audio", {"items": [{"rel": "assets/audio/m.wav", "t_in": 0}]})["placed"][0]
    s.handle("set_audio_level", {"layers": [lid], "db": -10})
    a = s._need()
    comp = a.inspect().comp(None)
    assert a.layer_props(comp.id, lid)["props"]["audio/levels"]["value"] == [-10.0, -10.0]
    s.handle("close", {})
