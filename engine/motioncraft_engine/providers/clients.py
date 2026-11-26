"""Provider clients: submit a prompt, poll until a picture or video exists.

Ported in shape from FilmCrafter3 `render.py` (Fal, Kie, BytePlusImages; Google and OpenAI rewritten from the providers' docs as
FilmCrafter3 did). Nothing here has been run against a live provider (no keys were available); the flows are tested against a
local fake server. Each `poll` returns one of:
  {"state": "running", "detail": str}
  {"state": "done", "url": https-url} | {"state": "done", "data": bytes} , plus optional "cost": {"value", "unit"} when the
  provider itself reported what it charged
  {"state": "failed", "error": str}
"""
from __future__ import annotations

import base64
import uuid
import re
import json
from typing import Any

from .net import Net, NetError


class ProviderError(Exception):
    pass


def _media_url(node: Any) -> str | None:
    """First https media link in a provider answer, preferring the usual fields."""
    if isinstance(node, dict):
        for k in ("video", "image", "output", "file"):
            v = node.get(k)
            if isinstance(v, dict) and isinstance(v.get("url"), str):
                return v["url"]
            if isinstance(v, str) and v.startswith("http"):
                return v
        for k in ("images", "videos", "outputs"):
            v = node.get(k)
            if isinstance(v, list) and v:
                u = _media_url(v[0])
                if u:
                    return u
        if isinstance(node.get("url"), str) and node["url"].startswith("http"):
            return node["url"]
        for v in node.values():
            u = _media_url(v)
            if u:
                return u
    elif isinstance(node, list):
        for v in node:
            u = _media_url(v)
            if u:
                return u
    elif isinstance(node, str) and node.startswith("http"):
        return node
    return None


class Fal:
    name = "fal"

    def __init__(self, net: Net, key: str, queue_base: str = "https://queue.fal.run"):
        self.net, self.h, self.base = net, {"Authorization": f"Key {key}"}, queue_base

    def submit(self, model: str, prompt: str, params: dict) -> dict:
        params = dict(params)
        img = params.pop("_image", None)
        files = params.pop("_files", None) or {}
        body = {"prompt": prompt, **params}
        if img:
            body["image_url"] = f"data:{img['mime']};base64,{base64.b64encode(img['data']).decode('ascii')}"
        for field, spec in files.items():
            uris = [f"data:{it['mime']};base64,{base64.b64encode(it['data']).decode('ascii')}" for it in spec["items"]]
            body[field] = uris if spec["list"] else uris[0]
        j = self.net.json("POST", f"{self.base}/{model}", headers=self.h, body=body)
        if not j or "request_id" not in j:
            raise ProviderError("fal did not return a request id.")
        return {"id": j["request_id"], "status_url": j.get("status_url"), "response_url": j.get("response_url")}

    def poll(self, model: str, meta: dict) -> dict:
        app = "/".join(model.split("/")[:2])
        status_url = meta.get("status_url") or f"{self.base}/{app}/requests/{meta['id']}/status"
        response_url = meta.get("response_url") or f"{self.base}/{app}/requests/{meta['id']}"
        st = self.net.json("GET", status_url, headers=self.h)
        if st.get("status") != "COMPLETED":
            return {"state": "running", "detail": str(st.get("status", "")).replace("_", " ").lower()}
        res = self.net.json("GET", response_url, headers=self.h)
        url = _media_url(res)
        return {"state": "done", "url": url} if url else {"state": "failed", "error": "fal finished but sent no picture or video."}


class Kie:
    name = "kie"
    base = "https://api.kie.ai/api/v1"

    def __init__(self, net: Net, key: str, base: str | None = None):
        self.net, self.h = net, {"Authorization": f"Bearer {key}"}
        if base:
            self.base = base

    @staticmethod
    def _is_mj(model: str) -> bool:
        return model.startswith("midjourney/")

    KIE_UPLOAD_LIMIT = 10 * 1024 * 1024        # Kie.ai's quick upload; larger files need its stream upload
    upload_host = "https://kieai.redpandaai.co"  # Kie.ai's file service: its documentation shows api.kie.ai, which answers 404 for uploads (found by a real test)

    def upload(self, item: dict) -> str:
        """Puts one file on Kie.ai (kept there for 24 hours) and returns its address, for models that take inputs by address. Only to Kie.ai, and only for the
        model the person chose."""
        if len(item["data"]) > self.KIE_UPLOAD_LIMIT:
            raise ProviderError(f"{item['name']} is larger than 10 MB, which is the most Kie.ai's quick upload takes. Use a smaller file.")
        j = self.net.json("POST", f"{self.upload_host}/api/file-base64-upload", headers=self.h, timeout=300,
                          body={"base64Data": f"data:{item['mime']};base64,{base64.b64encode(item['data']).decode('ascii')}", "uploadPath": f"motioncraft/{item['kind']}",
                                "fileName": f"{uuid.uuid4().hex[:12]}-{re.sub(r'[^A-Za-z0-9._-]', '-', item['name'])[:60]}"})
        url = ((j or {}).get("data") or {}).get("downloadUrl")
        if not (j or {}).get("success", False) and not url:
            raise ProviderError(f"Kie.ai could not take {item['name']}: {str((j or {}).get('msg') or 'no reason given')}")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise ProviderError("Kie.ai did not return an address for the file.")
        return url

    def submit(self, model: str, prompt: str, params: dict) -> dict:
        params = dict(params)
        files = params.pop("_files", None) or {}
        for field, spec in files.items():
            urls = [self.upload(it) for it in spec["items"]]
            params[field] = urls if spec["list"] else urls[0]
        if self._is_mj(model):
            body = {"taskType": "mj_txt2img", "prompt": prompt, "speed": params.get("speed", "fast"), "aspectRatio": params.get("aspect_ratio", "16:9"),
                    "version": str(params.get("version", "7")), "enableTranslation": False}
            j = self.net.json("POST", f"{self.base}/mj/generate", headers=self.h, body=body)
        else:
            j = self.net.json("POST", f"{self.base}/jobs/createTask", headers=self.h, body={"model": model, "input": {"prompt": prompt, **params}})
        code, msg = (j or {}).get("code"), str((j or {}).get("msg") or "")
        if isinstance(code, int) and 400 <= code < 500 and code not in (401, 402, 403, 429):
            raise ProviderError(f"Kie.ai refused this request, so nothing was charged. It said: {msg or 'invalid input'}")
        task = ((j or {}).get("data") or {}).get("taskId")
        if code not in (200, None) or not task:
            raise ProviderError(msg or "Kie.ai did not return a task id.")
        return {"id": task}

    def poll(self, model: str, meta: dict) -> dict:
        if self._is_mj(model):
            d = (self.net.json("GET", f"{self.base}/mj/record-info?taskId={meta['id']}", headers=self.h) or {}).get("data") or {}
            flag = d.get("successFlag")
            if flag == 1:
                info = d.get("resultInfoJson") or {}
                if isinstance(info, str):
                    try:
                        info = json.loads(info)
                    except ValueError:
                        info = {}
                urls = [(u.get("resultUrl") or u.get("url")) if isinstance(u, dict) else u for u in (info.get("resultUrls") or [])]
                urls = [u for u in urls if isinstance(u, str) and u.startswith("http")]
                return {"state": "done", "url": urls[0]} if urls else {"state": "failed", "error": "Midjourney finished but sent no picture."}
            if flag in (2, 3):
                return {"state": "failed", "error": d.get("errorMessage") or d.get("failMsg") or "Midjourney could not make this picture."}
            return {"state": "running", "detail": "generating"}
        d = (self.net.json("GET", f"{self.base}/jobs/recordInfo?taskId={meta['id']}", headers=self.h) or {}).get("data") or {}
        st = d.get("state")
        if st == "success":
            try:
                res = json.loads(d.get("resultJson") or "{}")
            except ValueError:
                res = {}
            urls = [u for u in (res.get("resultUrls") or []) if isinstance(u, str) and u.startswith("http")]
            if not urls:
                return {"state": "failed", "error": "Kie.ai finished but sent no result."}
            out: dict = {"state": "done", "url": urls[0]}
            if isinstance(d.get("creditsConsumed"), (int, float)):
                out["cost"] = {"value": float(d["creditsConsumed"]), "unit": "kie_credits"}
            return out
        if st == "fail":
            return {"state": "failed", "error": d.get("failMsg") or d.get("failCode") or "Generation failed."}
        return {"state": "running", "detail": st or "waiting"}


class BytePlus:
    name = "byteplus"
    url = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations"

    def __init__(self, net: Net, key: str, url: str | None = None):
        self.net, self.h = net, {"Authorization": f"Bearer {key}"}
        if url:
            self.url = url

    def submit(self, model: str, prompt: str, params: dict) -> dict:
        body = {"model": model, "prompt": prompt, "size": params.get("size") or "2K", "response_format": "b64_json", "watermark": False,
                "sequential_image_generation": "disabled", "stream": False}
        if "5-0" in model:
            body["output_format"] = "png"
        r = self.net.json("POST", self.url, headers=self.h, body=body, timeout=300)
        item = ((r or {}).get("data") or [None])[0] or {}
        if isinstance(item.get("error"), dict):
            raise ProviderError("BytePlus: " + str(item["error"].get("message") or "the picture was refused"))
        if item.get("b64_json"):
            return {"data": base64.b64decode(item["b64_json"])}
        if str(item.get("url") or "").startswith("http"):
            return {"url": item["url"]}
        raise ProviderError("BytePlus returned no picture (it may have been blocked by its moderation).")

    def poll(self, model: str, meta: dict) -> dict:
        return {"state": "done", **({"data": meta["data"]} if "data" in meta else {"url": meta["url"]})}


class OpenAI:
    name = "openai"
    url = "https://api.openai.com/v1/images/generations"

    def __init__(self, net: Net, key: str, url: str | None = None):
        self.net, self.h = net, {"Authorization": f"Bearer {key}"}
        if url:
            self.url = url

    def submit(self, model: str, prompt: str, params: dict) -> dict:
        r = self.net.json("POST", self.url, headers=self.h, body={"model": model, "prompt": prompt, "size": params.get("size", "1536x1024"), "n": 1}, timeout=300)
        item = ((r or {}).get("data") or [None])[0] or {}
        if item.get("b64_json"):
            return {"data": base64.b64decode(item["b64_json"])}
        if str(item.get("url") or "").startswith("http"):
            return {"url": item["url"]}
        raise ProviderError("OpenAI returned no picture.")

    def poll(self, model: str, meta: dict) -> dict:
        return {"state": "done", **({"data": meta["data"]} if "data" in meta else {"url": meta["url"]})}


class Google:
    name = "google"
    base = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, net: Net, key: str, base: str | None = None):
        self.net, self.key, self.h = net, key, {"x-goog-api-key": key}
        if base:
            self.base = base

    def submit(self, model: str, prompt: str, params: dict) -> dict:
        if model.startswith("veo-"):
            p = {k2: params[k1] for k1, k2 in (("aspect_ratio", "aspectRatio"), ("resolution", "resolution"), ("duration", "durationSeconds"), ("negative_prompt", "negativePrompt"),
                                              ("person_generation", "personGeneration")) if params.get(k1)}
            instance: dict = {"prompt": prompt}
            img = params.get("_image")
            if img:
                instance["image"] = {"bytesBase64Encoded": base64.b64encode(img["data"]).decode("ascii"), "mimeType": img["mime"]}
            j = self.net.json("POST", f"{self.base}/models/{model}:predictLongRunning", headers=self.h, timeout=300, body={"instances": [instance], "parameters": p})
            if not (j or {}).get("name"):
                raise ProviderError("Google did not return an operation.")
            return {"op": j["name"]}
        j = self.net.json("POST", f"{self.base}/models/{model}:generateContent", headers=self.h, timeout=300,
                          body={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["IMAGE"]}})
        for cand in (j or {}).get("candidates") or []:
            for part in (cand.get("content") or {}).get("parts") or []:
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    return {"data": base64.b64decode(inline["data"])}
        raise ProviderError("Google returned no picture (it may have been blocked by its safety filter).")

    def poll(self, model: str, meta: dict) -> dict:
        if "op" not in meta:
            return {"state": "done", "data": meta["data"]}
        j = self.net.json("GET", f"{self.base}/{meta['op']}", headers=self.h)
        if not (j or {}).get("done"):
            return {"state": "running", "detail": "generating"}
        if j.get("error"):
            return {"state": "failed", "error": str(j["error"].get("message") or "Veo failed")}
        samples = ((j.get("response") or {}).get("generateVideoResponse") or {}).get("generatedSamples") or []
        uri = ((samples[0] if samples else {}).get("video") or {}).get("uri")
        return {"state": "done", "url": uri, "headers": self.h} if uri else {"state": "failed", "error": "Veo finished but sent no video."}


CLIENTS = {"fal": Fal, "kie": Kie, "byteplus": BytePlus, "openai": OpenAI, "google": Google}


def make_client(provider: str, net: Net, key: str, **kw):
    if provider not in CLIENTS:
        raise ProviderError(f"No client for {provider}.")
    return CLIENTS[provider](net, key, **kw)


__all__ = ["make_client", "ProviderError", "NetError"]
