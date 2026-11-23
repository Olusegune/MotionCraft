"""Provider layer tests against a local fake server (no live provider was reachable: no keys). Flows follow FilmCrafter3's clients."""
from __future__ import annotations

import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from motioncraft_engine.providers.jobs import JobRefused, Jobs
from motioncraft_engine.providers.net import Net, NetError
from motioncraft_engine.providers.registry import BUILTIN, Registry, discover_kie, entry
from motioncraft_engine.sidecar import Service

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"y" * 64


class Fake(BaseHTTPRequestHandler):
    calls: list = []
    polls: dict = {}

    def log_message(self, *a):  # silence
        pass

    def _send(self, obj=None, raw: bytes | None = None, status=200):
        body = raw if raw is not None else json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        Fake.calls.append(("GET", self.path, dict(self.headers)))
        p, base = self.path, f"http://127.0.0.1:{self.server.server_port}"
        if p.startswith("/fal/status"):
            n = Fake.polls["fal"] = Fake.polls.get("fal", 0) + 1
            return self._send({"status": "COMPLETED" if n > 1 else "IN_QUEUE"})
        if p.startswith("/fal/response"):
            return self._send({"images": [{"url": f"{base}/file.png"}]})
        if p.startswith("/kie/jobs/recordInfo"):
            return self._send({"data": {"state": "success", "resultJson": json.dumps({"resultUrls": [f"{base}/file.mp4"]}), "creditsConsumed": 12}})
        if p.startswith("/kie/mj/record-info"):
            return self._send({"data": {"successFlag": 1, "resultInfoJson": {"resultUrls": [{"resultUrl": f"{base}/file.png"}]}}})
        if p.startswith("/google/operations/op1"):
            return self._send({"done": True, "response": {"generateVideoResponse": {"generatedSamples": [{"video": {"uri": f"{base}/file.mp4"}}]}}})
        if p == "/file.png":
            return self._send(raw=PNG)
        if p == "/file.mp4":
            return self._send(raw=MP4)
        if p == "/file.html":
            return self._send(raw=b"<html>not media</html>")
        self._send({"error": "nope"}, status=404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        Fake.calls.append(("POST", self.path, dict(self.headers), body))
        base = f"http://127.0.0.1:{self.server.server_port}"
        p = self.path
        if p.startswith("/fal/queue/"):
            return self._send({"request_id": "r1", "status_url": f"{base}/fal/status", "response_url": f"{base}/fal/response"})
        if p == "/kie/jobs/createTask":
            return self._send({"code": 200, "data": {"taskId": "t1"}})
        if p == "/kie/mj/generate":
            return self._send({"code": 200, "data": {"taskId": "m1"}})
        if p == "/byteplus":
            return self._send({"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
        if p == "/openai":
            return self._send({"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
        if p.endswith(":generateContent"):
            return self._send({"candidates": [{"content": {"parts": [{"inlineData": {"data": base64.b64encode(PNG).decode()}}]}}]})
        if p.endswith(":predictLongRunning"):
            return self._send({"name": "operations/op1"})
        self._send({"error": "nope"}, status=404)


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture
def pkg(tmp_path):
    p = tmp_path / "P.motioncraft"
    p.mkdir()
    return p


def make_jobs(server, tmp_path) -> Jobs:
    net = Net(extra_hosts={"127.0.0.1"}, allow_http=True)
    kw = {"fal": {"queue_base": f"{server}/fal/queue"}, "kie": {"base": f"{server}/kie"}, "byteplus": {"url": f"{server}/byteplus"},
          "openai": {"url": f"{server}/openai"}, "google": {"base": f"{server}/google"}}
    return Jobs(Registry(tmp_path / "reg.json"), net, poll_seconds=0.01, timeout_seconds=10, client_kwargs=kw)


def go(jobs, pkg, provider, model, token="tok", **over):
    a = dict(provider=provider, model=model, prompt="a red kite over a lake", params={}, api_key="KEY", package=pkg, spend_token=token,
             generative_enabled=True, offline=False)
    a.update(over)
    j = jobs.start(**a)
    for _ in range(300):
        s = jobs.poll(j["id"])
        if s["state"] in ("done", "failed", "cancelled"):
            return s
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def with_model(jobs, provider, model, media):
    jobs.reg.data["models"][f"{provider}/{model}"] = entry(provider, model, model, media, source="discovered")


def test_registry_has_every_filmcrafter3_builtin_image_and_video_model():
    names = {(e["provider"], e["model"]) for e in BUILTIN}
    assert ("byteplus", "dola-seedream-5-0-pro-260628") in names and ("google", "veo-3.1-fast-generate-preview") in names
    assert ("openai", "gpt-image-2.5-flare") in names and ("kie", "midjourney/mj-v7") in names
    assert len(BUILTIN) == 17
    assert all(e["media"] in ("image", "video") for e in BUILTIN)
    assert next(e for e in BUILTIN if e["model"] == "veo-3.1-generate-preview")["price"]["known"] is False


def test_fal_flow_writes_an_asset_with_provenance(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    with_model(jobs, "fal", "fal-ai/flux/dev", "image")
    s = go(jobs, pkg, "fal", "fal-ai/flux/dev")
    assert s["state"] == "done", s
    a = s["asset"]
    assert a["path"].startswith("assets/images/gen-") and (pkg / a["path"]).read_bytes() == PNG
    assert a["provenance"]["provider"] == "fal" and a["provenance"]["costReported"] is False
    assert s["estimate"]["label"] == "Unknown"
    auth = [c for c in Fake.calls if c[0] == "POST" and c[1].startswith("/fal/queue/")][-1][2]
    assert auth["Authorization"] == "Key KEY"


def test_kie_video_reports_its_own_credits(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    with_model(jobs, "kie", "kling/v3", "video")
    s = go(jobs, pkg, "kie", "kling/v3")
    assert s["state"] == "done" and s["asset"]["path"].endswith(".mp4")
    p = s["asset"]["provenance"]
    assert p["costReported"] is True and p["costUnit"] == "kie_credits" and p["costValue"] == 12.0


def test_kie_midjourney(server, tmp_path, pkg):
    s = go(make_jobs(server, tmp_path), pkg, "kie", "midjourney/mj-v7")
    assert s["state"] == "done" and s["asset"]["kind"] == "image"


def test_byteplus_seedream_has_a_known_estimate(server, tmp_path, pkg):
    s = go(make_jobs(server, tmp_path), pkg, "byteplus", "seedream-4-5-251128")
    assert s["state"] == "done"
    assert s["estimate"] == {"value": 0.04, "unit": "usd_per_output", "label": "Estimate"}
    assert s["asset"]["provenance"]["costReported"] is False and s["asset"]["provenance"]["costValue"] == 0.04


def test_openai_and_google_image_and_veo(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    assert go(jobs, pkg, "openai", "gpt-image-2")["state"] == "done"
    assert go(jobs, pkg, "google", "gemini-3-pro-image", token="t2")["state"] == "done"
    v = go(jobs, pkg, "google", "veo-3.1-fast-generate-preview", token="t3")
    assert v["state"] == "done" and v["asset"]["path"].endswith(".mp4")


# ---------------------------------------------------------------- the rules from ADR-0005
@pytest.mark.parametrize("over,msg", [
    ({"generative_enabled": False}, "off"),
    ({"offline": True}, "Offline"),
    ({"spend_token": ""}, "spend confirmation"),
    ({"api_key": ""}, "key"),
    ({"prompt": "  "}, "prompt"),
    ({"params": {"Bad-Key": 1}}, "not allowed"),
    ({"params": {"size": "x" * 500}}, "not allowed"),
    ({"model": "nope/not-a-model"}, "registry"),
])
def test_refusals_happen_before_anything_is_sent(server, tmp_path, pkg, over, msg):
    jobs = make_jobs(server, tmp_path)
    before = len(Fake.calls)
    with pytest.raises(JobRefused, match=msg):
        a = dict(provider="byteplus", model="seedream-4-5-251128", prompt="p", params={}, api_key="K", package=pkg, spend_token="t",
                 generative_enabled=True, offline=False)
        a.update(over)
        jobs.start(**a)
    assert len(Fake.calls) == before


def test_a_spend_token_works_once(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    assert go(jobs, pkg, "byteplus", "seedream-4-5-251128", token="one")["state"] == "done"
    with pytest.raises(JobRefused, match="already used"):
        jobs.start(provider="byteplus", model="seedream-4-5-251128", prompt="p", params={}, api_key="K", package=pkg, spend_token="one",
                   generative_enabled=True, offline=False)


def test_package_must_be_a_motioncraft_folder(server, tmp_path):
    jobs = make_jobs(server, tmp_path)
    with pytest.raises(JobRefused, match="package"):
        jobs.start(provider="byteplus", model="seedream-4-5-251128", prompt="p", params={}, api_key="K", package=tmp_path, spend_token="t",
                   generative_enabled=True, offline=False)


# ---------------------------------------------------------------- network safety
def test_net_refuses_plain_http_unknown_hosts_and_private_downloads(tmp_path):
    net = Net()
    with pytest.raises(NetError, match="https"):
        net.json("GET", "http://api.kie.ai/x")
    with pytest.raises(NetError, match="allowed provider host"):
        net.json("GET", "https://evil.example.com/x")
    with pytest.raises(NetError, match="private"):
        net.download("https://127.0.0.1/file.png", tmp_path, "a", "image")
    with pytest.raises(NetError, match="https"):
        net.download("http://example.com/file.png", tmp_path, "a", "image")


def test_downloads_that_are_not_media_are_refused_and_cleaned_up(server, tmp_path):
    net = Net(extra_hosts={"127.0.0.1"}, allow_http=True)
    with pytest.raises(NetError, match="not a picture or video"):
        net.download(f"{server}/file.html", tmp_path, "x", "image")
    assert not list(tmp_path.glob("x*"))


def test_a_provider_that_returns_garbage_fails_the_job_without_crashing(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    with_model(jobs, "fal", "fal-ai/other/model", "image")
    jobs._kw["fal"] = {"queue_base": f"{server}/missing"}        # 404 from the fake server
    s = go(jobs, pkg, "fal", "fal-ai/other/model")
    assert s["state"] == "failed" and "404" in s["error"]


# ---------------------------------------------------------------- registry
LLMS = """- Video Models > Kling [Kling 3.0](https://docs.kie.ai/market/kling/v3.md)
- Video Models > Topaz [Video Upscale](https://docs.kie.ai/market/topaz/video-upscale.md)
- Image Models > Seedream [Seedream 4.5](https://docs.kie.ai/market/bytedance/seedream-v4.md)
- Image Models > Cn [x](https://docs.kie.ai/market/cn/skip.md)
"""


class TextNet(Net):
    def text(self, url, timeout=30):
        return LLMS


def test_kie_discovery_skips_tools_and_keeps_generators():
    found = discover_kie(TextNet())
    assert [e["model"] for e in found] == ["kling/v3", "bytedance/seedream-v4"]
    assert [e["media"] for e in found] == ["video", "image"]


def test_refresh_adds_never_removes_and_failures_change_nothing(tmp_path):
    reg = Registry(tmp_path / "r.json")
    res = reg.refresh(TextNet(), {}, ["kie"])
    assert res["kie"]["ok"] and any(e["model"] == "kling/v3" for e in reg.all())

    class Later(TextNet):
        def text(self, url, timeout=30):
            return "- Image Models > Other [Only One](https://docs.kie.ai/market/other/one.md)"
    reg.refresh(Later(), {}, ["kie"])
    old = reg.get("kie", "kling/v3")
    assert old is not None and old["listed"] is False            # kept, marked not listed

    class Down(Net):
        def text(self, url, timeout=30):
            raise NetError("no network")
    before = json.dumps(reg.data, sort_keys=True)
    assert reg.refresh(Down(), {}, ["kie"])["kie"]["ok"] is False
    assert json.dumps(reg.data, sort_keys=True) == before
    assert Registry(tmp_path / "r.json").get("kie", "kling/v3") is not None   # survives a restart
    assert reg.refresh(Net(), {}, ["fal"])["fal"]["ok"] is False             # no key: says so


# ---------------------------------------------------------------- sidecar
def test_sidecar_lists_models_and_refuses_generation_when_off(server, tmp_path, pkg):
    from motioncraft_engine.adapter import MockAdapter
    svc = Service(lambda p: MockAdapter(), data_dir=tmp_path, jobs=make_jobs(server, tmp_path))
    assert len(svc.handle("models", {})["models"]) >= 17
    with pytest.raises(JobRefused):
        svc.handle("generate_start", {"package": str(pkg), "provider": "byteplus", "model": "seedream-4-5-251128", "prompt": "p",
                                      "api_key": "K", "spend_token": "t"})
    j = svc.handle("generate_start", {"package": str(pkg), "provider": "byteplus", "model": "seedream-4-5-251128", "prompt": "p",
                                      "api_key": "K", "spend_token": "t9", "generative_enabled": True})
    for _ in range(100):
        s = svc.handle("generate_poll", {"job": j["id"]})
        if s["state"] == "done":
            break
        time.sleep(0.02)
    assert s["state"] == "done"


def test_model_ids_that_could_escape_a_url_path_are_refused(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    for bad in ("fal-ai/../../etc", "a b", "x?y=1", "../x", "a#b"):
        with pytest.raises(JobRefused, match="not allowed"):
            jobs.start(provider="fal", model=bad, prompt="p", params={}, api_key="K", package=pkg, spend_token=f"t-{bad}", generative_enabled=True, offline=False)


def test_discovery_drops_ids_with_path_tricks(tmp_path):
    class Evil(Net):
        def text(self, url, timeout=30):
            return ("- Image Models > X [Bad](https://docs.kie.ai/market/a/../../b.md)\n"
                    "- Image Models > X [Good](https://docs.kie.ai/market/ok/model.md)")
    reg = Registry(tmp_path / "r.json")
    reg.refresh(Evil(), {}, ["kie"])
    ids = [e["model"] for e in reg.all() if e["provider"] == "kie" and e["source"] == "discovered"]
    assert ids == ["ok/model"]


def test_at_most_four_generations_run_at_once(server, tmp_path, pkg):
    jobs = make_jobs(server, tmp_path)
    jobs.poll_s = 5
    with_model(jobs, "fal", "fal-ai/slow/model", "image")
    jobs._kw["fal"] = {"queue_base": f"{server}/fal/queue"}
    Fake.polls["fal"] = -1000                      # the fake keeps answering IN_QUEUE
    ids = []
    for i in range(4):
        ids.append(jobs.start(provider="fal", model="fal-ai/slow/model", prompt="p", params={}, api_key="K", package=pkg, spend_token=f"c{i}", generative_enabled=True, offline=False)["id"])
    with pytest.raises(JobRefused, match="already running"):
        jobs.start(provider="fal", model="fal-ai/slow/model", prompt="p", params={}, api_key="K", package=pkg, spend_token="c5", generative_enabled=True, offline=False)
    for i in ids:
        jobs.cancel(i)
    Fake.polls["fal"] = 0
