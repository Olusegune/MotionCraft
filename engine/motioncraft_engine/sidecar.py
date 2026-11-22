"""Engine sidecar: the only process that talks to EffectCraft for the desktop app (AGENTS.md: every engine call goes through
the adapter). The Rust shell starts it and exchanges one JSON object per line on stdin/stdout.

  request : {"id": 1, "method": "open", "params": {...}}
  reply   : {"id": 1, "ok": true, "result": ...}   or   {"id": 1, "ok": false, "error": {"type": "...", "message": "..."}}

The package folder given to `open` is the only read and write root of the engine (confinement). The user's UI actions
run as actor "user"; no agent runs here yet, so the lock check is exercised by tests and by the Layers panel (approve/unlock).
Run:  python -m motioncraft_engine.sidecar --effectcraft-cli PATH   (or the bundled motioncraft-engine executable)
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any

from .adapter import USER, Command, CompSettings, MockAdapter, UserAction
from .adapter.base import BaseAdapter
from .adapter.errors import AdapterError
from .adapter.real import EffectCraftAdapter

ECPROJ = "comp.ecproj"


class Service:
    def __init__(self, adapter_factory):
        self._factory = adapter_factory
        self.a: BaseAdapter | None = None
        self.pkg: Path | None = None

    # ------------------------------------------------------------ helpers
    def _need(self) -> BaseAdapter:
        if self.a is None:
            raise AdapterError("no project is open in the engine")
        return self.a

    def _snapshot(self) -> dict[str, Any]:
        a = self._need()
        snap = a.inspect()
        comp = snap.comp(None)
        hashes = a.hash_layers(comp.id)
        return {
            "path": snap.path, "dirty": snap.dirty, "activeComp": snap.active_comp,
            "comps": [{"id": c.id, "name": c.name, "width": c.width, "height": c.height, "frameRate": c.frame_rate,
                       "duration": c.duration} for c in snap.comps],
            "layers": [{"id": l.id, "name": l.name, "kind": l.kind, "index": l.index, "parent": l.parent,
                        "nativeLocked": l.native_locked, "approvedHere": l.id in a._locked.get(comp.id, set()),
                        "hash": hashes.get(l.id)} for l in comp.layers],
        }

    # ------------------------------------------------------------ methods
    def open(self, package: str, settings: dict | None = None, locked: list[int] | None = None) -> dict:
        pkg = Path(package).resolve()
        if pkg.suffix != ".motioncraft" or not pkg.is_dir():
            raise AdapterError("not a MotionCraft package folder")
        if self.a is not None:
            self.a.close()
        self.a = self._factory(pkg)
        self.pkg = pkg
        ecproj = pkg / ECPROJ
        if ecproj.is_file():
            self.a.open(ecproj)
        else:
            self.a.create(pkg, CompSettings(**(settings or {})))
        if locked:
            self.a.load_locks(None, [int(i) for i in locked])
        return self._snapshot()

    def inspect(self) -> dict:
        return self._snapshot()

    def add_text(self, text: str, size: int = 120) -> dict:
        a = self._need()
        r = a.execute([Command(id="layer.newText", params={"text": text, "size": int(size)})], actor=USER)
        a.save()
        return {"layer": r.results[0].result["layer"], **self._snapshot()}

    def set_text(self, layer: int, text: str) -> dict:
        a = self._need()
        a.execute([Command(id="layer.setText", params={"layer": int(layer), "text": text})], actor=USER)
        a.save()
        return self._snapshot()

    def add_camera(self) -> dict:
        a = self._need()
        a.execute([Command(id="layer.newCamera", params={"name": "Camera"})], actor=USER)
        a.save()
        return self._snapshot()

    def lock(self, layers: list[int]) -> dict:
        a = self._need()
        a.lock_layers(None, [int(i) for i in layers])
        a.save()
        return self._snapshot()

    def unlock(self, layers: list[int], note: str = "") -> dict:
        a = self._need()
        a.unlock_layers(None, [int(i) for i in layers], by_user=UserAction(kind="unlock_layer", note=note))
        a.save()
        return self._snapshot()

    def preview(self, times: list[float] | None = None, max_side: int = 960) -> dict:
        a = self._need()
        side = max(64, min(int(max_side), 3840))
        p = a.preview(None, [float(t) for t in (times or [0.0])], max_side=side)
        return {"width": p.width, "height": p.height, "png": base64.b64encode(p.png).decode("ascii")}

    def close(self) -> dict:
        if self.a is not None:
            self.a.close()
        self.a = None
        return {}

    def handle(self, method: str, params: dict) -> Any:
        if method.startswith("_") or not hasattr(self, method) or method in ("handle",):
            raise AdapterError(f"unknown method {method!r}")
        return getattr(self, method)(**params)


def serve(service: Service, rin=sys.stdin, rout=sys.stdout) -> None:
    for line in rin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            result = service.handle(str(req["method"]), req.get("params") or {})
            out = {"id": rid, "ok": True, "result": result}
        except Exception as e:  # noqa: BLE001 - every failure becomes a reply; the process keeps serving
            out = {"id": rid, "ok": False, "error": {"type": type(e).__name__, "message": str(e)}}
        rout.write(json.dumps(out) + "\n")
        rout.flush()
    service.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--effectcraft-cli", help="path to effectcraft-cli (the pinned version)")
    ap.add_argument("--mock", action="store_true", help="in-memory engine for tests; never used by the app")
    a = ap.parse_args(argv)
    if a.mock:
        factory = lambda pkg: MockAdapter()  # noqa: E731
    elif a.effectcraft_cli:
        cli = Path(a.effectcraft_cli)
        factory = lambda pkg: EffectCraftAdapter(cli, read_roots=[pkg], write_roots=[pkg])  # noqa: E731
    else:
        ap.error("--effectcraft-cli is required (or --mock for tests)")
    serve(Service(factory))
    return 0


if __name__ == "__main__":
    sys.exit(main())
