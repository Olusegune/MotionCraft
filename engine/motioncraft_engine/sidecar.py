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
from .adapter.errors import AdapterError, CommandFailed, LockedLayerError
from .adapter.real import EffectCraftAdapter
from . import audio as audio_mod
from .primitives import library as prim
from .renderjobs import RenderJobs
from .providers.jobs import JobRefused, Jobs
from .providers.net import Net
from .providers.registry import Registry

ECPROJ = "comp.ecproj"


class Service:
    def __init__(self, adapter_factory, data_dir: Path | None = None, jobs: Jobs | None = None):
        self._factory = adapter_factory
        self.reg = Registry((data_dir or Path.home() / ".motioncraft") / "registry.json")
        self.jobs = jobs or Jobs(self.reg, Net())
        self.renders = RenderJobs(adapter_factory)
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

    # ------------------------------------------------------------ models and generation (ADR-0005)
    def models(self) -> dict:
        return {"models": self.reg.all(), "status": self.reg.status()}

    def models_refresh(self, keys: dict | None = None, offline: bool = False) -> dict:
        if offline:
            raise JobRefused("Offline mode is on, so cloud providers are disabled.")
        res = self.reg.refresh(self.jobs.net, {k: str(v) for k, v in (keys or {}).items()})
        return {"results": res, **self.models()}

    def generate_start(self, package: str, provider: str, model: str, prompt: str, api_key: str = "", params: dict | None = None,
                       spend_token: str = "", generative_enabled: bool = False, offline: bool = False) -> dict:
        return self.jobs.start(provider=provider, model=model, prompt=prompt, params=params, api_key=api_key, package=Path(package),
                               spend_token=spend_token, generative_enabled=generative_enabled, offline=offline)

    def generate_poll(self, job: str) -> dict:
        return self.jobs.poll(job)

    def generate_cancel(self, job: str) -> dict:
        return self.jobs.cancel(job)

    # ------------------------------------------------------------ more layers, primitives, audio, renders (Phase 2 to 5 slice)
    def _asset(self, rel: str, kinds: tuple[str, ...]) -> Path:
        """A file under this package's assets folder, by relative path. No `..`, no absolute paths, no links."""
        if self.pkg is None:
            raise AdapterError("no project is open in the engine")
        r = Path(rel)
        parts = r.parts
        if r.is_absolute() or len(parts) != 3 or parts[0] != "assets" or parts[1] not in kinds or any(x in ("..", ".") for x in parts):
            raise AdapterError("That is not a media file of this project.")
        f = (self.pkg / r).resolve()
        if self.pkg not in f.parents or not f.is_file():
            raise AdapterError("That media file no longer exists.")
        return f

    def add_shape(self, kind: str = "rect", name: str = "") -> dict:
        if kind not in ("rect", "rounded", "ellipse", "star", "polygon"):
            raise AdapterError("Unknown shape.")
        a = self._need()
        params = {"kind": kind, "size": [320, 320] if kind != "rect" else [480, 270]}
        if name.strip():
            params["name"] = name.strip()[:80]
        r = a.execute([Command(id="layer.newShape", params=params)], actor=USER)
        a.save()
        return {"layer": r.results[0].result["layer"], **self._snapshot()}

    def add_solid(self, name: str = "Background", color: list[float] | None = None) -> dict:
        a = self._need()
        col = [min(1.0, max(0.0, float(x))) for x in (color or [0.12, 0.12, 0.14])][:3]
        r = a.execute([Command(id="layer.newSolid", params={"name": name.strip()[:80] or "Background", "color": col})], actor=USER)
        a.save()
        return {"layer": r.results[0].result["layer"], **self._snapshot()}

    def add_media(self, rel: str) -> dict:
        """Puts an imported picture, video or audio file into the composition as a new layer."""
        f = self._asset(rel, ("images", "video", "audio"))
        a = self._need()
        imp = a.execute([Command(id="file.import", params={"paths": [str(f)]})], actor=USER).results[0].result or {}
        if imp.get("errors") or not imp.get("items"):
            raise AdapterError(f"EffectCraft could not import that file: {imp.get('errors') or 'no item'}")
        r = a.execute([Command(id="layer.addItem", params={"item": imp["items"][0]})], actor=USER)
        a.save()
        return {"layer": r.results[0].result["layer"], **self._snapshot()}

    def primitives(self) -> dict:
        return {"primitives": prim.describe()}

    def apply_primitive(self, layer: int, primitive: str, params: dict | None = None) -> dict:
        a = self._need()
        snap = a.inspect()
        comp = snap.comp(None)
        info = next((l for l in comp.layers if l.id == int(layer)), None)
        if info is None:
            raise AdapterError("That layer does not exist.")
        if int(layer) in a._locked.get(comp.id, set()):
            raise LockedLayerError([int(layer)], "primitive")          # approved layers are unlocked by a person first
        props = a.layer_props(comp.id, int(layer))["props"]

        def val(path: str, default):
            v = (props.get(path) or {}).get("value")
            return list(v) if isinstance(v, list) else (v if v is not None else default)
        ctx = prim.Ctx(layer=int(layer), layer_kind=info.kind, fps=comp.frame_rate, comp_duration=comp.duration,
                       rest_position=[float(x) for x in val("transform/position", [0, 0, 0])],
                       rest_scale=[float(x) for x in val("transform/scale", [100, 100, 100])],
                       rest_opacity=float(val("transform/opacity", 100.0)),
                       has_animators=any(k.startswith("text/animators/") for k in props))
        cmds = prim.build(primitive, ctx, params)
        # Keyframe recipes replace nothing: an existing key at the same time is overwritten by the engine. Stop at the first error.
        a.execute(cmds, actor=USER)
        a.save()
        return {"applied": primitive, "commands": len(cmds), **self._snapshot()}

    def audio_analyze(self, rel: str) -> dict:
        f = self._asset(rel, ("audio",))
        try:
            return audio_mod.analyze(f)
        except audio_mod.AudioError as e:
            raise AdapterError(str(e)) from None

    def sync_markers(self, times: list[float], comment: str = "motioncraft:beat", replace: bool = False) -> dict:
        a = self._need()
        ts = sorted({round(float(t), 3) for t in times if 0 <= float(t) < 36000})[:2000]
        if not ts:
            raise AdapterError("There are no marker times to write.")
        if replace:
            try:
                a.execute([Command(id="comp.deleteAllMarkers", params={})], actor=USER)
            except CommandFailed as e:
                if "no markers" not in str(e):          # nothing to delete is fine
                    raise
        a.execute([Command(id="comp.addMarker", params={"time": t, "comment": comment[:80]}) for t in ts], actor=USER)
        a.save()
        return {"markers": len(ts), "replaced": replace}

    def preview_movie_start(self) -> dict:
        if self.a is not None:
            self.a.save()                                  # the render reads the file on disk
        return self.renders.start_movie(self._pkg())

    def render_start(self, preset: str, name: str = "render", spend_token: str = "") -> dict:
        if self.a is not None:
            self.a.save()
        return self.renders.start_final(self._pkg(), preset, name, spend_token)

    def render_poll(self, job: str) -> dict:
        return self.renders.poll(job, self._pkg())

    def _pkg(self) -> Path:
        if self.pkg is None:
            raise AdapterError("no project is open in the engine")
        return self.pkg

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
    ap.add_argument("--data-dir", help="where the model registry cache lives (the app data folder)")
    ap.add_argument("--mock", action="store_true", help="in-memory engine for tests; never used by the app")
    a = ap.parse_args(argv)
    if a.mock:
        factory = lambda pkg: MockAdapter()  # noqa: E731
    elif a.effectcraft_cli:
        cli = Path(a.effectcraft_cli)
        factory = lambda pkg: EffectCraftAdapter(cli, read_roots=[pkg], write_roots=[pkg])  # noqa: E731
    else:
        def factory(pkg):  # model listing and generation work without EffectCraft; engine methods say why they cannot
            raise AdapterError("EffectCraft was not found. Set its path in Settings.")
    serve(Service(factory, Path(a.data_dir) if a.data_dir else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
