"""T3 spike: what does EffectCraft's layer.timing do? (run with EFFECTCRAFT_CLI set; writes nothing outside a temp folder)

Questions (docs/TIMELINE_PLAN.md section 6): is `out` exclusive, what do `in`/`out` absolute vs `inDelta`/`outDelta`/`delta` do,
and do keyframes move when a layer is moved? Prints one line per probe. Evidence goes to spike/results/t3_layer_timing.txt.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from motioncraft_engine.adapter import Command  # noqa: E402
from motioncraft_engine.adapter.real import EffectCraftAdapter  # noqa: E402
from motioncraft_engine.sidecar import Service  # noqa: E402

cli = Path(os.environ["EFFECTCRAFT_CLI"])
tmp = Path(tempfile.mkdtemp(prefix="mc_t3_"))
s = Service(lambda p: EffectCraftAdapter(cli, read_roots=[p], write_roots=[p]), data_dir=tmp / "d")
pkg = tmp / "P.motioncraft"
(pkg / "fonts").mkdir(parents=True)
(pkg / "fonts" / "manifest.json").write_text("[]")
s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 30, "duration": 20}})
out_lines: list[str] = []


def say(msg: str) -> None:
    print(msg)
    out_lines.append(msg)


def run(cmd: str, **p):
    return s.a._run(Command(id=cmd, params=p))


def state(lid: int) -> dict:
    t = run("layer.tree", layer=lid)
    keys = {}
    for path in ("transform.opacity", "transform.position"):
        try:
            k = run("prop.get", layer=lid, path=path).get("keys")
            if k:
                keys[path] = [(round(x.get("time", x.get("t", -1)), 4)) for x in k]
        except Exception as e:  # noqa: BLE001
            keys[path] = f"err {str(e)[:60]}"
    return {"in": t.get("in"), "out": t.get("out"), "start": t.get("start"), "keys": keys}


def fresh(name: str) -> int:
    lid = s.handle("add_text", {"text": name, "size": 60})["layer"]
    run("prop.addKey", layer=lid, path="transform.opacity", time=2.0, value=0)
    run("prop.addKey", layer=lid, path="transform.opacity", time=4.0, value=100)
    run("layer.timing", layers=[lid], **{"in": 1.0, "out": 8.0})       # known-good baseline: in 1, out 8
    return lid


def probe(label: str, **params) -> None:
    lid = fresh(label)
    before = state(lid)
    try:
        run("layer.timing", layers=[lid], **params)
        after = state(lid)
        say(f"{label:34} {json.dumps(params)}\n   before {before}\n   after  {after}")
    except Exception as e:  # noqa: BLE001
        say(f"{label:34} {json.dumps(params)} -> ERROR {str(e)[:160]}")


probe("absolute in/out", **{"in": 3.0, "out": 10.0})
probe("out only", out=12.0)
probe("in only", **{"in": 5.0})
probe("out beyond comp (25 > 20)", out=25.0)
probe("in > out", **{"in": 9.0, "out": 8.0})
probe("negative in", **{"in": -2.0})
probe("inDelta+outDelta (slide +2)", inDelta=2.0, outDelta=2.0)
probe("delta +2", delta=2.0)
probe("start only", start=3.0)
probe("start + in/out", start=3.0, **{"in": 3.0, "out": 10.0})
probe("op moveInToTime delta=5", op="moveInToTime", delta=5.0)
probe("op trimOutToTime delta=6", op="trimOutToTime", delta=6.0)
probe("op moveInToStart", op="moveInToStart")
probe("op moveOutToEnd", op="moveOutToEnd")
s.handle("close", {})
res = Path(__file__).parent / "results"
res.mkdir(exist_ok=True)
(res / "t3_layer_timing.txt").write_text("\n".join(out_lines), encoding="utf-8")
