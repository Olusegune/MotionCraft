"""Draft preview movies and final renders, run on their own engine process so a long render never blocks the editing session.

A render reads the saved `.ecproj` (the app saves after every change), so it renders exactly what is on disk. Only the final render
needs a spend token (AGENTS.md money rule); the half-resolution draft movie for in-app playback is never delivered.

Final renders are RESUMABLE (P5-02, AT-13). When it can, the render is cut into short parts (2 s each). Each finished part is kept on
disk with a job file, and the parts are joined at the end. If the render is interrupted (cancelled, the engine dies, the app is
killed), the finished parts stay, and "resume" renders only what is missing, so at most one part (2 s of film) is redone.
Measured on EffectCraft 0.24.1 (tests/test_render_resume_real.py): parts of [start, end) are exact, joined ProRes is bit-identical to a
single pass, and joined H.264 matches it at about 64 dB PSNR (not bit-identical: the encoder restarts at each part).

When it cannot be split, it renders in one piece and says why: no ffmpeg to join the parts, audio in the project (parts could glitch at
the joins), a frame rate that is not a whole number (part boundaries could not be exact), or a render too short to be worth splitting.

A resume is refused if the composition changed since the render started (the old parts would not match it), and, like any final
render, needs a fresh single-use spend token from a click.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from .adapter.models import FinalRenderJob
from .proc import NO_WINDOW

PRESETS = {"h264": (".mp4", "H.264 video"), "prores4444": (".mov", "ProRes 4444 with alpha")}
KEEP_PREVIEWS = 3
SEGMENT_SECONDS = 2.0
PARTS = Path("renders") / ".parts"
JOB_ID = re.compile(r"^[0-9a-f]{12}$")
_DEFAULT = object()


class RenderRefused(Exception):
    pass


class _Interrupted(Exception):
    pass


def safe_stem(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")[:60]
    return s or "render"


def plan_parts(duration: float, fps: float, ffmpeg: str | None, has_audio: bool) -> tuple[list[dict] | None, str]:
    """The parts a render is cut into, or (None, why it renders in one piece)."""
    if ffmpeg is None:
        return None, "ffmpeg was not found, and it is needed to join the parts, so this renders in one piece and cannot be resumed."
    if has_audio:
        return None, "This project has audio. Joining parts could glitch the sound, so it renders in one piece and cannot be resumed."
    if abs(fps - round(fps)) > 1e-6:
        return None, f"A frame rate of {fps:g} cannot be split exactly, so this renders in one piece and cannot be resumed."
    fps_i = int(round(fps))
    total = int(round(duration * fps_i))
    seg = max(1, int(round(SEGMENT_SECONDS * fps_i)))
    n = math.ceil(total / seg) if total > 0 else 0
    if n < 2:
        return None, "This render is short enough to run in one piece."
    parts = []
    for i in range(n):
        f0, f1 = i * seg, min(total, (i + 1) * seg)
        parts.append({"i": i, "start": f0 / fps_i, "end": f1 / fps_i, "frames": f1 - f0, "state": "pending", "bytes": 0})
    return parts, ""


class RenderJobs:
    def __init__(self, adapter_factory: Callable[[Path], Any], joiner: Callable[[list[Path], Path, str], None] | None = None, ffmpeg: Any = _DEFAULT):
        self._factory = adapter_factory
        self._ffmpeg_setting = ffmpeg           # a path, None (none installed), or "look it up each time"
        self._joiner = joiner or self._ffmpeg_join
        self._jobs: dict[str, dict] = {}
        self._used: set[str] = set()
        self._lock = threading.Lock()

    def _ffmpeg(self) -> str | None:
        return shutil.which("ffmpeg") if self._ffmpeg_setting is _DEFAULT else self._ffmpeg_setting

    def _new(self, kind: str, extra: dict) -> dict:
        job = {"id": uuid.uuid4().hex[:12], "kind": kind, "state": "running", "detail": "starting", "started": time.time(), "output": None,
               "frames": None, "bytes": None, "error": None, "cancel": False, "adapter": None, **extra}
        with self._lock:
            if kind == "final" and any(j["state"] == "running" and j["kind"] == "final" for j in self._jobs.values()):
                raise RenderRefused("A final render is already running.")
            self._jobs[job["id"]] = job
        return job

    # ------------------------------------------------------------------ draft preview movie (unchanged)
    def start_movie(self, package: Path) -> dict:
        pkg = self._check(package)
        if not (pkg / "comp.ecproj").is_file():
            raise RenderRefused("There is no composition to preview yet. Open Build and add a layer first.")
        job = self._new("preview", {})
        out = pkg / "previews" / f"preview-{job['id'][:8]}.mp4"
        threading.Thread(target=self._run_preview, args=(job, pkg, out), daemon=True).start()
        self._prune(pkg / "previews")
        return self.public(job, pkg)

    def _run_preview(self, job: dict, pkg: Path, out: Path) -> None:
        adapter = None
        try:
            adapter = self._factory(pkg)
            adapter.open(pkg / "comp.ecproj")
            snap = adapter.inspect()
            if not snap.comps:
                raise RenderRefused("The project has no composition.")
            comp = snap.active_comp or snap.comps[0].id
            job["detail"] = "rendering"
            res = adapter.preview_movie(comp, out)
            job.update(state="done", detail="done", output=out.relative_to(pkg).as_posix(), frames=res.frames, bytes=res.bytes)
        except Exception as e:  # noqa: BLE001 - a worker never dies silently
            job.update(state="failed", error=str(e) or type(e).__name__)
        finally:
            self._close(adapter)

    # ------------------------------------------------------------------ final render
    def start_final(self, package: Path, preset: str, name: str, spend_token: str, has_audio: bool = False) -> dict:
        pkg = self._check(package)
        if preset not in PRESETS:
            raise RenderRefused("Unknown output.")
        self._use_token(spend_token)
        if not (pkg / "comp.ecproj").is_file():
            raise RenderRefused("There is no composition to render yet.")
        job = self._new("final", {"preset": preset, "name": name, "has_audio": bool(has_audio), "resumable": False, "reason": "", "parts": None,
                                  "segments": None, "comp_sha": self._sha(pkg)})
        stamp = time.strftime("%Y%m%d-%H%M%S")
        job["out_rel"] = (Path("renders") / f"{safe_stem(name)}-{preset}-{stamp}{PRESETS[preset][0]}").as_posix()
        threading.Thread(target=self._run_final, args=(job, pkg, spend_token), daemon=True).start()
        return self.public(job, pkg)

    def resume_final(self, package: Path, jid: str, spend_token: str) -> dict:
        pkg = self._check(package)
        disk = self._read_job(pkg, jid)
        with self._lock:
            live = self._jobs.get(jid)
        if live is not None and live["state"] == "running":
            raise RenderRefused("That render is still running.")
        if disk["state"] == "done":
            raise RenderRefused("That render already finished.")
        if disk.get("comp_sha") != self._sha(pkg):
            raise RenderRefused("The project changed since this render started, so the finished parts no longer match it. Discard this render and start a new one.")
        self._use_token(spend_token)
        for seg in disk["segments"]:
            f = pkg / PARTS / jid / f"part-{seg['i']:04d}{PRESETS[disk['preset']][0]}"
            if seg["state"] == "done" and not (f.is_file() and f.stat().st_size == seg["bytes"] > 0):
                seg["state"] = "pending"              # a finished part that is missing or damaged is simply rendered again
        job = {**disk, "kind": "final", "state": "running", "detail": "resuming", "started": time.time(), "output": None, "frames": None, "bytes": None,
               "error": None, "cancel": False, "adapter": None}
        with self._lock:
            if any(j["state"] == "running" and j["kind"] == "final" for j in self._jobs.values()):
                raise RenderRefused("A final render is already running.")
            self._jobs[jid] = job
        threading.Thread(target=self._run_final, args=(job, pkg, spend_token), daemon=True).start()
        return self.public(job, pkg)

    def _use_token(self, token: str) -> None:
        if not token:
            raise RenderRefused("A final render needs a confirmation from a click. Confirm again.")
        with self._lock:
            if token in self._used:
                raise RenderRefused("That confirmation was already used. Confirm again.")
            self._used.add(token)

    def _run_final(self, job: dict, pkg: Path, token: str) -> None:
        adapter = None
        try:
            adapter = self._factory(pkg)
            job["adapter"] = adapter
            adapter.open(pkg / "comp.ecproj")
            adapter._spend_ok = lambda t, tok=token: t == tok     # the grant came from the shell, which checked the click
            snap = adapter.inspect()
            if not snap.comps:
                raise RenderRefused("The project has no composition.")
            comp_info = snap.comp(None)
            comp = comp_info.id
            out = pkg / job["out_rel"]
            ext = PRESETS[job["preset"]][0]
            if job.get("segments") is None:
                parts, why = plan_parts(comp_info.duration, comp_info.frame_rate, self._ffmpeg(), job.get("has_audio", False))
                job["segments"], job["reason"], job["resumable"] = parts, why, parts is not None
                if parts is not None:
                    job["fps"] = comp_info.frame_rate
            if job["segments"] is None:                         # one piece
                job["detail"] = "rendering"
                res = adapter.render_final(FinalRenderJob(comp=comp, preset=job["preset"], output=out), token)
                job.update(state="done", detail="done", output=job["out_rel"], frames=res.frames, bytes=res.bytes)
                return
            self._render_parts(job, pkg, adapter, comp, token, ext)
            job["detail"] = "joining the parts"
            self._write_job(pkg, job)
            parts_dir = pkg / PARTS / job["id"]
            files = [parts_dir / f"part-{s['i']:04d}{ext}" for s in job["segments"]]
            out.parent.mkdir(parents=True, exist_ok=True)
            self._joiner(files, out, ext)
            total = sum(s["frames"] for s in job["segments"])
            self._verify_joined(out, total)
            shutil.rmtree(parts_dir, ignore_errors=True)               # clean up first, so nobody sees "done" with the parts still there
            job.update(state="done", detail="done", output=job["out_rel"], frames=total, bytes=out.stat().st_size)
        except _Interrupted:
            self._interrupted(job, pkg, "Cancelled.")
        except Exception as e:  # noqa: BLE001 - a worker never dies silently
            msg = "Cancelled." if job.get("cancel") else (str(e) or type(e).__name__)
            if job.get("segments") is not None:
                self._interrupted(job, pkg, msg)          # the finished parts are kept, so it can be resumed
            else:
                job.update(state="failed", error=msg, detail="failed")
                if job.get("out_rel"):
                    (pkg / job["out_rel"]).unlink(missing_ok=True)   # a half-written single-piece render is not kept
        finally:
            self._close(adapter)
            job["adapter"] = None

    def _render_parts(self, job: dict, pkg: Path, adapter: Any, comp: Any, token: str, ext: str) -> None:
        parts_dir = pkg / PARTS / job["id"]
        parts_dir.mkdir(parents=True, exist_ok=True)
        self._write_job(pkg, job)
        n = len(job["segments"])
        for seg in job["segments"]:
            if seg["state"] == "done":
                continue
            if job["cancel"]:
                raise _Interrupted()
            job["detail"] = f"part {seg['i'] + 1} of {n}"
            f = parts_dir / f"part-{seg['i']:04d}{ext}"
            f.unlink(missing_ok=True)                              # a half-written part from an interrupted run is never trusted
            res = adapter.render_final(FinalRenderJob(comp=comp, preset=job["preset"], output=f, start=seg["start"], end=seg["end"]), token)
            if not f.is_file() or f.stat().st_size <= 0:
                raise RuntimeError(f"part {seg['i'] + 1} was not written")
            if res.frames and res.frames != seg["frames"]:
                f.unlink(missing_ok=True)
                raise RuntimeError(f"part {seg['i'] + 1} has {res.frames} frames, expected {seg['frames']}")
            seg.update(state="done", bytes=f.stat().st_size)
            self._write_job(pkg, job)                              # the last good part is on disk before the next one starts

    def _interrupted(self, job: dict, pkg: Path, why: str) -> None:
        # the job file is written BEFORE the state is announced: anyone who sees "interrupted" can already read it from disk and resume
        try:
            self._write_job(pkg, {**job, "state": "interrupted", "error": why, "detail": "interrupted"})
        except OSError:
            pass
        job.update(state="interrupted", error=why, detail="interrupted")

    # ------------------------------------------------------------------ cancel, discard, list, poll
    def cancel(self, jid: str, package: Path) -> dict:
        pkg = self._check(package)
        with self._lock:
            job = self._jobs.get(jid)
        if job is None or job["state"] != "running":
            raise RenderRefused("That render is not running.")
        job["cancel"] = True
        a = job.get("adapter")
        if a is not None and hasattr(a, "abort"):
            a.abort()                                           # stops the engine process mid-part; finished parts are untouched
        return self.public(job, pkg)

    def discard(self, package: Path, jid: str) -> dict:
        pkg = self._check(package)
        if not JOB_ID.match(str(jid)):
            raise RenderRefused("Unknown render.")
        with self._lock:
            live = self._jobs.get(jid)
        if live is not None and live["state"] == "running":
            raise RenderRefused("Cancel the render before discarding it.")
        d = (pkg / PARTS / jid).resolve()
        if d.parent != (pkg / PARTS).resolve():
            raise RenderRefused("Unknown render.")
        if not d.is_dir():
            raise RenderRefused("There is nothing to discard.")
        shutil.rmtree(d)                                        # only our own partial files, inside renders/.parts/<id>
        with self._lock:
            self._jobs.pop(jid, None)
        return {"discarded": jid}

    def list_jobs(self, package: Path) -> dict:
        """Renders that did not finish: running now, or left on disk by an interrupted or killed run."""
        pkg = self._check(package)
        out = []
        base = pkg / PARTS
        for d in sorted(base.glob("*")) if base.is_dir() else []:
            if not JOB_ID.match(d.name):
                continue
            try:
                disk = self._read_job(pkg, d.name)
            except RenderRefused:
                continue
            with self._lock:
                live = self._jobs.get(d.name)
            job = live if live is not None else disk
            if live is None and disk["state"] == "running":      # the app that was rendering it is gone
                disk.update(state="interrupted", error="The app closed or crashed while this was rendering.", detail="interrupted")
                self._write_job(pkg, disk)
                job = disk
            if job["state"] != "done":
                out.append(self.public(job, pkg) | {"changed": disk.get("comp_sha") != self._sha(pkg)})
        return {"jobs": out}

    def poll(self, jid: str, package: Path) -> dict:
        pkg = self._check(package)
        with self._lock:
            job = self._jobs.get(jid)
        if job is None:
            job = self._read_job(pkg, jid)
        return self.public(job, pkg)

    @staticmethod
    def public(job: dict, pkg: Path) -> dict:
        segs = job.get("segments")
        done_frames = sum(s["frames"] for s in segs if s["state"] == "done") if segs else None
        total_frames = sum(s["frames"] for s in segs) if segs else None
        base = {k: job.get(k) for k in ("id", "kind", "state", "detail", "output", "frames", "bytes", "error")}
        return base | {"elapsed": round(time.time() - job["started"], 1) if job.get("started") else 0.0, "preset": job.get("preset"),
                       "resumable": bool(job.get("resumable")), "reason": job.get("reason", ""),
                       "parts": ({"done": sum(1 for s in segs if s["state"] == "done"), "total": len(segs)} if segs else None),
                       "framesDone": done_frames, "framesTotal": total_frames}

    # ------------------------------------------------------------------ files
    @staticmethod
    def _check(package: Path) -> Path:
        pkg = Path(package).resolve()
        if pkg.suffix != ".motioncraft" or not pkg.is_dir():
            raise RenderRefused("Not a MotionCraft package folder.")
        return pkg

    @staticmethod
    def _sha(pkg: Path) -> str:
        h = hashlib.sha256()
        with open(pkg / "comp.ecproj", "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    @staticmethod
    def _write_job(pkg: Path, job: dict) -> None:
        d = pkg / PARTS / job["id"]
        d.mkdir(parents=True, exist_ok=True)
        keep = {k: v for k, v in job.items() if k not in ("adapter", "cancel")}
        tmp = d / "job.json.tmp"
        tmp.write_text(json.dumps(keep), encoding="utf-8")
        os.replace(tmp, d / "job.json")

    @staticmethod
    def _read_job(pkg: Path, jid: str) -> dict:
        if not JOB_ID.match(str(jid)):
            raise RenderRefused("Unknown render.")
        f = pkg / PARTS / jid / "job.json"
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise RenderRefused("Unknown render.") from None
        if not isinstance(j, dict) or j.get("id") != jid or not isinstance(j.get("segments"), list) or j.get("preset") not in PRESETS:
            raise RenderRefused("Unknown render.")
        return j

    @staticmethod
    def _prune(folder: Path) -> None:
        files = sorted(folder.glob("preview-*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[KEEP_PREVIEWS:]:
            old.unlink(missing_ok=True)

    @staticmethod
    def _close(adapter: Any) -> None:
        if adapter is not None:
            try:
                adapter.close()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------ joining
    def _ffmpeg_join(self, files: list[Path], out: Path, ext: str) -> None:
        ff = self._ffmpeg()
        if ff is None:
            raise RuntimeError("ffmpeg was not found, so the parts could not be joined. Install it and resume: nothing has to be rendered again.")
        lst = files[0].parent / "join.txt"
        lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in files), encoding="utf-8")
        tmp = out.with_name(out.stem + ".joining" + ext)
        r = subprocess.run([ff, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(tmp)],
                           capture_output=True, text=True, timeout=1800, shell=False, **NO_WINDOW)
        if r.returncode != 0 or not tmp.is_file():
            tmp.unlink(missing_ok=True)
            raise RuntimeError("The parts could not be joined (ffmpeg said: " + (r.stderr.strip().splitlines() or ["no message"])[-1][:200] + "). They are kept: resume to try again.")
        os.replace(tmp, out)

    def _verify_joined(self, out: Path, expected: int) -> None:
        ff = self._ffmpeg()
        probe = (shutil.which("ffprobe", path=str(Path(ff).parent)) or shutil.which("ffprobe")) if ff else None
        if not probe or self._joiner is not self._ffmpeg_join:
            return                                              # cannot check without ffprobe; the parts were each checked as they finished
        r = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(out)],
                           capture_output=True, text=True, timeout=600, shell=False, **NO_WINDOW)
        got = r.stdout.strip().splitlines()[-1:] or [""]
        if got[0].isdigit() and int(got[0]) != expected:
            out.unlink(missing_ok=True)
            raise RuntimeError(f"The joined video has {got[0]} frames, expected {expected}. The parts are kept: resume to join them again.")
