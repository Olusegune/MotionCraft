"""Drive a BUILT MotionCraft from outside, through its own web view (Chrome DevTools protocol), to walk the real app and take screenshots.

Used for the Civilization walkthrough (docs/walkthrough). Needs: pip install websockets. Windows, the portable layout (MotionCraft.exe next to motioncraft-engine.exe).

    from drive_app import App
    app = App.launch(r"portable\\MotionCraft\\MotionCraft.exe")   # or App.attach() when it is already running with the debug port
    app.click_text("New project"); app.shot("docs/walkthrough/01.png")

Native file dialogs cannot be driven from here. Where the walkthrough would use one, `invoke()` calls the same app command the dialog would
(for example import_asset), and the walkthrough says so.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import websockets

PORT = 9444

FIND_JS = r"""
(function () {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  window.__mc = {
    norm, visible,
    all: (sel) => Array.from(document.querySelectorAll(sel)).filter(visible),
    byText: (text, sel, exact) => {
      const t = norm(text).toLowerCase();
      const els = Array.from(document.querySelectorAll(sel || 'button, a, [role=button], [role=tab], summary, label, li, h1, h2, h3, span, p'));
      const hit = els.filter(visible).filter((e) => { const x = norm(e.innerText || e.getAttribute('aria-label') || e.title || '').toLowerCase(); return exact ? x === t : x.includes(t); });
      hit.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
      return hit[0] || null;
    },
    setValue: (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  };
  return true;
})()
"""


class App:
    def __init__(self, proc: subprocess.Popen | None, ws_url: str):
        self.proc = proc
        self.ws_url = ws_url
        self.loop = asyncio.new_event_loop()
        self.ws = self.loop.run_until_complete(websockets.connect(ws_url, max_size=None))
        self.n = 0
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.inject()

    # ---------------------------------------------------------------- connection
    @staticmethod
    def _page():
        for _ in range(120):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=1))
                pages = [t for t in targets if t.get("type") == "page" and "splash" not in t.get("url", "")]
                if pages:
                    return pages[0]
            except Exception:
                pass
            time.sleep(0.5)
        raise RuntimeError("no MotionCraft page found on the debug port")

    @classmethod
    def launch(cls, exe: str, wait: float = 6.0) -> "App":
        env = dict(os.environ, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={PORT}")
        proc = subprocess.Popen([exe], env=env)
        time.sleep(wait)
        return cls(proc, cls._page()["webSocketDebuggerUrl"])

    @classmethod
    def attach(cls) -> "App":
        return cls(None, cls._page()["webSocketDebuggerUrl"])

    def close(self):
        try:
            self.loop.run_until_complete(self.ws.close())
        finally:
            if self.proc:
                self.proc.terminate()

    def call(self, method: str, params: dict | None = None) -> dict:
        self.n += 1
        n = self.n

        async def go():
            await self.ws.send(json.dumps({"id": n, "method": method, "params": params or {}}))
            while True:
                m = json.loads(await self.ws.recv())
                if m.get("id") == n:
                    return m
        return self.loop.run_until_complete(go())

    def inject(self):
        self.eval(FIND_JS)

    # ---------------------------------------------------------------- page access
    def eval(self, js: str, await_promise: bool = False):
        r = self.call("Runtime.evaluate", {"expression": js, "awaitPromise": await_promise, "returnByValue": True})
        res = (r.get("result") or {}).get("result") or {}
        if "exceptionDetails" in (r.get("result") or {}):
            raise RuntimeError(json.dumps(r["result"]["exceptionDetails"])[:600])
        return res.get("value")

    def invoke(self, command: str, args: dict | None = None):
        """Call an app command from inside the page, as the app's own code does."""
        js = f"(async () => {{ try {{ return JSON.stringify({{ok: await window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args or {})})}}); }} catch (e) {{ return JSON.stringify({{err: String(e)}}); }} }})()"
        out = json.loads(self.eval(js, True))
        if "err" in out:
            raise RuntimeError(f"{command}: {out['err']}")
        return out["ok"]

    def text(self) -> str:
        return self.eval("document.body.innerText") or ""

    def has_text(self, t: str) -> bool:
        return t.lower() in self.text().lower()

    def wait_text(self, t: str, timeout: float = 30) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if self.has_text(t):
                return True
            time.sleep(0.4)
        raise TimeoutError(f"never saw {t!r}. Page says: {self.text()[:400]!r}")

    def wait_gone(self, t: str, timeout: float = 60) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if not self.has_text(t):
                return True
            time.sleep(0.5)
        raise TimeoutError(f"{t!r} never went away")

    # ---------------------------------------------------------------- actions
    def click_text(self, text: str, sel: str | None = None, exact: bool = False, pause: float = 0.5):
        ok = self.eval(f"(() => {{ const e = window.__mc.byText({json.dumps(text)}, {json.dumps(sel)}, {json.dumps(exact)}); if (!e) return false; e.scrollIntoView({{block:'center'}}); e.click(); return true; }})()")
        if not ok:
            raise LookupError(f"nothing to click that says {text!r}. Page says: {self.text()[:300]!r}")
        time.sleep(pause)

    def click_selector(self, sel: str, index: int = 0, pause: float = 0.5):
        ok = self.eval(f"(() => {{ const e = window.__mc.all({json.dumps(sel)})[{index}]; if (!e) return false; e.scrollIntoView({{block:'center'}}); e.click(); return true; }})()")
        if not ok:
            raise LookupError(f"nothing matches {sel!r}")
        time.sleep(pause)

    def fill(self, sel: str, value: str, index: int = 0):
        ok = self.eval(f"(() => {{ const e = window.__mc.all({json.dumps(sel)})[{index}]; if (!e) return false; e.focus(); window.__mc.setValue(e, {json.dumps(value)}); return true; }})()")
        if not ok:
            raise LookupError(f"nothing matches {sel!r}")
        time.sleep(0.3)

    def fill_label(self, label: str, value: str):
        """Fill the field whose label (or aria-label, or placeholder) contains `label`."""
        js = f"""(() => {{
          const t = {json.dumps(label)}.toLowerCase();
          const fields = window.__mc.all('input, textarea, select');
          const lab = (f) => {{ const l = f.labels && f.labels[0] ? f.labels[0].innerText : ''; return (l + ' ' + (f.getAttribute('aria-label')||'') + ' ' + (f.placeholder||'')).toLowerCase(); }};
          const e = fields.find((f) => lab(f).includes(t));
          if (!e) return false; e.focus(); window.__mc.setValue(e, {json.dumps(value)}); return true; }})()"""
        if not self.eval(js):
            raise LookupError(f"no field labelled {label!r}")
        time.sleep(0.3)

    def key(self, key: str):
        code = {"Enter": 13, "Escape": 27}.get(key, 0)
        for t in ("keyDown", "keyUp"):
            self.call("Input.dispatchKeyEvent", {"type": t, "key": key, "code": key, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code})

    def scroll_to_text(self, text: str):
        self.eval(f"(() => {{ const e = window.__mc.byText({json.dumps(text)}); if (e) e.scrollIntoView({{block:'center'}}); return !!e; }})()")
        time.sleep(0.4)

    def shot(self, path: str | Path, fmt: str = "jpeg", quality: int = 82) -> Path:
        r = self.call("Page.captureScreenshot", {"format": fmt, "quality": quality} if fmt == "jpeg" else {"format": fmt})
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(base64.b64decode(r["result"]["data"]))
        return p


def _select_option(self, label: str, option_text: str):
    """Choose an option of the <select> whose label contains `label`, by the option's visible text."""
    js = f"""(() => {{
      const t = {json.dumps(label)}.toLowerCase(); const o = {json.dumps(option_text)}.toLowerCase();
      const s = window.__mc.all('select').find((f) => ((f.labels && f.labels[0] ? f.labels[0].innerText : '') + ' ' + (f.getAttribute('aria-label') || '')).toLowerCase().includes(t));
      if (!s) return 'no select'; const op = Array.from(s.options).find((x) => x.text.toLowerCase().includes(o)); if (!op) return 'no option';
      window.__mc.setValue(s, op.value); return 'ok'; }})()"""
    r = self.eval(js)
    if r != "ok":
        raise LookupError(f"{label!r} / {option_text!r}: {r}")
    time.sleep(0.3)


App.select_label = _select_option
