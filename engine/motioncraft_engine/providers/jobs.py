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
from .registry import takes_inputs, takes_picture
from .registry import Registry

LICENCE_NOTE = "Generated through a provider API. Its terms decide commercial use; check them before delivering."
PARAM_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$")   # model ids from remote lists end up in URL paths
MAX_RUNNING = 4
MAX_PROMPT = 4000


MAX_START_PICTURE = 25 * 1024 * 1024


def load_start_picture(pkg: Path, rel: str) -> dict:
    """The starting picture of an image-to-video job: a file directly in this project's assets/images folder, checked by what it really is, and shrunk to at
    most 1920 pixels on its long side as a JPEG when Pillow is there (faster to send, and no model needs more). Returns {data, mime}."""
    r = Path(rel)
    if r.is_absolute() or len(r.parts) != 3 or r.parts[0] != "assets" or r.parts[1] != "images" or any(x in ("..", ".") for x in r.parts):
        raise JobRefused("The starting picture must be one of this project's pictures.")
    f = (pkg / r).resolve()
    if pkg not in f.parents or not f.is_file() or f.is_symlink():
        raise JobRefused("The starting picture is not in the project any more.")
    if f.stat().st_size > MAX_START_PICTURE:
        raise JobRefused("The starting picture is too large (over 25 MB).")
    raw = f.read_bytes()
    mime = "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg" if raw[:3] == b"\xff\xd8\xff" else "image/webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None
    if mime is None:
        raise JobRefused("The starting picture is not a PNG, JPEG or WebP file.")
    try:
        import io
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as im:
            im = im.convert("RGB")
            im.thumbnail((1920, 1920))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=92)
            return {"data": buf.getvalue(), "mime": "image/jpeg"}
    except Exception:  # noqa: BLE001 - without Pillow, or an odd file, the original goes as it is
        return {"data": raw, "mime": mime}


MAX_FILE = {"images": 25 * 1024 * 1024, "video": 100 * 1024 * 1024, "audio": 50 * 1024 * 1024}
MAX_FILE_FIELDS, MAX_FILES_PER_FIELD = 12, 12


def _sniff(raw: bytes, folder: str) -> str | None:
    if folder == "images":
        return "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg" if raw[:3] == b"\xff\xd8\xff" else "image/webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None
    if folder == "video":
        return "video/mp4" if raw[4:8] == b"ftyp" and raw[8:12] not in (b"qt  ",) else "video/quicktime" if raw[4:8] == b"ftyp" else "video/webm" if raw[:4] == b"\x1a\x45\xdf\xa3" else None
    if folder == "audio":
        return "audio/wav" if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE" else "audio/mpeg" if raw[:3] == b"ID3" or (len(raw) > 2 and raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0) else \
            "audio/flac" if raw[:4] == b"fLaC" else "audio/mp4" if raw[4:8] == b"ftyp" else None
    return None


def load_input_files(pkg: Path, files: dict) -> dict:
    """The files a model is given as inputs (a start picture, a last frame, reference pictures, a clip to change, sound): each a file of THIS project, in its
    pictures, video or audio folder, read here and checked by what it really is. Returns {field: {"list": bool, "items": [{kind, data, mime, name}]}}."""
    if not isinstance(files, dict) or len(files) > MAX_FILE_FIELDS:
        raise JobRefused("Too many input slots.")
    out: dict[str, dict] = {}
    for field, spec in files.items():
        if not PARAM_KEY.match(str(field)) or not isinstance(spec, dict) or not isinstance(spec.get("paths"), list):
            raise JobRefused(f"Input {field!r} is not allowed.")
        paths = spec["paths"]
        if not paths or len(paths) > MAX_FILES_PER_FIELD:
            raise JobRefused(f"Input {field!r} needs between 1 and {MAX_FILES_PER_FIELD} files.")
        items = []
        for rel in paths:
            r = Path(str(rel))
            if r.is_absolute() or len(r.parts) != 3 or r.parts[0] != "assets" or r.parts[1] not in MAX_FILE or any(x in ("..", ".") for x in r.parts):
                raise JobRefused("An input must be one of this project's pictures, clips or sounds.")
            f = (pkg / r).resolve()
            if pkg not in f.parents or not f.is_file():
                raise JobRefused(f"{r.name} is not in the project any more.")
            if f.stat().st_size > MAX_FILE[r.parts[1]]:
                raise JobRefused(f"{r.name} is too large to send ({f.stat().st_size // 1048576} MB).")
            raw = f.read_bytes()
            mime = _sniff(raw, r.parts[1])
            if mime is None:
                raise JobRefused(f"{r.name} is not a picture, clip or sound file the models can take.")
            if r.parts[1] == "images":
                try:
                    import io
                    from PIL import Image
                    with Image.open(io.BytesIO(raw)) as im:
                        im = im.convert("RGB")
                        im.thumbnail((1920, 1920))
                        buf = io.BytesIO()
                        im.save(buf, "JPEG", quality=92)
                        raw, mime = buf.getvalue(), "image/jpeg"
                except Exception:  # noqa: BLE001 - the original goes as it is
                    pass
            items.append({"kind": {"images": "image", "video": "video", "audio": "audio"}[r.parts[1]], "data": raw, "mime": mime, "name": r.name})
        out[str(field)] = {"list": bool(spec.get("list")), "items": items}
    return out


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
              generative_enabled: bool, offline: bool, actor: str = "user", files: dict | None = None) -> dict:
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
        if files:                   # the files this model is given: validated against the project, then handed to the client, which uploads or encodes them
            if e["media"] != "video" or not takes_inputs(e):
                raise JobRefused("That model does not take pictures, clips or sound as input. Choose one that does.")
            loaded = load_input_files(pkg, files)
            if provider == "google":     # Veo takes one starting picture and nothing else
                extra = set(loaded) - {"image"}
                if extra or "image" not in loaded:
                    raise JobRefused("Google's Veo takes one starting picture and no other file.")
                clean["_image"] = {"data": loaded["image"]["items"][0]["data"], "mime": loaded["image"]["items"][0]["mime"]}
            else:
                clean["_files"] = loaded
        if "image" in clean:       # image to video: the picture is one of this project's own, read here, never a path or address the page chose
            if e["media"] != "video" or not takes_picture(e):
                raise JobRefused("That model does not start from a picture. Choose one marked as taking a picture.")
            clean["_image"] = load_start_picture(pkg, str(clean.pop("image")))

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
            if kind != "video":
                out = normalise_picture(out)
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


def normalise_picture(path: Path) -> Path:
    """A WebP picture becomes a PNG: After Effects, Premiere and Resolve do not all read WebP, and a hand-off must not depend on that.
    The original is removed once the PNG is written; if the file cannot be read as a picture it is left exactly as it was."""
    if path.suffix.lower() != ".webp":
        return path
    try:
        from PIL import Image
        with Image.open(path) as im:
            im.load()
            png = path.with_suffix(".png")
            im.save(png, "PNG")
    except Exception:  # noqa: BLE001 - an unreadable file stays as downloaded
        return path
    path.unlink(missing_ok=True)
    return png
