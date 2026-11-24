"""In-memory, deterministic engine for tests and CI (docs/ENGINE_ADAPTER.md "Mock adapter").

Mirrors what P0-02..P0-10 measured on the real engine where it matters to the contract: strict parameter names, comp.new
defaults to 29.97 fps, layer ids are never reused, the native lock only refuses setParent/arrange/edit.clear and makes
layer.setSwitch skip locked layers (everything else still changes a locked layer, which is why the adapter's own check is
the authoritative one). `simulate_user_edit` changes a layer behind the adapter's back to create drift.
"""
from __future__ import annotations

import copy
import json
import struct
import zlib
from pathlib import Path
from typing import Any

from .base import BaseAdapter, SpendVerifier
from .errors import AdapterContractError, EngineUnavailable
from .models import (CompInfo, CompSettings, DocSnapshot, ExportResult, FinalRenderJob, LayerInfo, MarkerInfo, Command,
                     PreviewResult, ProjectHandle, RenderResult)

ACCEPT: dict[str, set[str]] = {
    "file.newProject": set(), "file.open": {"path"}, "file.save": {"path"}, "file.saveCopy": {"path"}, "file.close": set(),
    "file.checkOutput": {"path"}, "file.exportLottie": {"comp", "path", "includeExpressions", "textAsShapes"},
    "comp.new": {"name", "width", "height", "frameRate", "duration"}, "comp.open": {"comp"}, "comp.info": {"comp"},
    "comp.addMarker": {"time", "comment"}, "comp.deleteAllMarkers": {"comp"},
    "layer.newText": {"text", "name", "size", "position", "font", "direction"}, "layer.newShape": {"kind", "name", "size", "fill", "fillType", "fillBlend", "fillOpacity", "stroke", "strokeType", "strokeBlend", "strokeOpacity", "strokeWidth", "position"},
    "layer.newSolid": {"name", "color", "size"}, "layer.newNull": {"name"}, "layer.newCamera": {"name"},
    "layer.tree": {"layer", "comp", "depth", "time"}, "prop.get": {"layer", "path", "comp", "time"},
    "prop.set": {"layer", "path", "value", "time", "timeBase"}, "prop.addKey": {"layer", "path", "time", "value", "timeBase"},
    "layer.setText": {"layer", "text", "font", "size", "fill", "tracking", "variations"}, "layer.rename": {"layer", "name"},
    "layer.setTransform": {"layers", "prop", "value"}, "layer.setBlendMode": {"layers", "mode"},
    "layer.setParent": {"layers", "parent"}, "layer.setComment": {"layers", "comment"}, "layer.addMarker": {"layers", "time", "comment"},
    "layer.arrange": {"layers", "to"}, "layer.setSwitch": {"layers", "switch", "value"}, "edit.clear": {"layers"},
    "edit.duplicate": {"layers"}, "layer.style.dropShadow": {"layers"},
    "renderQueue.add": {"comp", "format", "output", "proresProfile", "channels"}, "renderQueue.render": {"wait"},
    "text.fonts": {"query"}, "text.fontFeatures": {"font"},
    "file.import": {"paths", "sequence", "alphabetical", "frameRate"},
    "layer.timing": {"layers", "in", "out", "delta", "start", "inDelta", "outDelta", "op", "merge"},
    "comp.settings": {"comp", "name", "width", "height", "anchor", "frameRate", "duration", "startTime"},
    "layer.addItem": {"item", "time", "index", "position", "duration", "in", "out", "anchor"},
}


def _png(w: int, h: int, count: int) -> bytes:
    """Solid dark PNG with one small white square per layer along the top (a visible, checkable layer count)."""
    w, h = max(16, w), max(16, h)
    rows = bytearray()
    for y in range(h):
        row = bytearray(b"\x00")
        for x in range(w):
            on = y < 8 and (x // 10) < count and (x % 10) < 8
            row += b"\xff\xff\xff" if on else b"\x28\x2a\x2c"
        rows += row
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(bytes(rows))) + chunk(b"IEND", b""))


class MockAdapter(BaseAdapter):
    def __init__(self, spend_verifier: SpendVerifier | None = None):
        super().__init__(spend_verifier)
        self._doc: dict[str, Any] | None = None
        self._path: Path | None = None
        self._next = 1
        self._dirty = False
        self._queue: list[dict] = []
        self._selection: list[int] = []

    # ------------------------------------------------------------- lifecycle
    def _new_doc(self) -> None:
        self._doc = {"comps": {}, "active": None}
        self._dirty = False

    def create(self, package_dir: Path, settings: CompSettings) -> ProjectHandle:
        self._guard_direct_file_write()
        package_dir.mkdir(parents=True, exist_ok=True)
        self._new_doc()
        self._run(Command(id="comp.new", params={"name": settings.name, "width": settings.width, "height": settings.height,
                                                 "frameRate": settings.frame_rate, "duration": settings.duration}))
        self._path = package_dir / "comp.ecproj"
        self.save()
        return ProjectHandle(path=self._path, active_comp=self._doc["active"])  # type: ignore[index]

    def open(self, ecproj: Path) -> ProjectHandle:
        self._guard_direct_file_write()
        data = json.loads(Path(ecproj).read_text(encoding="utf-8"))
        self._doc, self._next = data["doc"], data["next"]
        self._doc["comps"] = {int(k): v for k, v in self._doc["comps"].items()}
        for c in self._doc["comps"].values():
            c["layers"] = [{**l, "props": {k: v for k, v in l["props"].items()}} for l in c["layers"]]
        self._path, self._dirty = Path(ecproj), False
        self._emit("opened", path=str(ecproj))
        return ProjectHandle(path=self._path, active_comp=self._doc["active"])

    def save(self) -> None:
        self._write(self._need_path())

    def _write(self, path: Path) -> None:
        if self._doc is None:
            raise EngineUnavailable("no project open")
        path.write_text(json.dumps({"doc": self._doc, "next": self._next}, sort_keys=True), encoding="utf-8")
        if path == self._path:
            self._dirty = False
        self._emit("saved", path=str(path))

    def close(self) -> None:
        self._doc, self._path = None, None

    def _need_path(self) -> Path:
        if self._path is None:
            raise EngineUnavailable("project has no path yet")
        return self._path

    # ------------------------------------------------------------- reads
    def _d(self) -> dict[str, Any]:
        if self._doc is None:
            raise EngineUnavailable("no project open")
        return self._doc

    def _comp(self, key: int | str | None = None) -> dict[str, Any]:
        d = self._d()
        key = d["active"] if key is None else key
        for c in d["comps"].values():
            if c["id"] == key or c["name"] == key:
                return c
        raise KeyError(f"no comp {key!r}")

    def inspect(self) -> DocSnapshot:
        d = self._d()
        comps = []
        for c in d["comps"].values():
            layers = [LayerInfo(id=l["id"], name=l["name"], kind=l["kind"], index=i + 1, parent=l.get("parent"),
                                native_locked=bool(l["switches"].get("locked"))) for i, l in enumerate(c["layers"])]
            comps.append(CompInfo(id=c["id"], name=c["name"], width=c["w"], height=c["h"], frame_rate=c["fps"], duration=c["dur"],
                                  layers=layers, markers=[MarkerInfo(**m) for m in c["markers"]]))
        return DocSnapshot(path=str(self._path) if self._path else None, dirty=self._dirty, active_comp=d["active"], comps=comps)

    def _layer(self, comp: dict, lid: int) -> dict:
        for l in comp["layers"]:
            if l["id"] == lid:
                return l
        raise AdapterContractError(f"no layer {lid}")

    def layer_props(self, comp: int | str, layer_id: int) -> dict:
        l = self._layer(self._comp(comp), layer_id)
        return {"name": l["name"], "kind": l["kind"], "parent": l.get("parent"), "comment": l.get("comment", ""),
                "blend": l.get("blend", "Normal"), "switches": {k: v for k, v in l["switches"].items() if k != "locked"},
                "props": copy.deepcopy(l["props"])}

    # ------------------------------------------------------------- the engine
    def _alloc(self) -> int:
        i = self._next
        self._next += 1
        return i

    def _add_layer(self, kind: str, name: str, props: dict) -> int:
        c = self._comp()
        lid = self._alloc()
        base = {"transform/position": {"value": [960.0, 540.0, 0.0], "keys": []},
                "transform/opacity": {"value": 100.0, "keys": []}}
        c["layers"].insert(0, {"id": lid, "name": name, "kind": kind, "parent": None, "props": {**base, **props},
                               "switches": {"video": True, "locked": False}})
        self._dirty = True
        return lid

    def _targets(self, p: dict, comp: dict, single: bool = False) -> list[dict]:
        ids = [p["layer"]] if single else p["layers"]
        return [self._layer(comp, int(i)) for i in ids]

    def _run(self, cmd: Command, *, force_unlock: list[int] | None = None) -> Any:  # noqa: C901
        cid, p = cmd.id, cmd.params
        if cid not in ACCEPT:
            raise AdapterContractError(f"unknown command {cid}")
        extra = set(p) - ACCEPT[cid]
        if extra:
            raise AdapterContractError(f"invalid parameters for `{cid}`: unknown parameter(s) {sorted(extra)}")
        if cid == "file.newProject":
            self._new_doc(); self._path = None; return None
        if cid == "file.open":
            self.open(Path(p["path"])); return {"path": p["path"]}
        if cid == "file.save":
            if "path" in p:
                self._path = Path(p["path"])
            self.save(); return {"path": str(self._path)}
        if cid == "file.saveCopy":
            self._write(Path(p["path"])); return {"path": p["path"]}
        if cid == "file.close":
            self.close(); return None
        if cid == "file.checkOutput":
            return {"path": p["path"], "ok": True}
        if cid == "comp.new":
            d = self._d(); cid_ = self._alloc()
            d["comps"][cid_] = {"id": cid_, "name": p.get("name", "Comp 1"), "w": p.get("width", 1920), "h": p.get("height", 1080),
                                "fps": float(p.get("frameRate", 29.97)), "dur": float(p.get("duration", 10)), "layers": [], "markers": []}
            d["active"] = cid_; self._dirty = True; return {"comp": cid_}
        if cid == "comp.open":
            self._d()["active"] = self._comp(p["comp"])["id"]; return {"comp": self._d()["active"]}
        if cid == "comp.info":
            c = self._comp(p.get("comp")); return {"id": c["id"], "name": c["name"]}
        c = self._comp(p.get("comp") if cid in ("layer.tree", "prop.get", "file.exportLottie", "comp.deleteAllMarkers") else None)
        if cid == "comp.addMarker":
            c["markers"].append({"time": float(p.get("time", 0)), "comment": p.get("comment", ""), "layer": None}); self._dirty = True; return None
        if cid == "comp.deleteAllMarkers":
            c["markers"] = []; self._dirty = True; return None
        if cid in ("layer.newText", "layer.newShape", "layer.newSolid", "layer.newNull", "layer.newCamera"):
            kind = {"layer.newText": "Text", "layer.newShape": "Shape", "layer.newSolid": "Solid", "layer.newNull": "Null", "layer.newCamera": "Camera"}[cid]
            props = {"text/sourceText": {"value": p.get("text", ""), "keys": []}} if kind == "Text" else {}
            return {"layer": self._add_layer(kind, p.get("name") or p.get("text") or f"{kind} Layer", props)}
        if cid == "file.import":
            ids = []
            for src in p["paths"]:
                if not Path(src).is_file():
                    raise AdapterContractError(f"cannot import {src}: file not found")
                self._items = getattr(self, "_items", {})
                i = self._alloc()
                self._items[i] = Path(src).name
                ids.append(i)
            return {"items": ids, "comps": [], "errors": [], "warnings": []}
        if cid == "layer.addItem":
            name = getattr(self, "_items", {}).get(p["item"])
            if name is None:
                raise AdapterContractError(f"no project item {p['item']}")
            return {"layer": self._add_layer("Footage", name, {})}
        if cid == "layer.tree":
            l = self._layer(c, int(p["layer"])); return {"id": l["id"], "name": l["name"], "properties": {"children": [
                {"path": k, "value": v["value"]} for k, v in sorted(l["props"].items())]}}
        if cid == "prop.get":
            return copy.deepcopy(self._layer(c, int(p["layer"]))["props"].get(p["path"], {"value": None, "keys": []}))
        if cid in ("prop.set", "prop.addKey"):
            l = self._layer(c, int(p["layer"])); pr = l["props"].setdefault(p["path"], {"value": None, "keys": []})
            if cid == "prop.addKey" or "time" in p:
                pr["keys"] = sorted([k for k in pr["keys"] if k["time"] != p["time"]] + [{"time": p["time"], "value": p["value"]}], key=lambda k: k["time"])
            else:
                pr["value"] = p["value"]
            self._dirty = True; return len(pr["keys"]) if cid == "prop.addKey" else p["value"]
        if cid == "layer.setText":
            l = self._layer(c, int(p["layer"]))
            if "text" in p:
                l["props"].setdefault("text/sourceText", {"value": None, "keys": []})["value"] = p["text"]
            for k in ("font", "size", "fill", "tracking", "variations"):
                if k in p:
                    l["props"].setdefault(f"text/style/{k}", {"value": None, "keys": []})["value"] = p[k]
            self._dirty = True; return None
        if cid == "comp.settings":
            if "width" in p: c["w"] = int(p["width"])
            if "height" in p: c["h"] = int(p["height"])
            if "frameRate" in p: c["fps"] = float(p["frameRate"])
            if "duration" in p: c["dur"] = float(p["duration"])
            self._dirty = True; return None
        if cid == "layer.rename":
            self._layer(c, int(p["layer"]))["name"] = p["name"]; self._dirty = True; return None
        # commands taking `layers`
        if cid in ACCEPT and "layers" in ACCEPT[cid]:
            if "layers" not in p:
                raise AdapterContractError(f"`{cid}` without layers would use the selection; the mock requires them")
            force = set(force_unlock or [])
            ls = self._targets(p, c)
            locked = [l for l in ls if l["switches"].get("locked") and l["id"] not in force]
            if cid in ("layer.setParent", "layer.arrange", "edit.clear") and locked:
                raise AdapterContractError(f"invalid parameters for `{cid}`: “{locked[0]['name']}” is locked")
            if cid == "layer.setSwitch":
                for l in ls:
                    if l["switches"].get("locked") and l["id"] not in force:
                        continue  # skipped silently, as measured
                    l["switches"]["locked" if p["switch"] == "lock" else p["switch"]] = bool(p["value"])
                self._dirty = True; return bool(p["value"])
            if cid == "layer.setTransform":
                for l in ls:
                    l["props"].setdefault(f"transform/{p['prop']}", {"value": None, "keys": []})["value"] = p["value"]
            elif cid == "layer.setBlendMode":
                for l in ls: l["blend"] = p["mode"]
            elif cid == "layer.setParent":
                for l in ls: l["parent"] = p["parent"]
            elif cid == "layer.setComment":
                for l in ls: l["comment"] = p["comment"]
            elif cid == "layer.addMarker":
                for l in ls: c["markers"].append({"time": float(p.get("time", 0)), "comment": p.get("comment", ""), "layer": l["id"]})
            elif cid == "layer.timing":
                # As measured on EffectCraft 0.24.1 (spike/results/t3_layer_timing.txt): absolute in/out only trim; `delta` slides in, out and
                # start together; keyframes never move; nothing is clamped to the composition; an in point past the out is held one frame short of it.
                frame = 1.0 / c["fps"]
                for l in ls:
                    i0, o0, s0 = float(l.get("in", 0.0)), float(l.get("out", c["dur"])), float(l.get("start", 0.0))
                    if "delta" in p:
                        d = float(p["delta"]); i0, o0, s0 = i0 + d, o0 + d, s0 + d
                    if "in" in p: i0 = float(p["in"])
                    if "out" in p: o0 = float(p["out"])
                    if i0 > o0: i0 = o0 - frame
                    l["in"], l["out"], l["start"] = i0, o0, s0
            elif cid == "layer.arrange":
                for l in ls:
                    c["layers"].remove(l); c["layers"].insert(0 if p["to"] == "front" else len(c["layers"]), l)
            elif cid == "edit.clear":
                c["layers"] = [l for l in c["layers"] if l not in ls]
            elif cid == "edit.duplicate":
                new = []
                for l in ls:
                    n = copy.deepcopy(l); n["id"] = self._alloc(); n["name"] += " 2"; n["switches"]["locked"] = False
                    c["layers"].insert(0, n); new.append(n["id"])
                self._dirty = True; return new
            elif cid == "layer.style.dropShadow":
                for l in ls: l["props"]["style/dropShadow"] = {"value": True, "keys": []}
            self._dirty = True; return None
        if cid == "file.exportLottie":
            Path(p["path"]).write_text(json.dumps({"v": "5.12.0", "layers": len(c["layers"])}), encoding="utf-8")
            warns = ["Camera: cameras and lights are not exported"] if any(l["kind"] == "Camera" for l in c["layers"]) else []
            return {"path": p["path"], "bytes": Path(p["path"]).stat().st_size, "warnings": warns}
        if cid == "renderQueue.add":
            self._queue.append(dict(p)); return {"id": len(self._queue)}
        if cid == "renderQueue.render":
            n = 0
            for q in self._queue:
                Path(q["output"]).write_bytes(b"MOCKRENDER" + str(len(c["layers"])).encode()); n += 1
            self._queue = []; return {"failed": 0, "items": n}
        if cid in ("text.fonts", "text.fontFeatures"):
            return {"families": []}
        raise AdapterContractError(f"mock does not implement {cid}")

    # ------------------------------------------------------------- output
    def preview(self, comp: int | str, times: list[float], max_side: int = 960) -> PreviewResult:
        c = self._comp(comp)
        scale = min(1.0, max_side / max(c["w"], c["h"]))
        w, h = max(16, int(c["w"] * scale) // 8), max(16, int(c["h"] * scale) // 8)  # tiny, it is a stand-in
        return PreviewResult(comp=c["id"], times=list(times), width=w, height=h, png=_png(w, h, len(c["layers"])),
                             contact_sheet=len(times) > 1)

    def preview_movie(self, comp: int | str, output: Path) -> RenderResult:
        c = self._comp(comp)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"MOCKPREVIEW" + str(len(c["layers"])).encode())
        return RenderResult(output=output, frames=int(round(c["dur"] * c["fps"])), bytes=output.stat().st_size)

    def _render(self, job: FinalRenderJob) -> RenderResult:
        c = self._comp(job.comp)
        if self._aborted:
            raise RuntimeError("the engine was stopped")
        if self.render_hook is not None:
            self.render_hook(job)                      # tests: block, fail, or note which part is being rendered
        if self._aborted:
            raise RuntimeError("the engine was stopped")
        span = (job.end - job.start) if job.start is not None and job.end is not None else c["dur"]
        job.output.parent.mkdir(parents=True, exist_ok=True)
        job.output.write_bytes(f"MOCKRENDER|{job.preset}|{job.start}|{job.end}|{len(c['layers'])}".encode() + bytes([10]))
        return RenderResult(output=job.output, frames=int(round(span * c["fps"])), bytes=job.output.stat().st_size)

    def layer_spans(self, comp: int | str) -> dict[int, dict]:
        c = self._comp(comp)
        return {l["id"]: {"in": float(l.get("in", 0.0)), "out": float(l.get("out", c["dur"])), "start": float(l.get("start", 0.0))} for l in c["layers"]}

    def abort(self) -> None:
        self._aborted = True

    def export(self, kind: str, comp: int | str, path: Path) -> ExportResult:
        if kind == "ecproj_copy":
            self._run(Command(id="file.saveCopy", params={"path": str(path)}))
            return ExportResult(path=path, bytes=path.stat().st_size)
        out = self._run(Command(id="file.exportLottie", params={"comp": comp, "path": str(path)}))
        return ExportResult(path=path, bytes=out["bytes"], warnings=out["warnings"])

    def _attach(self, port: int) -> None: pass
    def _detach(self) -> None: pass
    def _gui_has_unsaved(self) -> bool: return False

    # ------------------------------------------------------------- test hooks
    render_hook = None      # called with the FinalRenderJob before each final render or part
    _aborted = False

    def simulate_user_edit(self, comp: int | str, layer_id: int, path: str, value: Any) -> None:
        """A hand edit in the EffectCraft GUI: changes the layer without going through execute() or the lock check."""
        l = self._layer(self._comp(comp), layer_id)
        l["props"].setdefault(path, {"value": None, "keys": []})["value"] = value
        self._dirty = True
