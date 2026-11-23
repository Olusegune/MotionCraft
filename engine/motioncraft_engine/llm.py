"""Language-model router (P1-05): the one place the Director, Builder and QA agents will get text and JSON from a model.

Ported in idea from FilmCrafter3 `llm.py` at ac99ec9 (see docs/PORT_LEDGER.md), rewritten to MotionCraft's rules:
  * Seven providers: OpenAI, Anthropic, Google Gemini and OpenRouter (cloud, paid, need a key), Ollama, LM Studio and
    Inkling (on this computer, free). All but Anthropic speak the OpenAI chat API.
  * Local providers may only be reached on a loopback address (127.0.0.1, localhost, ::1), over http.
  * Cloud providers are https only, allow-listed hosts (providers/net.py), need a key (passed in for one call, never stored)
    and a single-use spend token from a user click, and are refused in offline mode.
  * No provider chosen is a normal state: `status()` says so and every screen keeps working in Manual mode.
  * The settings file holds no secrets.
Every provider declares {offline, cost, capabilities, limits} (ADR-0004). A price nobody published is Unknown, never a guess.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path
from typing import Any

from .providers.net import Net, NetError

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}
OPENAI_STYLE = ("openai", "openrouter", "gemini", "ollama", "lmstudio", "inkling")

# `assumed` marks a default nobody has confirmed against a running install here.
PROVIDERS: dict[str, dict[str, Any]] = {
    "openai": {"label": "OpenAI", "local": False, "base": "https://api.openai.com/v1", "key": "openai"},
    "anthropic": {"label": "Anthropic Claude", "local": False, "base": "https://api.anthropic.com/v1", "key": "anthropic"},
    "gemini": {"label": "Google Gemini", "local": False, "base": "https://generativelanguage.googleapis.com/v1beta/openai", "key": "google"},
    "openrouter": {"label": "OpenRouter", "local": False, "base": "https://openrouter.ai/api/v1", "key": "openrouter"},
    "ollama": {"label": "Ollama", "local": True, "base": "http://127.0.0.1:11434/v1"},
    "lmstudio": {"label": "LM Studio", "local": True, "base": "http://127.0.0.1:1234/v1"},
    "inkling": {"label": "Inkling", "local": True, "base": "http://127.0.0.1:8080/v1", "assumed": "Default address is a guess: Inkling's port was not checked. Set the real one."},
}
for _id, _p in PROVIDERS.items():
    _p["id"] = _id
    _p["declaration"] = {
        "offline": _p["local"],
        "cost": {"known": _p["local"], "unit": "usd_per_token" if not _p["local"] else None, "value": 0.0 if _p["local"] else None,
                 "note": "Runs on this computer." if _p["local"] else "Per-token price depends on the model; not looked up here: Unknown."},
        "capabilities": ["text", "json"],
        "limits": {"timeout_s": 180, "max_response_bytes": 8 * 1024 * 1024},
    }


class LlmRefused(Exception):
    """Refused before anything was sent (offline, no key, no spend token, bad settings)."""


class LlmError(Exception):
    """The provider answered with an error or something unusable."""


def json_text(s: str) -> str:
    """Strip reasoning traces and code fences, return the outermost JSON object text."""
    s = re.sub(r"<think>.*?</think>", "", s, flags=re.S).strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s.strip(), flags=re.S)
    a, b = s.find("{"), s.rfind("}")
    return s[a:b + 1] if a >= 0 and b > a else s


def _loopback(url: str) -> bool:
    u = urllib.parse.urlsplit(url)
    return u.scheme == "http" and (u.hostname or "").lower() in {h.strip("[]") for h in LOCAL_HOSTS} and not u.username and not u.password


class Llm:
    def __init__(self, config_path: Path, net: Net | None = None, local_net: Net | None = None, bases: dict[str, str] | None = None):
        self.path = Path(config_path)
        self.net = net or Net()
        if local_net is None:
            local_net = Net(allow_http=True)
            local_net.hosts = {h.strip("[]") for h in LOCAL_HOSTS}
        self.local_net = local_net
        self._bases = bases or {}   # tests point cloud providers at a fake server

    # ------------------------------------------------------------ settings (no secrets)
    def config(self) -> dict:
        try:
            c = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            c = {}
        prov = c.get("provider") if c.get("provider") in PROVIDERS else None
        return {"provider": prov, "model": str(c.get("model") or "")[:120], "base_url": str(c.get("base_url") or "") if prov and PROVIDERS[prov]["local"] else ""}

    def save(self, provider: str | None, model: str = "", base_url: str = "") -> dict:
        if provider in (None, "", "none"):
            out = {"provider": None, "model": "", "base_url": ""}
        else:
            if provider not in PROVIDERS:
                raise LlmRefused(f"Unknown language-model provider {provider!r}.")
            p = PROVIDERS[provider]
            model = (model or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}", model):
                raise LlmRefused("Choose which model to use (letters, digits and . _ : / - only).")
            url = ""
            if p["local"]:
                url = (base_url or p["base"]).strip().rstrip("/")
                if not _loopback(url):
                    raise LlmRefused(f"{p['label']} must be on this computer: use an http address on 127.0.0.1 or localhost.")
                if not url.endswith("/v1"):
                    url += "/v1"
            out = {"provider": provider, "model": model, "base_url": url}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(out, indent=2), encoding="utf-8")
        tmp.replace(self.path)
        return self.config()

    def status(self, offline: bool = False) -> dict:
        c = self.config()
        prov = c["provider"]
        reason = ""
        if prov is None:
            reason = "No language model is chosen. Everything works in Manual mode."
        elif offline and not PROVIDERS[prov]["local"]:
            reason = f"Offline mode is on, so {PROVIDERS[prov]['label']} is disabled."
        return {
            "config": c, "ready": prov is not None and not reason, "reason": reason, "manual_mode_works": True, "offline": offline,
            "providers": [{"id": i, "label": p["label"], "local": p["local"], "base_url": p["base"], "declaration": p["declaration"],
                           "note": p.get("assumed", "")} for i, p in PROVIDERS.items()],
        }

    def _base(self, provider: str) -> str:
        p = PROVIDERS[provider]
        if p["local"]:
            return self.config()["base_url"] if self.config()["provider"] == provider and self.config()["base_url"] else p["base"]
        return self._bases.get(provider, p["base"])

    # ------------------------------------------------------------ calls
    def models(self, provider: str, base_url: str = "") -> dict:
        """Models a local server offers (for the settings picker). Cloud lists are not fetched: type the model id."""
        if provider not in PROVIDERS or not PROVIDERS[provider]["local"]:
            raise LlmRefused("Only local servers list their models here; type the model name for a cloud provider.")
        url = (base_url or self._base(provider)).rstrip("/")
        if not _loopback(url):
            raise LlmRefused("A local server must be on 127.0.0.1 or localhost.")
        try:
            data = self.local_net.json("GET", url + "/models", timeout=5)
        except NetError as e:
            raise LlmError(f"No {PROVIDERS[provider]['label']} server answered at {url}: {e}") from None
        return {"models": sorted(m["id"] for m in (data or {}).get("data", []) if isinstance(m, dict) and isinstance(m.get("id"), str))}

    def complete(self, *, provider: str, model: str, messages: list[dict], schema: dict | None = None, api_key: str = "",
                 spend_token: str = "", offline: bool = False, max_tokens: int = 4096) -> dict:
        if provider not in PROVIDERS:
            raise LlmRefused(f"Unknown language-model provider {provider!r}.")
        p = PROVIDERS[provider]
        if not isinstance(messages, list) or not messages or not all(isinstance(m, dict) and m.get("role") in ("system", "user", "assistant") and isinstance(m.get("content"), str) for m in messages):
            raise LlmRefused("Messages must be a list of {role, content} with text content.")
        if not model:
            raise LlmRefused("No model chosen.")
        if not p["local"]:
            if offline:
                raise LlmRefused(f"Offline mode is on, so {p['label']} is disabled.")
            if not spend_token:
                raise LlmRefused("A spend confirmation from a user click is required before a cloud language-model call.")
            if not api_key:
                raise LlmRefused(f"Add your {p['label']} key in Settings first.")
        base = self._base(provider)
        if p["local"] and not _loopback(base):
            raise LlmRefused(f"{p['label']} must be on this computer.")
        net = self.local_net if p["local"] else self.net
        try:
            if provider == "anthropic":
                text, usage = self._anthropic(net, base, model, messages, schema, api_key, max_tokens)
            else:
                text, usage = self._openai_style(net, base, model, messages, schema, api_key, max_tokens, provider)
        except NetError as e:
            raise LlmError(str(e)) from None
        out: dict[str, Any] = {"provider": provider, "model": model, "text": text, "usage": usage}
        if schema is not None:
            try:
                out["json"] = json.loads(text)
            except ValueError:
                raise LlmError("The model did not return valid JSON. Try a larger or instruction-tuned model.") from None
        return out

    def _openai_style(self, net: Net, base: str, model: str, messages: list[dict], schema: dict | None, key: str, max_tokens: int, provider: str):
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        url = base + "/chat/completions"

        def ask(msgs, fmt=None):
            body: dict[str, Any] = {"model": model, "messages": msgs}
            if fmt:
                body["response_format"] = fmt
            r = net.json("POST", url, headers=headers, body=body, timeout=180)
            try:
                return json_text(r["choices"][0]["message"]["content"] or "") if schema else re.sub(r"<think>.*?</think>", "", r["choices"][0]["message"]["content"] or "", flags=re.S).strip(), r.get("usage") or {}
            except (KeyError, IndexError, TypeError):
                raise LlmError("The provider's answer had no message.") from None

        if not schema:
            return ask(messages)
        # 1) native JSON-schema output, 2) JSON mode with the schema spelled out, 3) plain with the schema spelled out
        try:
            text, usage = ask(messages, {"type": "json_schema", "json_schema": {"name": "result", "schema": schema, "strict": True}})
            json.loads(text)
            return text, usage
        except (NetError, LlmError, ValueError):
            pass
        hint = {"role": "system", "content": "Reply with ONLY a JSON object (no prose, no code fences) that matches this JSON Schema exactly:\n" + json.dumps(schema)}
        try:
            return ask([hint] + messages, {"type": "json_object"})
        except NetError:
            return ask([hint] + messages)

    def _anthropic(self, net: Net, base: str, model: str, messages: list[dict], schema: dict | None, key: str, max_tokens: int):
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        if schema:
            system += "\nReply with ONLY JSON matching this schema exactly:\n" + json.dumps(schema)
        msgs = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant")]
        r = net.json("POST", base + "/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                     body={"model": model, "max_tokens": max_tokens, "system": system, "messages": msgs}, timeout=180)
        text = "".join(x.get("text", "") for x in (r or {}).get("content", []) if isinstance(x, dict) and x.get("type") == "text")
        return (json_text(text) if schema else text), (r or {}).get("usage") or {}
