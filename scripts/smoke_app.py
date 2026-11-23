"""Smoke test of a BUILT app, from inside its own web view: do the engine commands work, and is the engine helper running?

Why this exists: the unit tests call Rust functions directly and never go through the app's command layer, so a missing
`.manage(EngineState)` made every engine call fail in every packaged build and nothing noticed.

Usage (Windows, needs: pip install websockets):
    python scripts/smoke_app.py path\\to\\MotionCraft.exe
The folder holding the exe must also hold motioncraft-engine.exe (the portable layout). Exit code 0 = pass.
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

import websockets

PORT = 9333


def helper_running() -> bool:
    out = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-Process -Name motioncraft-engine -ErrorAction SilentlyContinue | Measure-Object).Count"],
                         capture_output=True, text=True).stdout.strip()
    return out.isdigit() and int(out) > 0


async def check(ws_url: str) -> dict:
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

        js = """(async () => {
          if (!window.__TAURI_INTERNALS__ || document.readyState !== "complete") return JSON.stringify({notReady: true});
          const out = {};
          const inv = window.__TAURI_INTERNALS__.invoke;
          try { out.status = (await inv("engine_status", {overridePath: ""})).state; } catch (e) { out.status = "ERROR " + e; }
          try { out.llm = (await inv("engine_call", {method: "llm_status", params: {offline: false}, overridePath: "", package: null})).manual_mode_works === true; }
          catch (e) { out.llm = "ERROR " + e; }
          try { out.primitives = (await inv("engine_call", {method: "primitives", params: {}, overridePath: "", package: null})); }
          catch (e) { out.primitives = "ERROR " + e; }
          return JSON.stringify(out);
        })()"""
        last = None
        for _ in range(40):            # the page can be found before its front end has finished loading: wait for it
            r = await call("Runtime.evaluate", {"expression": js, "awaitPromise": True, "returnByValue": True})
            res = (r.get("result") or {}).get("result") or {}
            last = r
            if isinstance(res.get("value"), str):
                out = json.loads(res["value"])
                if not out.get("notReady"):
                    return out
            await asyncio.sleep(0.5)
        raise RuntimeError(f"the page never became ready: {json.dumps(last)[:400]}")


def main(exe: str) -> int:
    env = dict(os.environ, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={PORT}")
    proc = subprocess.Popen([exe], env=env)
    try:
        page = None
        for _ in range(80):
            time.sleep(0.5)
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=1))
                pages = [t for t in targets if t.get("type") == "page" and "splash" not in t.get("url", "")]
                if pages:
                    page = pages[0]
                    break
            except Exception:
                pass
        if not page:
            print("FAIL: the app's window never appeared")
            return 1
        res = asyncio.run(check(page["webSocketDebuggerUrl"]))
        time.sleep(0.5)
        prims = res.get("primitives")
        checks = {
            "engine_status answers": isinstance(res.get("status"), str) and not res["status"].startswith("ERROR"),
            "engine_call reaches the helper (llm_status)": res.get("llm") is True,
            "helper lists the primitives": isinstance(prims, dict) and len(prims.get("primitives", [])) > 0,
            "helper process is running": helper_running(),
        }
        for k, v in checks.items():
            print(("PASS " if v else "FAIL ") + k + ("" if v else f"   ({res})"))
        return 0 if all(checks.values()) else 1
    finally:
        proc.kill()
        subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Process | Where-Object { $_.Name -like 'motioncraft*' } | Stop-Process -Force"], capture_output=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
