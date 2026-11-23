"""Generation jobs: one background thread per job, polled by the UI. Every rule from ADR-0005 is enforced here.

A job starts only if: generative models are enabled, offline mode is off, the model is in the registry, the prompt and params
are sane, and a spend token from a user click is supplied (single use). Results are written under the package's assets folder
with a provenance record (provider, model, prompt, cost reported or estimated, licence note).
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .clients import ProviderError, make_client
from .net import Net, NetError
from .registry import Registry

LICENCE_NOTE = "Generated through a provider API. Its terms decide commercial use; check them before delivering."
PARAM_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$")   # model ids from remote lists end up in URL paths
MAX_RUNNING = 4
MAX_PROMPT = 4000


class JobRefused(Exception):
    """The request was rejected before anything was sent or charged."""


class Jobs:
    def __init__(self, registry: Registry, net: Net, *, poll_seconds: float = 3.0, timeout_seconds: float = 900.0,
                 client_factory: Callable[..., Any] = make_client, client_kwargs: dict | None = None):
        self.reg, self.net = registry, net
        self.poll_s, self.timeout_s = poll_seconds, timeout_seconds
        self._factory, self._kw = client_factory, client_kwargs or {}
        self._jobs: dict[str, dict] = {}
        self._used_tokens: set[str] = set()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ start
    def start(self, *, provider: str, model: str, prompt: str, params: dict | None, api_key: str, package: Path, spend_token: str,
              generative_enabled: bool, offline: bool, actor: str = "user") -> dict:
        if not generative_enabled:
            raise JobRefused("Generative models are off. Turn them on in Settings first.")
        if offline:
            raise JobRefused("Offline mode is on, so cloud providers are disabled.")
        if not MODEL_ID.match(model or "") or ".." in model:
            raise JobRefused("That model id is not allowed.")
        e = self.reg.get(provider, model)
        if e is None:
            raise JobRefused("That model is not in the registry.")
        if not api_key:
            raise JobRefused(f"Add your {provider} key in Settings first.")
        if not spend_token:
            raise JobRefused("A spend confirmation from a user click is required before any paid generation.")
        prompt = (prompt or "").strip()
        if not prompt or len(prompt) > MAX_PROMPT:
            raise JobRefused(f"The prompt must be 1 to {MAX_PROMPT} characters.")
        clean: dict[str, Any] = {}
        for k, v in (params or {}).items():
            if not PARAM_KEY.match(str(k)) or not isinstance(v, (str, int, float, bool)) or (isinstance(v, str) and len(v) > 200):
                raise JobRefused(f"Parameter {k!r} is not allowed.")
            clean[k] = v
        pkg = Path(package).resolve()
        if pkg.suffix != ".motioncraft" or not pkg.is_dir():
            raise JobRefused("Not a MotionCraft package folder.")
        with self._lock:
            if sum(1 for j in self._jobs.values() if j["state"] in ("queued", "running")) >= MAX_RUNNING:
                raise JobRefused(f"{MAX_RUNNING} generations are already running. Wait for one to finish.")
            if spend_token in self._used_tokens:
                raise JobRefused("That spend confirmation was already used. Confirm again.")
            self._used_tokens.add(spend_token)
        jid = uuid.uuid4().hex[:12]
        est = e["price"] if e["price"]["known"] else None
        job = {"id": jid, "state": "queued", "detail": "starting", "provider": provider, "model": model, "kind": e["media"],
               "estimate": {"value": est["value"], "unit": est["unit"], "label": "Estimate"} if est else {"value": None, "unit": None, "label": "Unknown"},
               "asset": None, "error": None, "cancel": False, "started": time.time()}
        with self._lock:
            self._jobs[jid] = job
        threading.Thread(target=self._run, args=(job, prompt, clean, api_key, pkg, actor), daemon=True).start()
        return self.public(job)

    # ------------------------------------------------------------------ worker
    def _run(self, job: dict, prompt: str, params: dict, key: str, pkg: Path, actor: str) -> None:
        provider, model, kind = job["provider"], job["model"], job["kind"]
        try:
            client = self._factory(provider, self.net, key, **self._kw.get(provider, {}))
            job.update(state="running", detail="submitted")
            meta = client.submit(model, prompt, params)
            deadline = time.time() + self.timeout_s
            while True:
                if job["cancel"]:
                    job.update(state="cancelled", detail="Stopped. The provider may still bill a job it already started.")
                    return
                res = client.poll(model, meta)
                if res["state"] == "done":
                    break
                if res["state"] == "failed":
                    job.update(state="failed", error=res.get("error") or "Generation failed.")
                    return
                job["detail"] = res.get("detail") or "generating"
                if time.time() > deadline:
                    job.update(state="failed", error="The provider took too long. It may still bill this job: check your provider usage.")
                    return
                time.sleep(self.poll_s)
            sub = "video" if kind == "video" else "images"
            dest = pkg / "assets" / sub
            stem = f"gen-{job['id']}"
            if "data" in res:
                from .net import _ext_for
                ext = _ext_for(res["data"][:16], kind)
                if ext is None:
                    raise NetError("The result is not a picture or video file.")
                dest.mkdir(parents=True, exist_ok=True)
                out = dest / f"{stem}{ext}"
                out.write_bytes(res["data"])
            else:
                out = self.net.download(res["url"], dest, stem, kind, headers=res.get("headers"))
            cost = res.get("cost")
            est = job["estimate"]
            prov = {"actor": actor, "prompt": prompt, "provider": provider, "model": model, "at": datetime.now(timezone.utc).isoformat(),
                    "licence": LICENCE_NOTE, "costReported": bool(cost),
                    "costUsd": None if cost else est["value"], "costUnit": cost["unit"] if cost else ("usd" if est["value"] is not None else None),
                    "costValue": cost["value"] if cost else est["value"]}
            job["asset"] = {"path": out.relative_to(pkg).as_posix(), "kind": kind, "provenance": prov}
            job.update(state="done", detail="done")
        except (ProviderError, NetError) as e:
            job.update(state="failed", error=str(e))
        except Exception as e:  # noqa: BLE001 - a worker must never die silently
            job.update(state="failed", error=f"Unexpected error: {type(e).__name__}")

    # ------------------------------------------------------------------ queries
    def public(self, job: dict) -> dict:
        return {k: job[k] for k in ("id", "state", "detail", "provider", "model", "kind", "estimate", "asset", "error")} | {
            "elapsed": round(time.time() - job["started"], 1)}

    def poll(self, jid: str) -> dict:
        with self._lock:
            job = self._jobs.get(jid)
        if job is None:
            raise JobRefused("Unknown job.")
        return self.public(job)

    def cancel(self, jid: str) -> dict:
        with self._lock:
            job = self._jobs.get(jid)
        if job is None:
            raise JobRefused("Unknown job.")
        job["cancel"] = True
        return self.public(job)
