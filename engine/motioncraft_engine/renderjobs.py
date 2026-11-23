"""Draft preview movies and final renders, run on their own engine process so a long render never blocks the editing session.

A render reads the saved `.ecproj` (the app saves after every change), so it renders exactly what is on disk. Only the final
render needs a spend token (AGENTS.md money rule); the half-resolution draft movie for in-app playback is never delivered.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from .adapter.models import FinalRenderJob

PRESETS = {"h264": (".mp4", "H.264 video"), "prores4444": (".mov", "ProRes 4444 with alpha")}
KEEP_PREVIEWS = 3


class RenderRefused(Exception):
    pass


def safe_stem(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")[:60]
    return s or "render"


class RenderJobs:
    def __init__(self, adapter_factory: Callable[[Path], Any]):
        self._factory = adapter_factory
        self._jobs: dict[str, dict] = {}
        self._used: set[str] = set()
        self._lock = threading.Lock()

    def _new(self, kind: str, extra: dict) -> dict:
        job = {"id": uuid.uuid4().hex[:12], "kind": kind, "state": "running", "detail": "starting", "started": time.time(), "output": None,
               "frames": None, "bytes": None, "error": None, **extra}
        with self._lock:
            if sum(1 for j in self._jobs.values() if j["state"] == "running" and j["kind"] == "final") and kind == "final":
                raise RenderRefused("A final render is already running.")
            self._jobs[job["id"]] = job
        return job

    def start_movie(self, package: Path) -> dict:
        pkg = self._check(package)
        if not (pkg / "comp.ecproj").is_file():
            raise RenderRefused("There is no composition to preview yet. Open Build and add a layer first.")
        job = self._new("preview", {})
        out = pkg / "previews" / f"preview-{job['id'][:8]}.mp4"
        threading.Thread(target=self._run, args=(job, pkg, lambda a, comp: a.preview_movie(comp, out), out), daemon=True).start()
        self._prune(pkg / "previews")
        return self.public(job, pkg)

    def start_final(self, package: Path, preset: str, name: str, spend_token: str) -> dict:
        pkg = self._check(package)
        if preset not in PRESETS:
            raise RenderRefused("Unknown output.")
        if not spend_token:
            raise RenderRefused("A final render needs a confirmation from a click. Confirm again.")
        with self._lock:
            if spend_token in self._used:
                raise RenderRefused("That confirmation was already used. Confirm again.")
            self._used.add(spend_token)
        if not (pkg / "comp.ecproj").is_file():
            raise RenderRefused("There is no composition to render yet.")
        job = self._new("final", {"preset": preset})
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out = pkg / "renders" / f"{safe_stem(name)}-{preset}-{stamp}{PRESETS[preset][0]}"

        def work(adapter, comp):
            adapter._spend_ok = lambda t, tok=spend_token: t == tok      # the grant came from the shell, which checked the click
            return adapter.render_final(FinalRenderJob(comp=comp, preset=preset, output=out), spend_token)
        threading.Thread(target=self._run, args=(job, pkg, work, out), daemon=True).start()
        return self.public(job, pkg)

    def _run(self, job: dict, pkg: Path, work: Callable, out: Path) -> None:
        adapter = None
        try:
            adapter = self._factory(pkg)
            adapter.open(pkg / "comp.ecproj")
            snap = adapter.inspect()
            if not snap.comps:
                raise RenderRefused("The project has no composition.")
            comp = snap.active_comp or snap.comps[0].id
            job["detail"] = "rendering"
            res = work(adapter, comp)
            job.update(state="done", detail="done", output=out.relative_to(pkg).as_posix(), frames=res.frames, bytes=res.bytes)
        except Exception as e:  # noqa: BLE001 - a worker never dies silently
            job.update(state="failed", error=str(e) or type(e).__name__)
        finally:
            if adapter is not None:
                try:
                    adapter.close()
                except Exception:  # noqa: BLE001
                    pass

    def poll(self, jid: str, package: Path) -> dict:
        with self._lock:
            job = self._jobs.get(jid)
        if job is None:
            raise RenderRefused("Unknown render.")
        return self.public(job, Path(package))

    @staticmethod
    def public(job: dict, pkg: Path) -> dict:
        return {k: job[k] for k in ("id", "kind", "state", "detail", "output", "frames", "bytes", "error")} | {
            "elapsed": round(time.time() - job["started"], 1), "preset": job.get("preset")}

    @staticmethod
    def _check(package: Path) -> Path:
        pkg = Path(package).resolve()
        if pkg.suffix != ".motioncraft" or not pkg.is_dir():
            raise RenderRefused("Not a MotionCraft package folder.")
        return pkg

    @staticmethod
    def _prune(folder: Path) -> None:
        files = sorted(folder.glob("preview-*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[KEEP_PREVIEWS:]:
            old.unlink(missing_ok=True)
