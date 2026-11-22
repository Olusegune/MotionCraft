"""P0-08 / criterion 6: text features: variable-font axis animation, right-to-left lines, per-character animators.

Builds one comp with three native text layers and renders frames to spike/results/c6_*.png for a human to look at (the
pass condition is "renders correctly", which only a person looking at the picture can confirm; this script only proves the
commands are accepted and the frames differ over time).
  1. "VARIABLE" in Bahnschrift with a per-character animator that animates the wght axis, opacity and position
  2. an Arabic line (Segoe UI, direction rtl)
  3. a Hebrew line (Segoe UI, direction rtl)
Usage: python -I -X utf8 spike/c6_text.py [--out DIR] [--shots DIR]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from mcp_client import McpClient  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c6"))
    ap.add_argument("--shots", default=str(Path(__file__).parent / "results"))
    a = ap.parse_args()
    out, shots = Path(a.out).resolve(), Path(a.shots).resolve()
    out.mkdir(parents=True, exist_ok=True)
    res: dict = {"steps": {}}
    with McpClient(out, write_roots=[out, shots], read_roots=[out]) as c:
        c.initialize()

        def step(name, cmd, params=None):
            v, e = c.run(cmd, params, raise_on_error=False)
            res["steps"][name] = {"ok": not e, "reply": str(v)[:160]}
            return v

        step("project", "file.newProject")
        comp = step("comp", "comp.new", {"name": "C6", "width": 1920, "height": 1080, "frameRate": 30, "duration": 6})["comp"]
        var = step("variable text", "layer.newText", {"text": "VARIABLE", "font": "Bahnschrift", "size": 220, "position": [960, 260]})["layer"]
        res["axes"] = step("list axes", "text.animatorFontAxes", {"layer": var})
        step("static variations", "layer.setText", {"layer": var, "variations": {"wght": 700, "wdth": 75}})
        step("animator", "layer.addTextAnimator", {"layer": var, "properties": ["opacity", "position"]})
        step("axis on animator", "text.animatorFontAxes", {"layer": var, "axis": "wght", "animator": 1})
        sel = "text/animators/animator/selectors/rangeSelector/"
        props = "text/animators/animator/properties/"
        step("animator opacity 0", "prop.set", {"layer": var, "path": props + "opacity", "value": 0})
        step("animator offset y", "prop.set", {"layer": var, "path": props + "position", "value": [0, 80, 0]})
        step("animator wght delta", "prop.set", {"layer": var, "path": props + "axis_wght", "value": -250})
        step("selector start", "prop.set", {"layer": var, "path": sel + "start", "value": 0})
        step("selector end", "prop.set", {"layer": var, "path": sel + "end", "value": 25})
        step("offset key 0s", "prop.addKey", {"layer": var, "path": sel + "offset", "time": 0, "value": -25})
        step("offset key 3s", "prop.addKey", {"layer": var, "path": sel + "offset", "time": 3, "value": 100})
        ar = step("arabic", "layer.newText", {"text": "مرحبا بالعالم", "font": "Segoe UI", "size": 160, "position": [960, 600],
                                              "direction": "rtl"})["layer"]
        he = step("hebrew", "layer.newText", {"text": "שלום עולם", "font": "Segoe UI", "size": 160, "position": [960, 850],
                                              "direction": "rtl"})["layer"]
        hashes = {}
        for t in (0.5, 1.5, 2.5, 5.0):
            png = shots / f"c6_t{t}.png"
            v, e = c.tool("render_frame", {"comp": comp, "time": t, "max_side": 1280, "path": str(png)}, raise_on_error=False)
            res["steps"][f"frame {t}"] = {"ok": not e, "reply": str(v)[:100]}
            hashes[t] = hashlib.sha256(png.read_bytes()).hexdigest()[:12] if png.is_file() else None
        res["frameHashes"] = hashes
        res["layers"] = {"variable": var, "arabic": ar, "hebrew": he}
    res["allCommandsAccepted"] = all(s["ok"] for s in res["steps"].values())
    res["framesDifferOverTime"] = len({h for h in hashes.values() if h}) > 1
    res["visualCheck"] = "NEEDS A PERSON: open spike/results/c6_t*.png and confirm Arabic/Hebrew shaping and RTL order, and the weight sweep"
    print(json.dumps(res, indent=1, ensure_ascii=False))
    return 0 if res["allCommandsAccepted"] and res["framesDifferOverTime"] else 1


if __name__ == "__main__":
    sys.exit(main())
