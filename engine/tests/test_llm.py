"""Language-model router tests against a local fake server (no provider key was available: nothing here touched a real model)."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from motioncraft_engine.llm import PROVIDERS, Llm, LlmError, LlmRefused, json_text
from motioncraft_engine.providers.net import Net
from motioncraft_engine.sidecar import Service

SCHEMA = {"type": "object", "properties": {"shot": {"type": "string"}}, "required": ["shot"]}


class Fake(BaseHTTPRequestHandler):
    calls: list = []
    mode = "native"   # native | no_schema | think | bad

    def log_message(self, *a):
        pass

    def _send(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        Fake.calls.append(("GET", self.path, dict(self.headers), None))
        self._send({"data": [{"id": "b-model"}, {"id": "a-model"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Fake.calls.append(("POST", self.path, dict(self.headers), body))
        if self.path.endswith("/messages"):
            return self._send({"content": [{"type": "text", "text": '```json\n{"shot": "claude"}\n```'}], "usage": {"input_tokens": 3}})
        fmt = (body.get("response_format") or {}).get("type")
        if Fake.mode == "no_schema" and fmt == "json_schema":
            return self._send({"error": "unsupported"}, 400)
        text = '{"shot": "wide"}'
        if Fake.mode == "think":
            text = '<think>hmm</think>```json\n{"shot": "thought"}\n```'
        if Fake.mode == "bad":
            text = "no json here"
        self._send({"choices": [{"message": {"content": text}}], "usage": {"total_tokens": 5}})


@pytest.fixture()
def server():
    s = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    Fake.calls, Fake.mode = [], "native"
    yield f"http://127.0.0.1:{s.server_port}"
    s.shutdown()


def llm(tmp_path, base=None):
    cloud = Net(extra_hosts={"127.0.0.1"}, allow_http=True)
    return Llm(tmp_path / "llm.json", net=cloud, bases={"anthropic": base + "/v1", "openai": base + "/v1"} if base else None)


def test_no_provider_is_a_normal_state(tmp_path):
    st = Llm(tmp_path / "llm.json").status()
    assert st["config"]["provider"] is None and not st["ready"] and st["manual_mode_works"]
    assert {p["id"] for p in st["providers"]} == {"openai", "anthropic", "gemini", "openrouter", "ollama", "lmstudio", "inkling"}
    for p in PROVIDERS.values():
        assert set(p["declaration"]) == {"offline", "cost", "capabilities", "limits"}


def test_settings_validate_and_hold_no_secrets(tmp_path):
    m = Llm(tmp_path / "llm.json")
    c = m.save("ollama", "llama3.1", "http://127.0.0.1:11434")
    assert c == {"provider": "ollama", "model": "llama3.1", "base_url": "http://127.0.0.1:11434/v1"}
    for bad_url in ("https://evil.example/v1", "http://10.0.0.5:11434/v1", "http://user:pw@127.0.0.1/v1", "http://127.0.0.1.evil.com/v1"):
        with pytest.raises(LlmRefused):
            m.save("lmstudio", "x", bad_url)
    with pytest.raises(LlmRefused):
        m.save("ollama", "bad model;rm", "")
    with pytest.raises(LlmRefused):
        m.save("suno", "x")
    assert m.save("anthropic", "claude-x")["base_url"] == ""   # cloud base is fixed, never user-set
    assert m.save(None)["provider"] is None
    assert "key" not in (tmp_path / "llm.json").read_text().lower()


def test_local_call_needs_no_token_or_key_and_works_offline(tmp_path, server):
    m = Llm(tmp_path / "llm.json")
    m.save("inkling", "i-1", server)
    r = m.complete(provider="inkling", model="i-1", messages=[{"role": "user", "content": "hi"}], schema=SCHEMA, offline=True)
    assert r["json"] == {"shot": "wide"}
    post = [c for c in Fake.calls if c[0] == "POST"][0]
    assert post[1] == "/v1/chat/completions" and "Authorization" not in post[2]
    assert m.models("inkling", server)["models"] == ["a-model", "b-model"]


def test_schema_falls_back_and_reasoning_is_stripped(tmp_path, server):
    m = Llm(tmp_path / "llm.json")
    m.save("ollama", "x", server)
    msg = [{"role": "user", "content": "go"}]
    Fake.mode = "no_schema"
    assert m.complete(provider="ollama", model="x", messages=msg, schema=SCHEMA)["json"] == {"shot": "wide"}
    fmts = [(c[3].get("response_format") or {}).get("type") for c in Fake.calls if c[0] == "POST"]
    assert fmts == ["json_schema", "json_object"]
    Fake.mode = "think"
    assert m.complete(provider="ollama", model="x", messages=msg, schema=SCHEMA)["json"] == {"shot": "thought"}
    Fake.mode = "bad"
    with pytest.raises(LlmError):
        m.complete(provider="ollama", model="x", messages=msg, schema=SCHEMA)


def test_cloud_is_refused_without_token_key_or_when_offline_and_sends_nothing(tmp_path, server):
    m = llm(tmp_path, server)
    msg = [{"role": "user", "content": "hi"}]
    for kw in ({"spend_token": "", "api_key": "k"}, {"spend_token": "t", "api_key": ""}, {"spend_token": "t", "api_key": "k", "offline": True}):
        with pytest.raises(LlmRefused):
            m.complete(provider="openai", model="gpt-x", messages=msg, **kw)
    assert Fake.calls == []


def test_cloud_calls_send_the_key_in_a_header_only(tmp_path, server):
    m = llm(tmp_path, server)
    msg = [{"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]
    r = m.complete(provider="openai", model="gpt-x", messages=msg, api_key="sk-secret-123", spend_token="t")
    assert r["text"] == '{"shot": "wide"}'
    c = Fake.calls[-1]
    assert c[2]["Authorization"] == "Bearer sk-secret-123" and "sk-secret" not in c[1] and "sk-secret" not in json.dumps(c[3])
    a = m.complete(provider="anthropic", model="claude-x", messages=msg, schema=SCHEMA, api_key="ant-key", spend_token="t2")
    c = Fake.calls[-1]
    assert a["json"] == {"shot": "claude"} and c[1] == "/v1/messages" and {k.lower(): v for k, v in c[2].items()}["x-api-key"] == "ant-key"
    assert c[3]["system"].startswith("be brief") and all(x["role"] != "system" for x in c[3]["messages"])


def test_bad_messages_and_unknown_provider_are_refused(tmp_path):
    m = Llm(tmp_path / "llm.json")
    with pytest.raises(LlmRefused):
        m.complete(provider="ollama", model="x", messages=[{"role": "tool", "content": "x"}])
    with pytest.raises(LlmRefused):
        m.complete(provider="suno", model="x", messages=[{"role": "user", "content": "x"}])


def test_json_text_helper():
    assert json_text('<think>a</think>```json\n{"a": 1}\n```') == '{"a": 1}'


def test_sidecar_exposes_the_methods(tmp_path):
    svc = Service(lambda pkg: None, data_dir=tmp_path)
    assert svc.handle("llm_status", {})["config"]["provider"] is None
    assert svc.handle("llm_set", {"provider": "ollama", "model": "m"})["provider"] == "ollama"
    assert svc.handle("llm_status", {"offline": True})["ready"] is True   # local stays available offline
    svc.handle("llm_set", {"provider": "openai", "model": "gpt-x"})
    assert svc.handle("llm_status", {"offline": True})["ready"] is False
