"""P0-15: cost of revision snapshots with file.saveCopy.

Measures wall time and file size of file.saveCopy (5 repeats, median) on
  small : the c1 comp (3 layers, 10 s)
  large : a 60 s comp with 30 layers (15 text, 15 shapes), 4 keyframes on position and opacity each
Also reports how well the copies compress (zip) since packages may store many of them.

Usage: python -I -X utf8 spike/c9_snapshots.py [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from mcp_client import McpClient  # noqa: E402


def measure(c: McpClient, out: Path, label: str, n: int = 5) -> dict:
    times, sizes = [], []
    for i in range(n):
        p = out / f"{label}_{i}.ecproj"
        t0 = time.perf_counter()
        v, e = c.run("file.saveCopy", {"path": str(p)}, raise_on_error=False)
        times.append(time.perf_counter() - t0)
        if e:
            return {"error": str(v)[:200]}
        sizes.append(p.stat().st_size)
    z = out / f"{label}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(out / f"{label}_0.ecproj", "snap.ecproj")
    return {"saveCopySecondsMedian": round(statistics.median(times), 4), "saveCopySecondsMax": round(max(times), 4),
            "bytes": sizes[0], "zippedBytes": z.stat().st_size}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c9"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    res: dict = {}
    with McpClient(out) as c:
        c.initialize()
        build_c1(c, out / "small.ecproj", log=lambda *_: None)
        res["small_3_layers_10s"] = measure(c, out, "small")
    with McpClient(out) as c:
        c.initialize()
        c.run("file.newProject")
        c.run("comp.new", {"name": "Big", "width": 1920, "height": 1080, "frameRate": 30, "duration": 60})
        for i in range(30):
            if i % 2 == 0:
                lid = c.run("layer.newText", {"text": f"Line {i}", "size": 60, "position": [960, 40 + i * 30]})[0]["layer"]
            else:
                lid = c.run("layer.newShape", {"kind": "rect", "size": [200, 40], "fill": [0.2, 0.6, 0.9]})[0]["layer"]
            for t, v in ((0, 0), (5, 100), (30, 100), (59, 0)):
                c.run("prop.addKey", {"layer": lid, "path": "transform/opacity", "time": t, "value": v})
            for t, x in ((0, 100), (20, 900), (40, 1500), (59, 1800)):
                c.run("prop.addKey", {"layer": lid, "path": "transform/position", "time": t, "value": [x, 40 + i * 30, 0]})
        c.run("file.save", {"path": str(out / "large.ecproj")})
        res["large_30_layers_60s"] = measure(c, out, "large")
    print(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
