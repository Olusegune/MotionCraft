"""Giving a video model files (a start picture, a last frame, reference pictures, a clip to change, sound) and reading what each model can take."""
from __future__ import annotations

import json
import struct
import time
import zlib
from pathlib import Path

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.providers.clients import Fal, Kie, ProviderError
from motioncraft_engine.providers.jobs import JobRefused, Jobs, load_input_files
from motioncraft_engine.providers.registry import Registry, entry, takes_inputs, takes_picture
from motioncraft_engine.sidecar import Service

FIX = Path(__file__).parent / "fixtures"


def _png(path: Path, w=64, h=32):
    raw = b"".join(b"\x00" + bytes((20, 120, 220)) * w for _ in range(h))

    def ch(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))


@pytest.fixture()
def pkg(tmp_path):
    p = tmp_path / "P.motioncraft"
    _png(p / "assets" / "images" / "a.png")
    _png(p / "assets" / "images" / "b.png")
    (p / "assets" / "video").mkdir(parents=True)
    (p / "assets" / "video" / "c.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"0" * 64)
    (p / "assets" / "audio").mkdir(parents=True)
    (p / "assets" / "audio" / "s.wav").write_bytes(b"RIFF\x00\x00\x00\x00WAVE" + b"0" * 64)
    return p


def test_kie_and_fal_video_models_are_marked_as_taking_inputs():
    assert takes_inputs(entry("kie", "bytedance/seedance-2", "Seedance 2.0", "video"))
    assert takes_picture(entry("kie", "kling/v2-1-master-image-to-video", "Kling", "video"))
    assert takes_picture(entry("kie", "wan/2-6-video-to-video", "Wan v2v", "video"))
    assert not takes_picture(entry("kie", "kling/text-to-video", "Kling T2V", "video"))
    assert takes_inputs(entry("fal", "fal-ai/anything", "x", "video"))
    assert not takes_inputs(entry("kie", "midjourney/mj-v7", "MJ", "image"))


def test_input_files_must_be_this_projects_own_and_what_they_say_they_are(pkg):
    got = load_input_files(pkg, {"first_frame_url": {"paths": ["assets/images/a.png"]}, "reference_video_urls": {"paths": ["assets/video/c.mp4"], "list": True},
                                 "reference_audio_urls": {"paths": ["assets/audio/s.wav"], "list": True}})
    assert got["first_frame_url"]["items"][0]["mime"] == "image/jpeg" and got["reference_video_urls"]["items"][0]["kind"] == "video" and got["reference_audio_urls"]["items"][0]["mime"] == "audio/wav"
    for bad in ({"x": {"paths": ["../a.png"]}}, {"x": {"paths": ["/etc/hosts"]}}, {"x": {"paths": ["assets/images/missing.png"]}}, {"x": {"paths": ["assets/brand/a.png"]}},
                {"X": {"paths": ["assets/images/a.png"]}}, {"x": {"paths": []}}, {"x": "assets/images/a.png"}):
        with pytest.raises(JobRefused):
            load_input_files(pkg, bad)
    (pkg / "assets" / "audio" / "fake.wav").write_text("not audio")
    with pytest.raises(JobRefused, match="not a picture, clip or sound"):
        load_input_files(pkg, {"x": {"paths": ["assets/audio/fake.wav"]}})


class RecNet:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def json(self, method, url, headers=None, body=None, timeout=None):
        self.calls.append({"method": method, "url": url, "body": body})
        return self.replies.pop(0)


def test_kie_uploads_each_file_to_kie_and_gives_the_model_their_addresses(pkg):
    files = load_input_files(pkg, {"first_frame_url": {"paths": ["assets/images/a.png"]}, "reference_image_urls": {"paths": ["assets/images/a.png", "assets/images/b.png"], "list": True}})
    net = RecNet([{"success": True, "code": 200, "data": {"downloadUrl": f"https://tempfile.redpandaai.co/u{i}.jpg"}} for i in range(3)] + [{"code": 200, "data": {"taskId": "t1"}}])
    meta = Kie(net, "k").submit("bytedance/seedance-2", "A shot.", {"aspect_ratio": "21:9", "duration": 8, "generate_audio": True, "_files": files})
    ups = [c for c in net.calls if c["url"].endswith("/api/file-base64-upload")]
    assert all(c["url"] == "https://kieai.redpandaai.co/api/file-base64-upload" for c in ups)       # Kie.ai's file service, not api.kie.ai (which answers 404)
    assert len(ups) == 3 and all(c["body"]["base64Data"].startswith("data:image/jpeg;base64,") and c["body"]["uploadPath"] == "motioncraft/image" for c in ups)
    body = net.calls[-1]["body"]
    assert net.calls[-1]["url"].endswith("/api/v1/jobs/createTask") and meta == {"id": "t1"}
    assert body["model"] == "bytedance/seedance-2" and body["input"]["first_frame_url"] == "https://tempfile.redpandaai.co/u0.jpg"
    assert body["input"]["reference_image_urls"] == ["https://tempfile.redpandaai.co/u1.jpg", "https://tempfile.redpandaai.co/u2.jpg"]
    assert body["input"]["aspect_ratio"] == "21:9" and body["input"]["duration"] == 8 and body["input"]["generate_audio"] is True and "_files" not in body["input"]


def test_kie_refuses_a_file_over_its_quick_upload_limit_and_says_why():
    big = {"x": {"list": False, "items": [{"kind": "video", "data": b"0" * (Kie.KIE_UPLOAD_LIMIT + 1), "mime": "video/mp4", "name": "big.mp4"}]}}
    with pytest.raises(ProviderError, match="larger than 10 MB"):
        Kie(RecNet([]), "k").submit("bytedance/seedance-2", "x", {"_files": big})


def test_a_failed_upload_is_an_error_with_kies_reason(pkg):
    files = load_input_files(pkg, {"first_frame_url": {"paths": ["assets/images/a.png"]}})
    with pytest.raises(ProviderError, match="could not take a.png: quota"):
        Kie(RecNet([{"success": False, "code": 402, "msg": "quota"}]), "k").submit("bytedance/seedance-2", "x", {"_files": files})


def test_fal_gets_files_as_data_addresses_one_value_or_a_list(pkg):
    files = load_input_files(pkg, {"image_url": {"paths": ["assets/images/a.png"]}, "reference_image_urls": {"paths": ["assets/images/a.png", "assets/images/b.png"], "list": True}})
    net = RecNet([{"request_id": "r"}])
    Fal(net, "k").submit("fal-ai/x/image-to-video", "Go.", {"duration": "5s", "_files": files})
    b = net.calls[0]["body"]
    assert b["image_url"].startswith("data:image/jpeg;base64,") and len(b["reference_image_urls"]) == 2 and "_files" not in b and b["duration"] == "5s"


class StubClient:
    seen: dict = {}

    def __init__(self, *a, **k):
        pass

    def submit(self, model, prompt, params):
        StubClient.seen = dict(params)
        return {"data": b"\x00\x00\x00\x18ftypmp42" + b"y" * 64}

    def poll(self, model, meta):
        return {"state": "done", "data": meta["data"]}


def _jobs(tmp_path):
    reg = Registry(tmp_path / "reg.json")
    e = entry("kie", "bytedance/seedance-2", "Seedance 2.0", "video", source="discovered")      # a model found by the Kie.ai list
    reg.data["models"]["kie/bytedance/seedance-2"] = e
    return Jobs(reg, net=None, poll_seconds=0.01, client_factory=lambda *a, **k: StubClient())


def test_the_runner_hands_validated_files_to_the_client_and_google_takes_only_a_start_picture(tmp_path, pkg):
    j = _jobs(tmp_path)
    job = j.start(provider="kie", model="bytedance/seedance-2", prompt="A shot.", params={"duration": 6}, api_key="k", package=pkg, spend_token="a", generative_enabled=True, offline=False,
                  files={"first_frame_url": {"paths": ["assets/images/a.png"]}})
    for _ in range(200):
        if j.poll(job["id"])["state"] in ("done", "failed"):
            break
        time.sleep(0.02)
    assert j.poll(job["id"])["state"] == "done" and StubClient.seen["_files"]["first_frame_url"]["items"][0]["mime"] == "image/jpeg"
    with pytest.raises(JobRefused, match="one starting picture"):
        j.start(provider="google", model="veo-3.1-generate-preview", prompt="x", params={}, api_key="k", package=pkg, spend_token="b", generative_enabled=True, offline=False,
                files={"image": {"paths": ["assets/images/a.png"]}, "extra": {"paths": ["assets/images/b.png"]}})
    with pytest.raises(JobRefused, match="does not take pictures"):
        j.start(provider="google", model="gemini-nano-banana-2.1", prompt="x", params={}, api_key="k", package=pkg, spend_token="c", generative_enabled=True, offline=False,
                files={"image": {"paths": ["assets/images/a.png"]}})


def test_model_schema_is_read_from_the_provider_page_and_cached(tmp_path):
    class PageNet:
        n = 0

        def text(self, url, timeout=30):
            PageNet.n += 1
            assert url == "https://docs.kie.ai/market/bytedance/seedance-2.md"
            return (FIX / "kie_seedance2.md").read_text(encoding="utf-8")

        def json(self, *a, **k):
            return json.loads((FIX / "fal_veo3_fast_i2v_openapi.json").read_text(encoding="utf-8"))
    svc = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d", jobs=Jobs(Registry(tmp_path / "r.json"), PageNet()))
    a = svc.handle("model_schema", {"provider": "kie", "model": "bytedance/seedance-2"})
    assert a["caps"]["aspects"][-2:] == ["21:9", "adaptive"] and a["provider"] == "kie"
    svc.handle("model_schema", {"provider": "kie", "model": "bytedance/seedance-2"})
    assert PageNet.n == 1                                                                # the second answer came from the cache
    f = svc.handle("model_schema", {"provider": "fal", "model": "fal-ai/veo3/fast/image-to-video"})
    assert f["caps"]["durations"]["values"] == ["4s", "6s", "8s"]
    assert svc.handle("model_schema", {"provider": "google", "model": "veo-3.1-generate-preview"})["caps"]["aspects"] == ["16:9", "9:16"]
    for bad in ({"provider": "kie", "model": "../x"}, {"provider": "evil", "model": "a/b"}):
        with pytest.raises(JobRefused):
            svc.handle("model_schema", bad)


def test_a_model_can_be_added_by_its_id_and_survives_a_refresh(tmp_path):
    reg = Registry(tmp_path / "reg.json")
    e = reg.add_custom("byteplus", "seedream-5-5-pro-260801", "Seedream 5.5 Pro", "image")
    assert e["source"] == "added" and e["price"]["known"] is False
    assert any(m["model"] == "seedream-5-5-pro-260801" and m["listed"] for m in reg.all())
    assert any(m["model"] == "seedream-5-5-pro-260801" for m in Registry(tmp_path / "reg.json").all())         # kept after a restart
    for bad in (("evil", "x/y", "video"), ("kie", "../etc", "video"), ("kie", "a b", "video"), ("kie", "ok/id", "audio"), ("kie", "", "video")):
        with pytest.raises(ValueError):
            reg.add_custom(bad[0], bad[1], "n", bad[2])


def test_the_service_adds_models_and_refuses_bad_ids_plainly(tmp_path):
    svc = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d")
    r = svc.handle("models_add", {"provider": "kie", "model": "wan/3-0-video-prime", "name": "Wan 3.0 Prime"})
    assert r["added"]["model"] == "wan/3-0-video-prime" and any(m["model"] == "wan/3-0-video-prime" and m["imageInput"] for m in r["models"])
    with pytest.raises(JobRefused, match="exactly as the provider writes it"):
        svc.handle("models_add", {"provider": "kie", "model": "../x"})
