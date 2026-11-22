"""P0-03 / criterion 1: build a composition headlessly through `effectcraft-cli mcp` (confined, no GUI).

Creates a 1920x1080 30 fps 10 s comp with native text, a rect shape, 3 keyframes each on position and opacity, and a
camera, then saves to <out>/c1.ecproj and reads the result back. Prints one line per step and exits non-zero on any
failure. Also asserts that no GUI process (effectcraft.exe) was started by this script.

Usage: python -I spike/c1_headless.py [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from mcp_client import McpClient  # noqa: E402


def gui_pids() -> set[str]:
    if sys.platform != "win32":
        out = subprocess.run(["pgrep", "-x", "effectcraft"], capture_output=True, text=True).stdout
        return set(out.split())
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq effectcraft.exe", "/FO", "CSV", "/NH"],
                         capture_output=True, text=True).stdout
    return {line.split(",")[1].strip('"') for line in out.splitlines() if line.lower().startswith('"effectcraft.exe"')}


def build_c1(c: McpClient, ecproj: Path, log=print) -> dict:
    """Builds the c1 composition. Returns ids. Reused by the c2-c4 spike scripts."""
    steps: list[tuple[str, bool, str]] = []

    def step(name, cmd, params=None):
        t0 = time.perf_counter()
        val, err = c.run(cmd, params, raise_on_error=False)
        dt = time.perf_counter() - t0
        steps.append((name, not err, f"{dt:.3f}s"))
        log(f"{'OK  ' if not err else 'FAIL'} {name:<34} {cmd:<18} {dt:6.3f}s  {json.dumps(val)[:90]}")
        if err:
            raise SystemExit(f"step failed: {name}: {val}")
        return val

    step("new project", "file.newProject")
    comp = step("new comp 1920x1080 30fps 10s", "comp.new",
                {"name": "C1", "width": 1920, "height": 1080, "frameRate": 30, "duration": 10})["comp"]
    text = step("native text layer", "layer.newText", {"text": "MotionCraft", "size": 160, "name": "Title"})["layer"]
    shape = step("rect shape layer", "layer.newShape", {"kind": "rect", "size": [400, 200], "fill": [0.28, 0.86, 0.9],
                                                         "name": "Bar"})["layer"]
    for name, layer, path, keys in [
        ("title position keys", text, "transform/position", [(0, [960, 300, 0]), (1, [960, 540, 0]), (3, [960, 600, 0])]),
        ("title opacity keys", text, "transform/opacity", [(0, 0), (1, 100), (9, 100)]),
        ("bar position keys", shape, "transform/position", [(0, [200, 900, 0]), (2, [960, 900, 0]), (4, [1700, 900, 0])]),
        ("bar opacity keys", shape, "transform/opacity", [(0, 0), (0.5, 100), (9, 100)]),
    ]:
        for t, v in keys:
            step(f"{name} @ {t}s", "prop.addKey", {"layer": layer, "path": path, "time": t, "value": v})
    camera = step("camera layer", "layer.newCamera", {"name": "Camera"})["layer"]
    step("save", "file.save", {"path": str(ecproj)})
    return {"comp": comp, "text": text, "shape": shape, "camera": camera, "steps": steps}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c1"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    before = gui_pids()
    ecproj = out / "c1.ecproj"
    with McpClient(out) as c:
        c.initialize()
        ids = build_c1(c, ecproj)
        # read back: layers present and keyframes counted
        doc, _ = c.tool("doc_inspect")
        layers = doc["activeComp"]["layers"]
        types = sorted(l["type"] for l in layers)
        keys = {}
        for lid, path in [(ids["text"], "transform/position"), (ids["text"], "transform/opacity"),
                          (ids["shape"], "transform/position"), (ids["shape"], "transform/opacity")]:
            p, _ = c.tool("get_property", {"layer": lid, "path": path})
            keys[f"{lid}:{path}"] = len(p.get("keys", []))
    after = gui_pids()
    ok = (types == ["Camera", "Shape", "Text"] and all(n == 3 for n in keys.values()) and ecproj.is_file()
          and not (after - before))
    print(json.dumps({"layerTypes": types, "keyframeCounts": keys, "ecprojBytes": ecproj.stat().st_size,
                      "newGuiProcesses": sorted(after - before), "pass": ok}, indent=1))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
