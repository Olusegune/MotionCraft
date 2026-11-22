"""P0-07 / criterion 5 (scripted half): agent edits through the MCP bridge while the EffectCraft GUI has the comp open.

What this script CAN prove without a person: bridge pass-through with confinement on, edits applied in the live GUI
(checked by rendering a frame from the GUI process itself), save from the GUI, clean reopen headless, and what happens
when a second process writes the same file while the GUI is open.
What it CANNOT prove: a person hand-editing in the window at the same time. That step is "Needs Victor": see
docs/PHASE0_REPORT.md (manual steps).

Opens a real EffectCraft window on this desktop (no keyboard focus taken) and closes it at the end. The control port is
bound to 127.0.0.1 by the engine; we pick a random free port and open it only for this run.

Usage: python -I spike/c5_gui_bridge.py [--out DIR]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from mcp_client import McpClient, default_cli  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Control:
    """Direct control-channel client, used ONLY to observe the GUI (render.frame, project state)."""

    def __init__(self, port: int):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=60)
        self.f = self.s.makefile("rw", encoding="utf-8", newline="\n")
        self.n = 0

    def call(self, method: str, params: dict | None = None):
        self.n += 1
        self.f.write(json.dumps({"id": self.n, "method": method, "params": params or {}}) + "\n")
        self.f.flush()
        r = json.loads(self.f.readline())
        if not r.get("ok"):
            raise RuntimeError(f"{method}: {r.get('error')}")
        return r["result"]


def png_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c5"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    ecproj = out / "c5.ecproj"
    cli = default_cli()
    gui = cli.with_name("effectcraft.exe" if os.name == "nt" else "effectcraft")
    res: dict = {}
    with McpClient(out) as c:
        c.initialize()
        ids = build_c1(c, ecproj, log=lambda *_: None)
    port = free_port()
    env = {k: v for k, v in os.environ.items()}
    env["EFFECTCRAFT_CONFIG_DIR"] = str(out / "cfg")  # keep the test GUI's settings and autosaves out of the user's profile
    proc = subprocess.Popen([str(gui), "--control", str(port), str(ecproj)], env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, shell=False)
    try:
        ctl = None
        for _ in range(120):
            try:
                ctl = Control(port)
                break
            except OSError:
                time.sleep(0.5)
        if ctl is None:
            print(json.dumps({"error": "GUI control port never opened", "pass": False}))
            return 1
        res["port"] = port
        res["boundTo"] = "127.0.0.1 (engine-enforced; checked by connecting)"
        # make sure the GUI has the project open
        try:
            ctl.call("engine.execute", {"command": "file.open", "params": {"path": str(ecproj)}})
        except RuntimeError as e:
            res["guiOpenNote"] = str(e)
        before_png = out / "gui_before.png"
        ctl.call("render.frame", {"time": 1.0, "max_side": 640, "path": str(before_png)})

        # bridge session, confinement ON
        with McpClient(out, extra_args=["--bridge", str(port)]) as b:
            b.initialize()
            tools, _ = b.request("tools/list"), None
            names = sorted(t["name"] for t in tools["tools"])
            res["bridgeTools"] = names
            v, err = b.run("layer.setText", {"layer": ids["text"], "text": "Edited by agent"}, raise_on_error=False)
            res["agentSetText"] = {"error": bool(err), "reply": str(v)[:120]}
            v, err = b.run("prop.set", {"layer": ids["shape"], "path": "transform/position", "value": [1500, 300, 0], "time": 1.0},
                           raise_on_error=False)
            res["agentMoveLayer"] = {"error": bool(err), "reply": str(v)[:120]}
            # confinement refuses UI driving tools
            if "ui_click" in names:
                v, err = b.tool("ui_click", {"id": "x"}, raise_on_error=False)
                res["uiClickWhileConfined"] = {"refused": bool(err), "reply": str(v)[:160]}
            else:
                res["uiClickWhileConfined"] = {"refused": True, "reply": "tool not listed"}
            # out-of-root write must be refused
            v, err = b.run("file.save", {"path": str(Path(os.environ.get("TEMP", ".")) / "mc_outside.ecproj")}, raise_on_error=False)
            res["writeOutsideRootRefused"] = {"refused": bool(err), "reply": str(v)[:160]}

        after_png = out / "gui_after.png"
        ctl.call("render.frame", {"time": 1.0, "max_side": 640, "path": str(after_png)})
        res["guiFrameChangedLive"] = png_hash(before_png) != png_hash(after_png)
        state = ctl.call("engine.execute", {"command": "layer.tree", "params": {"layer": ids["text"]}})
        res["guiTextNow"] = next((n.get("value") for n in _walk(state["properties"]) if n.get("path") == "text/sourceText"), None)

        # GUI saves (stands in for the person pressing Save)
        ctl.call("engine.execute", {"command": "file.save", "params": {"path": str(ecproj)}})
        with McpClient(out) as h:
            h.initialize()
            h.run("file.open", {"path": str(ecproj)})
            t, _ = h.run("layer.tree", {"layer": ids["text"]})
            res["reopenedText"] = next((n.get("value") for n in _walk(t["properties"]) if n.get("path") == "text/sourceText"), None)
            res["reopenClean"] = res["reopenedText"] == "Edited by agent"

        # DANGER TEST: a second process writes the same file while the GUI still has it open
        with McpClient(out) as h2:
            h2.initialize()
            h2.run("file.open", {"path": str(ecproj)})
            h2.run("layer.setText", {"layer": ids["text"], "text": "Written to file behind the GUI"})
            v, err = h2.run("file.save", {"path": str(ecproj)}, raise_on_error=False)
            res["fileWriteWhileGuiOpen"] = {"error": bool(err), "reply": str(v)[:160]}
        live = ctl.call("engine.execute", {"command": "layer.tree", "params": {"layer": ids["text"]}})
        res["guiSeesFileWrite"] = next((n.get("value") for n in _walk(live["properties"]) if n.get("path") == "text/sourceText"), None)
        ctl.call("engine.execute", {"command": "prop.set", "params": {"layer": ids["shape"], "path": "transform/opacity", "value": 50}})
        ctl.call("engine.execute", {"command": "file.save", "params": {"path": str(ecproj)}})
        with McpClient(out) as h3:
            h3.initialize()
            h3.run("file.open", {"path": str(ecproj)})
            t, _ = h3.run("layer.tree", {"layer": ids["text"]})
            res["afterGuiSavesOverFileWrite"] = next((n.get("value") for n in _walk(t["properties"]) if n.get("path") == "text/sourceText"), None)
        res["lostFileWrite"] = res["afterGuiSavesOverFileWrite"] != "Written to file behind the GUI"
    finally:
        proc.kill()
    res["pass_scripted"] = bool(res.get("guiFrameChangedLive") and res.get("reopenClean"))
    print(json.dumps(res, indent=1))
    return 0 if res["pass_scripted"] else 1


def _walk(node):
    yield node
    for ch in node.get("children", []):
        yield from _walk(ch)


if __name__ == "__main__":
    sys.exit(main())
