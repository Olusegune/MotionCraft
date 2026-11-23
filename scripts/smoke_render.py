"""Smoke test of render cancel + resume in a BUILT app, through the app's own command layer (the same calls the Deliver page makes).

Creates a throwaway project in the user's MotionCraft folder, renders a 60 s ProRes clip in parts, cancels it part-way, resumes it, and
checks the finished movie's frame count with ffprobe. The project is deleted afterwards.

Usage (Windows; needs: pip install websockets; ffmpeg and ffprobe on PATH; EffectCraft installed):
    python scripts/smoke_render.py path\\to\\MotionCraft.exe
The folder holding the exe must also hold motioncraft-engine.exe. Exit code 0 = pass.
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websockets

PORT = 9334
SECONDS, FPS = 60, 30

JS = """(async (secs, fps) => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const call = (method, params, pkg) => inv("engine_call", {method, params, overridePath: "", package: pkg ?? null});
  const out = {log: []};
  const project = {schemaVersion: "1.0", id: "smoke-render", name: "SmokeRender" + Date.now(), brief: {text: "", audio: [], references: [], brandDocs: [], storyboards: [], deliverables: []}};
  const sum = await inv("create_project", {project});
  out.path = sum.path;
  await call("open", {settings: {name: "Main", width: 960, height: 540, frame_rate: fps, duration: secs}, locked: []}, sum.path);
  await call("builder_execute", {plan: {layers: [{kind: "solid", name: "Back", color: [0.1, 0.2, 0.4]},
    {kind: "text", name: "T", text: "Smoke", size: 120, animations: [{primitive: "motion.drift", start: 0, duration: secs, params: {dx: 300}}]}]}});
  const tok1 = await inv("confirm_spend", {provider: "local-render", model: "prores4444"});
  let job = await call("render_start", {preset: "prores4444", name: "Smoke", spend_token: tok1});
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    job = await call("render_poll", {job: job.id});
    if (job.state !== "running" || (job.parts && job.parts.done >= 3)) break;
    await new Promise(r => setTimeout(r, 30));
  }
  out.resumable = job.resumable; out.reason = job.reason;   // decided by the worker, so read from a poll, not from the start reply
  out.stateBeforeCancel = job.state; out.doneBeforeCancel = job.parts && job.parts.done;
  await call("render_cancel", {job: job.id});
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) { job = await call("render_poll", {job: job.id}); if (job.state !== "running") break; await new Promise(r => setTimeout(r, 50)); }
  out.afterCancel = {state: job.state, error: job.error, parts: job.parts};
  out.unfinished = (await call("render_jobs", {})).jobs.map(j => ({id: j.id, state: j.state, parts: j.parts, changed: j.changed}));
  // a resume without a fresh click is refused by the shell
  try { await call("render_resume", {job: job.id, spend_token: "not-from-a-click"}); out.refusedWithoutClick = false; } catch (e) { out.refusedWithoutClick = String(e); }
  const tok2 = await inv("confirm_spend", {provider: "local-render", model: "prores4444"});
  let res = await call("render_resume", {job: job.id, spend_token: tok2});
  const t2 = Date.now();
  while (Date.now() - t2 < 240000) { res = await call("render_poll", {job: job.id}); if (res.state !== "running") break; await new Promise(r => setTimeout(r, 100)); }
  out.final = {state: res.state, frames: res.frames, output: res.output, error: res.error};
  return JSON.stringify(out);
})""" + f"({SECONDS}, {FPS})"


async def run(ws_url: str) -> dict:
    async with websockets.connect(ws_url, max_size=None) as ws:
        n = 0

        async def call(method, params=None):
            nonlocal n
            n += 1
            await ws.send(json.dumps({"id": n, "method": method, "params": params or {}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == n:
                    return m

        for _ in range(60):
            r = await call("Runtime.evaluate", {"expression": "!!window.__TAURI_INTERNALS__ && document.readyState === 'complete'", "returnByValue": True})
            if r["result"]["result"].get("value") is True:
                break
            await asyncio.sleep(0.5)
        r = await call("Runtime.evaluate", {"expression": JS, "awaitPromise": True, "returnByValue": True, "timeout": 420000})
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return {"exception": json.dumps(res["exceptionDetails"])[:600]}
        return json.loads(res["result"]["value"])


def frames(path: Path) -> int:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout
    return int(out.strip().splitlines()[-1])


def main(exe: str) -> int:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("NOT CHECKED: ffmpeg/ffprobe are not installed")
        return 2
    env = dict(os.environ, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={PORT}")
    proc = subprocess.Popen([exe], env=env)
    pkg = None
    try:
        page = None
        for _ in range(80):
            time.sleep(0.5)
            try:
                t = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=1))
                pages = [x for x in t if x.get("type") == "page" and "splash" not in x.get("url", "")]
                if pages:
                    page = pages[0]
                    break
            except Exception:
                pass
        if not page:
            print("FAIL: the app's window never appeared")
            return 1
        res = asyncio.run(run(page["webSocketDebuggerUrl"]))
        if "exception" in res:
            print("FAIL: script error", res["exception"])
            return 1
        pkg = Path(res["path"]) if res.get("path") else None
        fin = res.get("final", {})
        checks = {
            "render is split into parts and resumable": res.get("resumable") is True,
            "it was still running when cancelled": res.get("stateBeforeCancel") == "running" and (res.get("doneBeforeCancel") or 0) >= 3,
            "cancel leaves it interrupted with parts kept": res.get("afterCancel", {}).get("state") == "interrupted" and 3 <= (res["afterCancel"].get("parts") or {}).get("done", 0) < (res["afterCancel"].get("parts") or {}).get("total", 0),
            "the interrupted render is listed": len(res.get("unfinished", [])) == 1 and res["unfinished"][0]["changed"] is False,
            "resume without a click is refused": isinstance(res.get("refusedWithoutClick"), str) and "confirmation" in res["refusedWithoutClick"],
            "resume finishes": fin.get("state") == "done",
            "the movie has every frame": bool(fin.get("output")) and pkg is not None and frames(pkg / fin["output"]) == SECONDS * FPS == fin.get("frames"),
        }
        for k, v in checks.items():
            print(("PASS " if v else "FAIL ") + k + ("" if v else f"   ({json.dumps(res)[:400]})"))
        return 0 if all(checks.values()) else 1
    finally:
        proc.kill()
        subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Process | Where-Object { $_.Name -like 'motioncraft*' } | Stop-Process -Force"], capture_output=True)
        time.sleep(1)
        if pkg and pkg.suffix == ".motioncraft" and pkg.parent.name == "MotionCraft":
            shutil.rmtree(pkg, ignore_errors=True)       # the throwaway project


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
