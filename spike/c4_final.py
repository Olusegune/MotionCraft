"""P0-06 / criterion 4: final renders (ProRes 4444 RGBA and H.264) verified with an independent decoder (ffprobe/ffmpeg).

Checks, on the c1 comp (10 s, 30 fps):
  * frame count == duration x fps exactly (300), counted by decoding (ffprobe -count_frames), not by container metadata
  * ProRes 4444 reports an alpha pix_fmt (yuva444p10le) AND the decoded corner pixel of a frame has alpha 0 where no layer
    covers it, and alpha 255 inside the opaque shape
  * H.264 renders and has 300 frames
Needs ffmpeg and ffprobe on PATH and Pillow. Usage: python -I spike/c4_final.py [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from mcp_client import McpClient  # noqa: E402


def probe(path: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                        "stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,duration",
                        "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)["streams"][0]


def pixel(path: Path, t: float, xy: tuple[int, int], tmp: Path) -> tuple[int, int, int, int]:
    from PIL import Image
    png = tmp / f"px_{path.stem}_{t}.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", str(path), "-frames:v", "1", "-pix_fmt", "rgba", str(png)],
                   check=True)
    return Image.open(png).convert("RGBA").getpixel(xy)


def main() -> int:
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        print("ffmpeg/ffprobe not found: NOT CHECKED")
        return 2
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c4"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    ecproj = out / "c4.ecproj"
    mov, mp4 = out / "alpha.mov", out / "final.mp4"
    res: dict = {}
    with McpClient(out) as c:
        c.initialize()
        ids = build_c1(c, ecproj, log=lambda *_: None)
        c.run("file.checkOutput", {"path": str(mov)}, raise_on_error=False)
        add1, e1 = c.run("renderQueue.add", {"comp": ids["comp"], "format": "prores", "proresProfile": "4444", "channels": "rgba",
                                             "output": str(mov)}, raise_on_error=False)
        add2, e2 = c.run("renderQueue.add", {"comp": ids["comp"], "format": "h264", "output": str(mp4)}, raise_on_error=False)
        r, e3 = c.run("renderQueue.render", {"wait": True}, raise_on_error=False)
        res["queue"] = {"addProres": add1 if e1 else "ok", "addH264": add2 if e2 else "ok", "renderError": bool(e3),
                        "failed": (r or {}).get("failed") if isinstance(r, dict) else None}
    expected = 300
    for name, p in (("prores4444", mov), ("h264", mp4)):
        if not p.is_file():
            res[name] = {"exists": False}
            continue
        s = probe(p)
        res[name] = {"exists": True, "bytes": p.stat().st_size, **s, "frameCountExact": int(s.get("nb_read_frames", -1)) == expected}
    if mov.is_file():
        # frame at 5 s: title centred at (960,~600); bar around x=200..1700 y~900 at 2s-4s. Corner (5,5) should be empty.
        res["alpha"] = {"corner_t5": pixel(mov, 5.0, (5, 5), out), "title_t5_center": pixel(mov, 5.0, (960, 600), out),
                        "bar_t2": pixel(mov, 2.0, (960, 900), out)}
        al = res["alpha"]
        res["alpha"]["emptyCornerTransparent"] = al["corner_t5"][3] == 0
        res["alpha"]["shapeOpaque"] = al["bar_t2"][3] == 255
    ok = (res.get("prores4444", {}).get("frameCountExact") and res.get("h264", {}).get("frameCountExact")
          and "a" in res.get("prores4444", {}).get("pix_fmt", "")[3:5] + res.get("prores4444", {}).get("pix_fmt", "")
          and res.get("alpha", {}).get("emptyCornerTransparent") and res.get("alpha", {}).get("shapeOpaque"))
    res["pass"] = bool(ok)
    print(json.dumps(res, indent=1))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
