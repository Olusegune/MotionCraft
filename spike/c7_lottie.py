"""P0-09 / criterion 8: file.exportLottie on the c1 comp (and with text as shapes). Lists every warning.

Usage: python -I -X utf8 spike/c7_lottie.py [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from mcp_client import McpClient  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c7"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    res: dict = {}
    with McpClient(out) as c:
        c.initialize()
        ids = build_c1(c, out / "c7.ecproj", log=lambda *_: None)
        for label, extra in (("live text", {}), ("text as shapes", {"textAsShapes": True})):
            p = out / f"c1_{label.replace(' ', '_')}.json"
            v, e = c.run("file.exportLottie", {"comp": ids["comp"], "path": str(p), **extra}, raise_on_error=False)
            info: dict = {"error": bool(e), "reply": v}
            if p.is_file():
                doc = json.loads(p.read_text(encoding="utf-8"))
                info["file"] = {"bytes": p.stat().st_size, "version": doc.get("v"), "fps": doc.get("fr"), "w": doc.get("w"),
                                "h": doc.get("h"), "layers": len(doc.get("layers", [])),
                                "layerTypes": sorted({l.get("ty") for l in doc.get("layers", [])}), "hasTextDocs": "chars" in doc or any(
                                    l.get("ty") == 5 for l in doc.get("layers", []))}
            res[label] = info
    res["pass"] = all(not r["error"] and r.get("file") for r in res.values())
    print(json.dumps(res, indent=1, ensure_ascii=False))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
