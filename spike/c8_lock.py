"""P0-10: what does EffectCraft's native lock switch actually stop?

Locks the title text layer with layer.setSwitch lock=true, then fires layer-targeting commands at it, one fresh session
each, and classifies the outcome by comparing a canonical hash of the layer before and after:
  blocked  : command errored AND layer unchanged
  skipped  : command reported success but layer unchanged
  APPLIED  : layer changed despite the lock  (the adapter's own lock check MUST cover these)
Feeds ENGINE_ADAPTER.md "Lock check". Usage: python -I spike/c8_lock.py [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from c2_roundtrip import layer_hash  # noqa: E402
from mcp_client import McpClient  # noqa: E402


def tests(t: int, s: int) -> list[tuple[str, str, dict]]:
    # Parameter names confirmed against the command snapshot: most layer commands take `layers` (a list) and fall back to
    # the current selection when it is omitted; prop.* and layer.rename take `layer`.
    return [
        ("set property (explicit layer)", "prop.set", {"layer": t, "path": "transform/opacity", "value": 10}),
        ("add keyframe", "prop.addKey", {"layer": t, "path": "transform/opacity", "time": 5, "value": 20}),
        ("set text", "layer.setText", {"layer": t, "text": "changed"}),
        ("rename", "layer.rename", {"layer": t, "name": "renamed"}),
        ("set transform", "layer.setTransform", {"layers": [t], "prop": "opacity", "value": 5}),
        ("set blend mode", "layer.setBlendMode", {"layers": [t], "mode": "Multiply"}),
        ("set parent", "layer.setParent", {"layers": [t], "parent": s}),
        ("set comment", "layer.setComment", {"layers": [t], "comment": "x"}),
        ("add marker", "layer.addMarker", {"layers": [t], "time": 1, "comment": "m"}),
        ("arrange (to back)", "layer.arrange", {"layers": [t], "to": "back"}),
        ("delete via edit.clear (layers)", "edit.clear", {"layers": [t]}),
        ("switch video off", "layer.setSwitch", {"layers": [t], "switch": "video", "value": False}),
        ("unlock via setSwitch", "layer.setSwitch", {"layers": [t], "switch": "lock", "value": False}),
        ("duplicate", "edit.duplicate", {"layers": [t]}),
        ("add layer style", "layer.style.dropShadow", {"layers": [t]}),
        ("SELECTION: select then edit.clear (no layers param)", "edit.clear", {"__select": t}),
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c8"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    ecproj = out / "c8.ecproj"
    with McpClient(out) as c:
        c.initialize()
        ids = build_c1(c, ecproj, log=lambda *_: None)
    t, s = ids["text"], ids["shape"]
    rows = []
    for name, cmd, params in tests(t, s):
        with McpClient(out) as c:
            c.initialize()
            c.run("file.open", {"path": str(ecproj)})
            c.run("layer.setSwitch", {"layers": [t], "switch": "lock", "value": True})
            h0 = layer_hash(c, t)
            doc0, _ = c.tool("doc_inspect")
            n0 = len(doc0["activeComp"]["layers"])
            e0 = json.dumps(next((l for l in doc0["activeComp"]["layers"] if l["id"] == t), {}), sort_keys=True)
            try:
                if "__select" in params:
                    c.run("layer.select", {"layers": [params["__select"]]})
                    params = {}
                v, err = c.run(cmd, params, raise_on_error=False)
            except Exception as e:  # noqa: BLE001
                v, err = str(e), True
            try:
                h1 = layer_hash(c, t)
            except Exception:  # layer gone
                h1 = "GONE"
            doc1, _ = c.tool("doc_inspect")
            n1 = len(doc1["activeComp"]["layers"])
            e1 = json.dumps(next((l for l in doc1["activeComp"]["layers"] if l["id"] == t), {}), sort_keys=True)
            switches = next((l["switches"] for l in doc1["activeComp"]["layers"] if l["id"] == t), {})
        changed = h0 != h1 or n0 != n1 or (e0 != e1 and cmd != "layer.setSwitch")
        blind = cmd in ("layer.setComment", "layer.addMarker")  # comments and markers are not in the property hash or doc_inspect
        outcome = "APPLIED" if changed else ("blocked" if err else ("unverified" if blind else "skipped"))
        rows.append({"test": name, "command": cmd, "outcome": outcome, "layerCountDelta": n1 - n0,
                     "lockedAfter": switches.get("locked"), "reply": str(v)[:140]})
        print(f"{outcome:8} {cmd:24} {name} | {str(v)[:110]!r}")
    res = {"rows": rows, "applied": [r["command"] for r in rows if r["outcome"] == "APPLIED"]}
    print(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
