"""P0-04 / criterion 2: save/reopen round trips must not change layer ids or canonical property hashes.

Builds the c1 comp, then runs N cycles of open -> layer.tree -> save -> close. Two modes:
  fresh   a new `effectcraft-cli mcp` process per cycle (the strict case: nothing survives in memory)
  inproc  one process, file.open repeated
Per cycle it records layer ids and a canonical SHA-256 per layer (sorted keys, floats rounded to 6 places, values and
keyframes of every leaf property; no selection or UI state), plus the file's own SHA-256.

Usage: python -I spike/c2_roundtrip.py [--cycles 20] [--out DIR]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from c1_headless import build_c1  # noqa: E402
from mcp_client import McpClient  # noqa: E402


def canon(v):
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, list):
        return [canon(x) for x in v]
    if isinstance(v, dict):
        return {k: canon(x) for k, x in sorted(v.items())}
    return v


def leaves(node, out):
    if "children" in node:
        for ch in node["children"]:
            leaves(ch, out)
    elif "path" in node:
        out[node["path"]] = {"type": node.get("type"), "value": node.get("value")}


def layer_hash(c: McpClient, layer_id: int) -> str:
    tree, _ = c.run("layer.tree", {"layer": layer_id})
    props: dict = {}
    leaves(tree["properties"], props)
    for path in list(props):
        p, err = c.tool("get_property", {"layer": layer_id, "path": path}, raise_on_error=False)
        if not err and isinstance(p, dict) and p.get("keys"):
            props[path]["keys"] = [{k: v for k, v in key.items()} for key in p["keys"]]
    body = {"name": tree.get("name"), "blend": tree.get("blendMode"), "in": tree.get("in"), "out": tree.get("out"),
            "parent": tree.get("parent"), "props": props}
    return hashlib.sha256(json.dumps(canon(body), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def snapshot(c: McpClient) -> dict:
    doc, _ = c.tool("doc_inspect")
    ids = [l["id"] for l in doc["activeComp"]["layers"]]
    return {"ids": ids, "hashes": {str(i): layer_hash(c, i) for i in ids}}


def cycle_fresh(ecproj: Path, workdir: Path) -> dict:
    with McpClient(workdir) as c:
        c.initialize()
        c.run("file.open", {"path": str(ecproj)})
        snap = snapshot(c)
        c.run("file.save", {"path": str(ecproj)})
        c.run("file.close", raise_on_error=False)
    return snap


def cycle_inproc(c: McpClient, ecproj: Path) -> dict:
    c.run("file.open", {"path": str(ecproj)})
    snap = snapshot(c)
    c.run("file.save", {"path": str(ecproj)})
    return snap


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cycles", type=int, default=20)
    ap.add_argument("--out", default=str(Path(__file__).parent / "out" / "c2"))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    result = {"cycles": a.cycles, "modes": {}}
    ok = True
    for mode in ("fresh", "inproc"):
        ecproj = out / f"c2_{mode}.ecproj"
        with McpClient(out) as c:
            c.initialize()
            build_c1(c, ecproj, log=lambda *_: None)
        snaps, filehashes = [], []
        if mode == "fresh":
            for _ in range(a.cycles):
                snaps.append(cycle_fresh(ecproj, out))
                filehashes.append(hashlib.sha256(ecproj.read_bytes()).hexdigest())
        else:
            with McpClient(out) as c:
                c.initialize()
                for _ in range(a.cycles):
                    snaps.append(cycle_inproc(c, ecproj))
                    filehashes.append(hashlib.sha256(ecproj.read_bytes()).hexdigest())
        ids_stable = all(s["ids"] == snaps[0]["ids"] for s in snaps)
        hashes_stable = all(s["hashes"] == snaps[0]["hashes"] for s in snaps)
        file_stable = len(set(filehashes[1:])) <= 1  # first save may normalise; later saves should not change bytes
        result["modes"][mode] = {"ids": snaps[0]["ids"], "idsStable": ids_stable, "layerHashesStable": hashes_stable,
                                 "fileBytesStableAfterFirstSave": file_stable, "distinctFileHashes": len(set(filehashes))}
        ok &= ids_stable and hashes_stable
    result["pass"] = ok
    print(json.dumps(result, indent=1))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
