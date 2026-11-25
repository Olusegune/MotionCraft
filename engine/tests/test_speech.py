"""Voiceover: speech from text through official providers only, saved in the project, placed at a scene's start."""
from __future__ import annotations

import base64
import struct

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.providers import speech
from motioncraft_engine.providers.clients import ProviderError
from motioncraft_engine.providers.jobs import JobRefused, Jobs
from motioncraft_engine.providers.registry import Registry
from motioncraft_engine.sidecar import Service

WAV = speech.wav(b"\x01\x00" * 480)


class RecNet:
    def __init__(self, bytes_reply=None, json_reply=None):
        self.bytes_reply, self.json_reply, self.calls = bytes_reply, json_reply, []

    def post_bytes(self, url, *, headers=None, body=None, timeout=120, limit=0):
        self.calls.append({"url": url, "headers": headers, "body": body})
        return self.bytes_reply

    def json(self, method, url, headers=None, body=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "body": body})
        return self.json_reply


def test_only_official_providers_make_voices():
    assert speech.SPEECH_PROVIDERS == ("openai", "google")
    assert {m["provider"] for m in speech.catalogue()} == {"openai", "google"}
    for p in ("kie", "fal", "byteplus", "suno"):
        with pytest.raises(ProviderError, match="official providers only"):
            speech.synthesize(RecNet(), p, "k", "x", "Hello", "alloy")


def test_openai_gets_the_text_the_voice_the_delivery_and_a_pace_inside_its_limits():
    net = RecNet(bytes_reply=WAV)
    data, ext = speech.synthesize(net, "openai", "KEY", "gpt-4o-mini-tts", "At Type One, a civilization harnesses energy.", "coral", "Calm, awed, quiet confidence.", 3.0)
    c = net.calls[0]
    assert c["url"] == "https://api.openai.com/v1/audio/speech" and c["headers"] == {"Authorization": "Bearer KEY"}
    assert c["body"] == {"model": "gpt-4o-mini-tts", "input": "At Type One, a civilization harnesses energy.", "voice": "coral", "response_format": "wav", "speed": 1.5,
                         "instructions": "Calm, awed, quiet confidence."}
    assert ext == ".wav" and data[:4] == b"RIFF"


def test_a_model_without_steering_is_not_sent_instructions():
    net = RecNet(bytes_reply=WAV)
    speech.synthesize(net, "openai", "k", "tts-1-hd", "Hello there.", "alloy", "Whisper it.")
    assert "instructions" not in net.calls[0]["body"]


def test_google_gets_the_style_in_the_text_and_raw_samples_become_a_wav_file():
    pcm = b"\x10\x00" * 2400
    net = RecNet(json_reply={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;rate=24000", "data": base64.b64encode(pcm).decode()}}]}}]})
    data, ext = speech.synthesize(net, "google", "GK", "gemini-2.5-flash-preview-tts", "What would you put into a universe?", "Kore", "Say it softly, with wonder")
    body = net.calls[0]["body"]
    assert net.calls[0]["url"].endswith("/models/gemini-2.5-flash-preview-tts:generateContent") and net.calls[0]["headers"] == {"x-goog-api-key": "GK"}
    assert body["contents"][0]["parts"][0]["text"] == "Say it softly, with wonder: What would you put into a universe?"
    assert body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Kore" and body["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert ext == ".wav" and data[:4] == b"RIFF" and data[8:12] == b"WAVE" and struct.unpack("<I", data[24:28])[0] == 24000 and data[44:] == pcm


def test_bad_requests_are_refused_with_a_reason_before_anything_is_sent():
    net = RecNet(bytes_reply=WAV)
    for args, msg in ((("openai", "k", "nope", "Hi.", "alloy"), "not one MotionCraft offers"), (("openai", "k", "gpt-4o-mini-tts", "Hi.", "not-a-voice"), "is not a voice"),
                      (("openai", "k", "gpt-4o-mini-tts", "  ", "alloy"), "1 to 4000"), (("openai", "k", "gpt-4o-mini-tts", "x" * 4001, "alloy"), "1 to 4000")):
        with pytest.raises(ProviderError, match=msg):
            speech.synthesize(net, *args)
    assert net.calls == []
    with pytest.raises(ProviderError, match="did not return audio"):
        speech.synthesize(RecNet(bytes_reply=b"not audio"), "openai", "k", "gpt-4o-mini-tts", "Hello.", "alloy")
    with pytest.raises(ProviderError, match="no audio"):
        speech.synthesize(RecNet(json_reply={"candidates": []}), "google", "k", "gemini-2.5-flash-preview-tts", "Hello.", "Kore")


@pytest.fixture()
def svc(tmp_path):
    net = RecNet(bytes_reply=WAV)
    s = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d", jobs=Jobs(Registry(tmp_path / "r.json"), net))
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 24, "duration": 30}})
    s.pkg_path, s.net = pkg, net  # type: ignore[attr-defined]
    return s


def gen(svc, **kw):
    args = dict(package=str(svc.pkg_path), provider="openai", model="gpt-4o-mini-tts", text="It starts with a light coming on.", voice="coral", instructions="Soft, curious.", api_key="k",
                spend_token="t", generative_enabled=True, offline=False)
    args.update(kw)
    return svc.handle("speech_generate", args)


def test_a_voiceover_is_saved_in_the_project_with_its_provenance(svc):
    r = gen(svc)
    assert r["path"].startswith("assets/audio/vo-") and r["path"].endswith(".wav") and (svc.pkg_path / r["path"]).read_bytes()[:4] == b"RIFF"
    assert r["provenance"]["provider"] == "openai" and r["provenance"]["model"] == "gpt-4o-mini-tts" and "It starts with a light" in r["provenance"]["prompt"] and r["provenance"]["costReported"] is False


@pytest.mark.parametrize("kw,msg", [({"generative_enabled": False}, "Generative models are off"), ({"offline": True}, "Offline mode"), ({"spend_token": ""}, "spend confirmation"),
                                    ({"api_key": ""}, "Add your openai key"), ({"provider": "kie"}, "official providers only")])
def test_a_voiceover_is_refused_without_the_settings_the_token_and_the_key(svc, kw, msg):
    with pytest.raises((JobRefused, Exception), match=msg):
        gen(svc, **kw)
    assert svc.net.calls == []


def test_voiceovers_are_placed_at_their_scenes_start_inside_the_composition(svc):
    pkg = svc.pkg_path
    (pkg / "assets" / "audio").mkdir(parents=True, exist_ok=True)
    (pkg / "assets" / "audio" / "vo-a.wav").write_bytes(WAV)
    (pkg / "assets" / "audio" / "vo-b.wav").write_bytes(WAV)
    r = svc.handle("place_audio", {"items": [{"rel": "assets/audio/vo-a.wav", "t_in": 0}, {"rel": "assets/audio/vo-b.wav", "t_in": 8}]})
    assert len(r["placed"]) == 2
    for bad in ([], "x", [{"rel": "assets/images/a.png", "t_in": 0}], [3]):
        with pytest.raises(Exception):
            svc.handle("place_audio", {"items": bad})


def test_the_voice_catalogue_is_offered_to_the_page(svc):
    cat = svc.handle("speech_models", {})["models"]
    assert any(m["model"] == "gpt-4o-mini-tts" and m["instructions"] and "coral" in m["voices"] for m in cat)
    assert any(m["provider"] == "google" and "Kore" in m["voices"] for m in cat)


def test_audio_levels_are_set_in_decibels_for_both_channels_and_bad_input_is_refused(svc):
    pkg = svc.pkg_path
    (pkg / "assets" / "audio").mkdir(parents=True, exist_ok=True)
    (pkg / "assets" / "audio" / "m.wav").write_bytes(WAV)
    lid = svc.handle("place_audio", {"items": [{"rel": "assets/audio/m.wav", "t_in": 0}]})["placed"][0]
    assert svc.handle("set_audio_level", {"layers": [lid], "db": -10})["level"] == -10.0
    assert svc.handle("set_audio_level", {"layers": [lid], "db": -99})["level"] == -48.0      # kept inside what a mix can use
    assert svc.handle("set_audio_level", {"layers": [lid], "db": 40})["level"] == 6.0
    for bad in ({"layers": [], "db": -6}, {"layers": [lid], "db": "loud"}, {"layers": [lid], "db": True}, {"layers": list(range(30)), "db": -6}):
        with pytest.raises(Exception):
            svc.handle("set_audio_level", bad)
