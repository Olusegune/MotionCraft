"""P0-14: can the EffectCraft GUI be started on a given project AND composition, and brought back to the front later?

Builds a project with comps A, B (B created last), saves it, launches `effectcraft --control <port> <file>`, then reads
editor.state to see which comp is active, and tries `comp.open {comp:"A"}` through the control channel. Finally looks at
what the control channel offers for refocusing the window. Opens a real window briefly and closes it.

Usage: python -I -X utf8 spike/c10_open_comp.py [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c5_gui_bridge import Control, free_port  # noqa: E402
from mcp_client import McpClient, default_cli  # noqa: E402


def active(ctl: Control):
    st = ctl.call("engine.execute", {"command": "editor.state"})
    return st.get("activeComp") or st.get("comp") or st


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c10"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    ecproj = out / "two.ecproj"
    with McpClient(out) as c:
        c.initialize()
        c.run("file.newProject")
        ca = c.run("comp.new", {"name": "Comp A", "width": 1280, "height": 720, "duration": 4})[0]["comp"]
        c.run("layer.newText", {"text": "A"})
        cb = c.run("comp.new", {"name": "Comp B", "width": 1920, "height": 1080, "duration": 6})[0]["comp"]
        c.run("layer.newText", {"text": "B"})
        c.run("file.save", {"path": str(ecproj)})
    cli = default_cli()
    gui = cli.with_name("effectcraft.exe" if os.name == "nt" else "effectcraft")
    port = free_port()
    env = dict(os.environ, EFFECTCRAFT_CONFIG_DIR=str(out / "cfg"))
    proc = subprocess.Popen([str(gui), "--control", str(port), str(ecproj)], env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, shell=False)
    res: dict = {"compIds": {"A": ca, "B": cb}}
    try:
        ctl = None
        for _ in range(120):
            try:
                ctl = Control(port)
                break
            except OSError:
                time.sleep(0.5)
        if ctl is None:
            print(json.dumps({"error": "control port never opened"}))
            return 1
        time.sleep(2)
        res["projectOpenedFromCommandLineArg"] = ctl.call("engine.execute", {"command": "project.summary"})
        res["activeCompAfterLaunch"] = active(ctl)
        try:
            res["compOpenA"] = ctl.call("engine.execute", {"command": "comp.open", "params": {"comp": "Comp A"}})
        except RuntimeError as e:
            res["compOpenA"] = f"ERROR {e}"
        res["activeCompAfterCompOpen"] = active(ctl)
        # refocus: look for anything window-raising in the command list the GUI exposes
        cmds = ctl.call("engine.commands", {"filter": "focus"})
        res["focusCommands"] = [x["id"] for x in cmds][:10] if isinstance(cmds, list) else cmds
    finally:
        proc.kill()
    res["activeCompAfterLaunch"] = res["activeCompAfterLaunch"].get("active_comp") if isinstance(res["activeCompAfterLaunch"], dict) else res["activeCompAfterLaunch"]
    res["activeCompAfterCompOpen"] = res["activeCompAfterCompOpen"].get("active_comp") if isinstance(res["activeCompAfterCompOpen"], dict) else res["activeCompAfterCompOpen"]
    res["projectOpenedFromCommandLineArg"] = {k: res["projectOpenedFromCommandLineArg"][k] for k in ("activeComp", "path", "dirty", "renderer")}
    print(json.dumps(res, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
