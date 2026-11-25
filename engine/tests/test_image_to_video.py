"""Image to video: a project picture starts a video model's clip. The picture is the project's own, read by the helper, shrunk, and sent only to the model the person
chose; models that cannot take a picture are refused before anything is spent."""
from __future__ import annotations

import base64
import struct
import zlib
from pathlib import Path

import pytest

from motioncraft_engine.providers.clients import Fal, Google
from motioncraft_engine.providers.jobs import MAX_START_PICTURE, JobRefused, Jobs, load_start_picture
from motioncraft_engine.providers.registry import Registry, entry, takes_picture


def png_file(path: Path, w=64, h=32):
    raw = b"".join(b"\x00" + bytes((200, 30, 30)) * w for _ in range(h))

    def ch(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))


@pytest.fixture()
def pkg(tmp_path):
    p = tmp_path / "P.motioncraft"
    png_file(p / "assets" / "images" / "a.png")
    return p


# ------------------------------------------------------------------ which models can start from a picture
def test_only_models_that_can_take_a_picture_are_marked():
    assert takes_picture(entry("google", "veo-3.1-fast-generate-preview", "Veo", "video"))
    assert takes_picture(entry("fal", "fal-ai/kling-video/v2.1/master/image-to-video", "Kling i2v", "video"))
    assert not takes_picture(entry("fal", "fal-ai/kling-video/v2.1/master/text-to-video", "Kling t2v", "video"))
    assert not takes_picture(entry("kie", "kling/v2-1-master-image-to-video", "Kie i2v", "video"))        # needs a hosted picture: not offered
    assert not takes_picture(entry("google", "gemini-nano-banana-2.1", "Nano Banana", "image"))
    assert not takes_picture(entry("byteplus", "seedream-4-5-251128", "Seedream", "image"))


def test_the_model_list_carries_the_flag(tmp_path):
    models = Registry(tmp_path / "reg.json").all()
    veo = next(m for m in models if m["model"].startswith("veo-3.1-fast"))
    assert veo["imageInput"] is True
    assert all(m["imageInput"] is False for m in models if m["media"] == "image")


# ------------------------------------------------------------------ the starting picture is the project's own
@pytest.mark.parametrize("rel", ["../x.png", "/etc/passwd", "assets/images/../../x.png", "assets/video/a.png", "assets/images/sub/a.png", "a.png", "assets/images/missing.png"])
def test_a_starting_picture_outside_the_projects_pictures_is_refused(pkg, rel):
    with pytest.raises(JobRefused):
        load_start_picture(pkg, rel)


def test_a_starting_picture_must_really_be_a_picture_and_not_huge(pkg):
    (pkg / "assets" / "images" / "t.png").write_text("not a picture")
    with pytest.raises(JobRefused, match="PNG, JPEG or WebP"):
        load_start_picture(pkg, "assets/images/t.png")
    big = pkg / "assets" / "images" / "big.png"
    big.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * (MAX_START_PICTURE + 1))
    with pytest.raises(JobRefused, match="too large"):
        load_start_picture(pkg, "assets/images/big.png")


def test_a_big_picture_is_shrunk_to_1920_pixels_and_sent_as_jpeg(pkg):
    png_file(pkg / "assets" / "images" / "wide.png", 3000, 1200)
    out = load_start_picture(pkg, "assets/images/wide.png")
    assert out["mime"] == "image/jpeg" and out["data"][:3] == b"\xff\xd8\xff"
    from PIL import Image
    import io
    assert Image.open(io.BytesIO(out["data"])).size == (1920, 768)


# ------------------------------------------------------------------ the job runner
class StubClient:
    seen: dict = {}

    def __init__(self, *a, **k):
        pass

    def submit(self, model, prompt, params):
        StubClient.seen = {"model": model, "prompt": prompt, "params": dict(params)}
        return {"data": b"\x00\x00\x00\x18ftypmp42" + b"y" * 64}

    def poll(self, model, meta):
        return {"state": "done", "data": meta["data"]}


def jobs(tmp_path):
    reg = Registry(tmp_path / "reg.json")
    return Jobs(reg, net=None, poll_seconds=0.01, client_factory=lambda *a, **k: StubClient())


def start(j, pkg, model, params, token="t1"):
    return j.start(provider="google", model=model, prompt="Animate this still.", params=params, api_key="k", package=pkg, spend_token=token, generative_enabled=True, offline=False)


def test_a_clip_job_hands_the_client_the_picture_not_the_path(tmp_path, pkg):
    j = jobs(tmp_path)
    job = start(j, pkg, "veo-3.1-fast-generate-preview", {"image": "assets/images/a.png", "duration": 8, "aspect_ratio": "16:9"})
    for _ in range(200):
        if j.poll(job["id"])["state"] in ("done", "failed"):
            break
        import time
        time.sleep(0.02)
    assert j.poll(job["id"])["state"] == "done"
    seen = StubClient.seen["params"]
    assert "image" not in seen and seen["_image"]["mime"] == "image/jpeg" and seen["duration"] == 8
    assert j.poll(job["id"])["asset"]["kind"] == "video"


def test_a_model_that_cannot_take_a_picture_is_refused_before_a_spend_is_used(tmp_path, pkg):
    j = jobs(tmp_path)
    with pytest.raises(JobRefused, match="does not start from a picture"):
        j.start(provider="google", model="gemini-nano-banana-2.1", prompt="x", params={"image": "assets/images/a.png"}, api_key="k", package=pkg, spend_token="t2", generative_enabled=True, offline=False)
    # the same token still works afterwards: nothing was spent
    start(j, pkg, "veo-3.1-fast-generate-preview", {"image": "assets/images/a.png"}, token="t2")


def test_a_page_cannot_smuggle_in_its_own_picture_bytes(tmp_path, pkg):
    j = jobs(tmp_path)
    with pytest.raises(JobRefused, match="not allowed"):
        start(j, pkg, "veo-3.1-fast-generate-preview", {"_image": "abc"})


# ------------------------------------------------------------------ what the providers are sent
class RecordNet:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def json(self, method, url, headers=None, body=None, timeout=None):
        self.calls.append({"method": method, "url": url, "body": body})
        return self.reply


IMG = {"data": b"JPEGDATA", "mime": "image/jpeg"}


def test_veo_gets_the_picture_the_prompt_and_the_settings():
    net = RecordNet({"name": "operations/op1"})
    meta = Google(net, "k").submit("veo-3.1-fast-generate-preview", "Slow push-in.", {"aspect_ratio": "16:9", "duration": 8, "resolution": "720p", "negative_prompt": "text, logos",
                                                                                      "person_generation": "allow_adult", "_image": IMG})
    body = net.calls[0]["body"]
    assert meta == {"op": "operations/op1"}
    assert body["instances"][0]["prompt"] == "Slow push-in."
    assert body["instances"][0]["image"] == {"bytesBase64Encoded": base64.b64encode(b"JPEGDATA").decode(), "mimeType": "image/jpeg"}
    assert body["parameters"] == {"aspectRatio": "16:9", "durationSeconds": 8, "resolution": "720p", "negativePrompt": "text, logos", "personGeneration": "allow_adult"}
    assert net.calls[0]["url"].endswith("/models/veo-3.1-fast-generate-preview:predictLongRunning")


def test_veo_text_only_still_works():
    net = RecordNet({"name": "operations/op2"})
    Google(net, "k").submit("veo-3.1-generate-preview", "A sky.", {"aspect_ratio": "16:9"})
    assert "image" not in net.calls[0]["body"]["instances"][0]


def test_fal_gets_the_picture_as_a_data_address_and_nothing_internal_leaks():
    net = RecordNet({"request_id": "r1"})
    Fal(net, "k").submit("fal-ai/kling-video/v2.1/master/image-to-video", "Walks in.", {"duration": "5", "_image": IMG})
    body = net.calls[0]["body"]
    assert body["image_url"] == "data:image/jpeg;base64," + base64.b64encode(b"JPEGDATA").decode()
    assert "_image" not in body and body["duration"] == "5" and body["prompt"] == "Walks in."


# ------------------------------------------------------------------ Google's own list of what this key can start
class ListNet:
    def __init__(self, pages):
        self.pages, self.urls = list(pages), []

    def json(self, method, url, headers=None, body=None, timeout=None):
        self.urls.append(url)
        return self.pages.pop(0)


def test_google_discovery_keeps_only_veo_models_that_can_start_a_clip():
    from motioncraft_engine.providers.registry import discover_google
    net = ListNet([{"models": [
        {"name": "models/veo-3.0-generate-001", "displayName": "Veo 3", "supportedGenerationMethods": ["predictLongRunning"]},
        {"name": "models/veo-9-nothing", "displayName": "Not a video generator", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]}], "nextPageToken": "p2"},
        {"models": [{"name": "models/veo-3.0-fast-generate-001", "supportedGenerationMethods": ["predictLongRunning"]}]}])
    found = discover_google(net, "k")
    assert [e["model"] for e in found] == ["veo-3.0-generate-001", "veo-3.0-fast-generate-001"]
    assert all(e["media"] == "video" and e["provider"] == "google" for e in found) and "pageToken=p2" in net.urls[1]


def test_after_google_answers_the_built_in_names_it_lacks_are_hidden_and_the_real_ones_are_offered(tmp_path):
    reg = Registry(tmp_path / "reg.json")
    net = ListNet([{"models": [{"name": "models/veo-3.0-generate-001", "displayName": "Veo 3", "supportedGenerationMethods": ["predictLongRunning"]}]}])
    res = reg.refresh(net, {"google": "k"}, providers=["google"])
    assert res["google"]["ok"]
    veo = {m["model"]: m for m in reg.all() if m["provider"] == "google" and m["model"].startswith("veo-")}
    assert veo["veo-3.0-generate-001"]["listed"] and veo["veo-3.0-generate-001"]["imageInput"]
    assert veo["veo-3.1-fast-generate-preview"]["listed"] is False and veo["veo-3.1-lite-generate-preview"]["listed"] is False
    again = Registry(tmp_path / "reg.json")                                          # remembered after a restart
    assert next(m for m in again.all() if m["model"] == "veo-3.1-generate-preview")["listed"] is False
    assert reg.status()["google"]["stale"] is False


def test_google_refresh_without_a_key_says_so_and_changes_nothing(tmp_path):
    reg = Registry(tmp_path / "reg.json")
    res = reg.refresh(ListNet([]), {}, providers=["google"])
    assert res["google"]["ok"] is False and "Google key" in res["google"]["error"]
    assert next(m for m in reg.all() if m["model"] == "veo-3.1-generate-preview")["listed"] is True


def test_fal_tools_that_are_not_video_generators_are_not_listed():
    from motioncraft_engine.providers.registry import discover_fal

    class FalNet:
        def json(self, method, url, headers=None, body=None, timeout=None):
            if "category=image-to-video" not in url:
                return {"models": [], "has_more": False}
            return {"models": [
                {"endpoint_id": "fal-ai/veo3/fast/image-to-video", "metadata": {"display_name": "Veo 3 Fast [Image to Video]"}},
                {"endpoint_id": "fal-ai/heygen/avatar6/image-to-video", "metadata": {"display_name": "HeyGen Avatar 6 Image to Video"}},
                {"endpoint_id": "fal-ai/kling-video/o1/standard/image-to-video", "metadata": {"display_name": "Kling O1 First Frame Last Frame to Video [Standard]"}},
                {"endpoint_id": "fal-ai/h3-max/lip-sync/image-to-video", "metadata": {"display_name": "H3 Max Lip Sync Image to Video"}},
                {"endpoint_id": "fal-ai/wan/v2.6/image-to-video", "metadata": {"display_name": "Wan v2.6 Image to Video"}}], "has_more": False}
    got = [e["model"] for e in discover_fal(FalNet(), "k")]
    assert got == ["fal-ai/veo3/fast/image-to-video", "fal-ai/wan/v2.6/image-to-video"]


def test_a_google_key_that_lists_no_veo_is_an_answer_that_hides_the_guessed_names(tmp_path):
    reg = Registry(tmp_path / "reg.json")
    net = ListNet([{"models": [{"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]}]}])
    res = reg.refresh(net, {"google": "k"}, providers=["google"])
    assert res["google"]["ok"] is True and res["google"]["models"] == 0 and "no Veo" in res["google"]["note"]
    assert all(m["listed"] is False for m in reg.all() if m["provider"] == "google" and m["media"] == "video")


def test_a_page_token_from_the_reply_is_escaped_in_the_next_request():
    from motioncraft_engine.providers.registry import discover_google
    net = ListNet([{"models": [], "nextPageToken": "a&key=evil#x"}, {"models": []}])
    discover_google(net, "k")
    assert net.urls[1].endswith("pageToken=a%26key%3Devil%23x") and "key=evil" not in net.urls[1].replace("%3D", "=").split("pageToken=")[0]
