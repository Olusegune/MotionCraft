"""P0-05 / criterion 3: time preview renders of the c1 comp.

Measures, headless (CPU renderer unless --gpu), against the PRD targets: first preview <= 60 s, edit preview <= 10 s.
  1. render_preview at 5 single times (first call is the cold one), at max_side 960
  2. render_preview contact sheet of the same 5 times
  3. an edit: change title text, then render_preview again (the "edit preview")
  4. a 10 s H.264 preview movie at half resolution through the render queue
Records the active renderer (get_project.renderer) and wall seconds. Machine specs are written by p0_01_build.ps1;
copy them into the report next to these numbers.

Usage: python -I spike/c3_preview.py [--gpu] [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from mcp_client import McpClient  # noqa: E402

TIMES = [0.0, 1.0, 2.5, 5.0, 9.0]


def timed(fn):
    t0 = time.perf_counter()
    r = fn()
    return r, round(time.perf_counter() - t0, 3)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpu", action="store_true")
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c3"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    ecproj = out / "c3.ecproj"
    res: dict = {"gpuRequested": a.gpu}
    with McpClient(out, extra_args=["--gpu"] if a.gpu else []) as c:
        c.initialize()
        ids = build_c1(c, ecproj, log=lambda *_: None)
        proj, _ = c.tool("get_project")
        res["renderer"] = proj.get("renderer")
        singles = []
        for t in TIMES:
            (v, err), dt = timed(lambda t=t: c.tool("render_preview", {"comp": ids["comp"], "time": t, "max_side": 960}, raise_on_error=False))
            singles.append({"time": t, "seconds": dt, "error": bool(err), "meta": v if isinstance(v, dict) else str(v)[:120]})
        res["singlePreviews"] = singles
        res["firstPreviewSeconds"] = singles[0]["seconds"]
        (v, err), dt = timed(lambda: c.tool("render_preview", {"comp": ids["comp"], "times": TIMES, "max_side": 480}, raise_on_error=False))
        res["contactSheet"] = {"seconds": dt, "error": bool(err)}
        c.run("layer.setText", {"layer": ids["text"], "text": "Edited title"})
        (v, err), dt = timed(lambda: c.tool("render_preview", {"comp": ids["comp"], "time": 1.0, "max_side": 960}, raise_on_error=False))
        res["editPreviewSeconds"] = dt
        mp4 = out / "preview10s.mp4"
        c.run("renderQueue.add", {"comp": ids["comp"], "format": "h264", "output": str(mp4), "resolution": "half"}, raise_on_error=False)
        (v, err), dt = timed(lambda: c.run("renderQueue.render", {"wait": True}, raise_on_error=False))
        res["movie10s"] = {"seconds": dt, "error": bool(err), "exists": mp4.is_file(),
                           "bytes": mp4.stat().st_size if mp4.is_file() else 0, "reply": str(v)[:300]}
    res["targets"] = {"firstPreviewSeconds": 60, "editPreviewSeconds": 10}
    res["meetsFirst"] = res["firstPreviewSeconds"] <= 60
    res["meetsEdit"] = res["editPreviewSeconds"] <= 10
    print(json.dumps(res, indent=1))
    return 0 if res["meetsFirst"] and res["meetsEdit"] else 1


if __name__ == "__main__":
    sys.exit(main())
