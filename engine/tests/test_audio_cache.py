"""The audio analysis is kept inside the project, so it is there when the project is opened again."""
from __future__ import annotations

import json
import os

import pytest

from motioncraft_engine import audio
from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.adapter.errors import AdapterError
from motioncraft_engine.sidecar import Service


@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "audio").mkdir(parents=True)
    (pkg / "assets" / "images").mkdir(parents=True)
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 12}})
    audio.make_click_track(pkg / "assets" / "audio" / "t.wav", bpm=120, seconds=6)
    s.pkg_path = pkg
    return s


def test_nothing_is_kept_until_the_audio_has_been_analysed(svc):
    assert svc.handle("audio_cached", {"rel": "assets/audio/t.wav"}) is None
    assert not (svc.pkg_path / "analysis").exists()


def test_the_analysis_is_kept_and_comes_back_the_same_without_analysing_again(svc):
    a = svc.handle("audio_analyze", {"rel": "assets/audio/t.wav"})
    kept = list((svc.pkg_path / "analysis").glob("t.wav.*.json"))
    assert len(kept) == 1
    back = svc.handle("audio_cached", {"rel": "assets/audio/t.wav"})
    assert back == json.loads(json.dumps(a))
    assert abs(back["bpm"] - 120) <= 1 and back["beats"] and back["peaks"]


def test_a_changed_audio_file_never_reuses_an_old_analysis_and_old_copies_are_removed(svc):
    svc.handle("audio_analyze", {"rel": "assets/audio/t.wav"})
    f = svc.pkg_path / "assets" / "audio" / "t.wav"
    audio.make_click_track(f, bpm=90, seconds=8)             # a different file under the same name
    assert svc.handle("audio_cached", {"rel": "assets/audio/t.wav"}) is None
    new = svc.handle("audio_analyze", {"rel": "assets/audio/t.wav"})
    assert abs(new["bpm"] - 90) <= 1
    assert len(list((svc.pkg_path / "analysis").glob("t.wav.*.json"))) == 1


def test_a_damaged_kept_file_is_ignored_and_other_paths_are_refused(svc):
    svc.handle("audio_analyze", {"rel": "assets/audio/t.wav"})
    (kept,) = (svc.pkg_path / "analysis").glob("t.wav.*.json")
    kept.write_text("{ not json", encoding="utf-8")
    assert svc.handle("audio_cached", {"rel": "assets/audio/t.wav"}) is None
    kept.write_text(json.dumps({"beats": "nope", "peaks": []}), encoding="utf-8")
    assert svc.handle("audio_cached", {"rel": "assets/audio/t.wav"}) is None
    for bad in ("assets/images/a.png", "../x.wav", "/etc/passwd"):
        with pytest.raises(AdapterError):
            svc.handle("audio_cached", {"rel": bad})
