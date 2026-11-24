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

from .adapter import BUILDER, QA, USER, Command, CompSettings, MockAdapter, UserAction
from .adapter.base import BaseAdapter
from .adapter.errors import AdapterContractError, AdapterError, CommandFailed, LockedLayerError
from .adapter.real import EffectCraftAdapter
from . import audio as audio_mod
from .primitives import library as prim
from .renderjobs import RenderJobs
from .providers.jobs import JobRefused, Jobs
from .providers.net import Net
from .providers.registry import Registry
from .llm import Llm
from .agents import builder, director
from .qa import checks as qa_checks
from .snapshots import Snapshots
from . import songmap

ECPROJ = "comp.ecproj"


class Service:
    def __init__(self, adapter_factory, data_dir: Path | None = None, jobs: Jobs | None = None, renders: RenderJobs | None = None):
        self._factory = adapter_factory
        base_dir = data_dir or Path.home() / ".motioncraft"
        self.reg = Registry(base_dir / "registry.json")
        self.llm = Llm(base_dir / "llm.json")
        self.jobs = jobs or Jobs(self.reg, Net())
        self.renders = renders or RenderJobs(adapter_factory)
        self.snaps = Snapshots(adapter_factory)
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
        self._record_text(r.results[0].result["layer"], int(size))
        return {"layer": r.results[0].result["layer"], **self._snapshot()}

    # EffectCraft does not report a text layer's font or size, so MotionCraft writes the size down when it makes the layer. QA uses it
    # (and says so). Edits made in EffectCraft are not seen, which is why QA findings that rest on it are marked as estimates.
    def _text_meta_file(self) -> Path | None:
        return None if self.pkg is None else self.pkg / "logs" / "text-layers.json"

    def _text_meta(self) -> dict:
        f = self._text_meta_file()
        try:
            d = json.loads(f.read_text(encoding="utf-8")) if f else {}
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _record_text(self, layer: int, size: int) -> None:
        f = self._text_meta_file()
        if f is None:
            return
        d = self._text_meta()
        d[str(int(layer))] = {"size": int(size)}
        try:
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix(".tmp")
            tmp.write_text(json.dumps(d), encoding="utf-8")
            tmp.replace(f)
        except OSError:
            pass                                   # QA then says the size is not known; nothing else depends on this file

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

    # ------------------------------------------------------------ language model (P1-05)
    def llm_status(self, offline: bool = False) -> dict:
        return self.llm.status(offline)

    def llm_set(self, provider: str | None = None, model: str = "", base_url: str = "") -> dict:
        return self.llm.save(provider, model, base_url)

    def llm_models(self, provider: str, base_url: str = "") -> dict:
        return self.llm.models(provider, base_url)

    def llm_complete(self, provider: str, model: str, messages: list, schema: dict | None = None, api_key: str = "",
                     spend_token: str = "", offline: bool = False) -> dict:
        return self.llm.complete(provider=provider, model=model, messages=messages, schema=schema, api_key=api_key,
                                 spend_token=spend_token, offline=offline)

    def director_intent(self, provider: str, model: str, brief: str, script: str = "", duration_sec: float = 15, api_key: str = "",
                        spend_token: str = "", offline: bool = False) -> dict:
        """The Director drafts the intent. A proposal only: the page applies it when the user clicks, and Gate A stays theirs."""
        return director.draft_intent(self.llm, provider=provider, model=model, brief=brief, script=script, duration_sec=duration_sec,
                                     api_key=api_key, spend_token=spend_token, offline=offline)

    def builder_plan(self, provider: str, model: str, context: dict, api_key: str = "", spend_token: str = "", offline: bool = False) -> dict:
        """The Builder proposes layers and motion. Nothing is created: the page shows the plan and the user confirms builder_execute."""
        return builder.draft_plan(self.llm, provider=provider, model=model, context=context, api_key=api_key, spend_token=spend_token, offline=offline)

    def builder_execute(self, plan: dict) -> dict:
        """Builds a plan as the Builder actor. The plan is validated again here: the page is never trusted. Only layers created by this
        call are touched, and the adapter's lock policy applies to every command. Cost is a known $0 (no generation)."""
        a = self._need()
        comp = a.inspect().comp(None)
        checked = builder.validate(plan if isinstance(plan, dict) else {}, duration_sec=comp.duration, fps=comp.frame_rate)
        if checked["cost"]["usd"] > 0:      # cannot happen today; a paid plan would need a spend token from a click
            raise AdapterError("This plan costs money and needs a spend confirmation.")
        created: list[dict] = []
        warnings = list(checked["warnings"])
        before = self._try_snapshot(warnings)         # so the build can be undone: restoring this version is the undo
        try:
            for L in checked["plan"]["layers"]:
                if L["kind"] == "text":
                    cmd = Command(id="layer.newText", params={"text": L["text"], "size": L["size"], "name": L["name"]})
                elif L["kind"] == "shape":
                    cmd = Command(id="layer.newShape", params={"kind": L["shape"], "name": L["name"], "size": [320, 320] if L["shape"] != "rect" else [480, 270]})
                else:
                    cmd = Command(id="layer.newSolid", params={"name": L["name"], "color": L["color"]})
                lid = int(a.execute([cmd], actor=BUILDER).results[0].result["layer"])
                if "in" in L:       # when the layer is on screen, from the plan (absolute in and out points; keyframes stay where they are)
                    try:
                        a.execute([Command(id="layer.timing", params={"layers": [lid], "in": float(L["in"]), "out": float(L["out"])})], actor=BUILDER)
                    except (CommandFailed, AdapterContractError) as e:
                        warnings.append(f"{L['name']}: its timing was not applied. {e}")
                applied: list[str] = []
                for an in L["animations"]:
                    try:
                        self._apply(lid, an["primitive"], an["params"], BUILDER)
                        applied.append(an["primitive"])
                    except (prim.PrimitiveError, CommandFailed, AdapterContractError) as e:   # one motion failing does not stop the build
                        warnings.append(f"{L['name']}: {an['primitive']} was not applied. {e}")
                if L["kind"] == "text":
                    self._record_text(lid, int(L["size"]))
                created.append({"key": L["key"], "layer": lid, "kind": L["kind"], "role": L["role"], "name": L["name"], "primitives": applied,
                                **({"in": L["in"], "out": L["out"]} if "in" in L else {})})
        except Exception as e:
            a.save()
            raise AdapterError(f"The build stopped after {len(created)} of {len(checked['plan']['layers'])} layers: {e}") from None
        a.save()
        after = self._try_snapshot(warnings)
        return {"created": created, "warnings": warnings, "cost": checked["cost"], "versions": {"before": before, "after": after}, **self._snapshot()}

    # ------------------------------------------------------------ saved versions: compare and restore (P4-05)
    def _try_snapshot(self, notes: list[str]) -> str | None:
        """A version kept around an automatic change. If it cannot be saved the change still goes ahead, and the notes say there is no undo."""
        try:
            return self.snaps.save(self._pkg(), self._need())["id"]
        except Exception as e:  # noqa: BLE001
            notes.append(f"A version to undo this could not be saved: {e}")
            return None

    def snapshot_save(self) -> dict:
        """Keeps a copy of the composition as it is now. The page records it as a revision."""
        return self.snaps.save(self._pkg(), self._need())

    def snapshot_diff(self, id: str) -> dict:
        return self.snaps.diff(self._pkg(), id, self._need())

    def snapshot_preview(self, id: str, time: float = 1.0, max_side: int = 640) -> dict:
        """A picture of a saved version (or of the live composition when id is "current"), at one time."""
        if id == "current":
            a = self._need()
            comp = a.inspect().comp(None)
            t = max(0.0, min(float(time), max(comp.duration - 1.0 / max(comp.frame_rate, 1), 0.0)))
            p = a.preview(comp.id, [t], max_side=max(64, min(int(max_side), 1920)))
            return {"width": p.width, "height": p.height, "time": round(t, 3), "png": base64.b64encode(p.png).decode("ascii")}
        return self.snaps.preview(self._pkg(), id, time, max_side)

    def snapshot_restore(self, id: str) -> dict:
        """Puts a saved version back as the live composition. The current state is saved first (the returned `before`), so this can be undone.
        Engine-side approvals are cleared: the page re-applies the ones whose layer still matches what was approved."""
        pkg = self._pkg()
        a = self._need()
        self.snaps.path(pkg, id)                       # refuse a bad id before anything is touched
        before = self.snaps.save(pkg, a)["id"]
        a.close()
        self.a = None
        self.snaps.restore_file(pkg, id)
        self.a = self._factory(pkg)
        self.a.open(pkg / ECPROJ)
        return {"before": before, "restored": id, **self._snapshot()}

    # ------------------------------------------------------------ timeline (T1): read-only
    def timeline_read(self) -> dict:
        """What the director's timeline draws: the composition's length and every layer's in and out, in one engine call. Read-only."""
        a = self._need()
        snap = a.inspect()
        comp = snap.comp(None)
        spans = a.layer_spans(comp.id) if hasattr(a, "layer_spans") else {}
        locked = a._locked.get(comp.id, set())
        layers = []
        for l in comp.layers:
            sp = spans.get(l.id) or {"in": 0.0, "out": comp.duration, "start": 0.0}
            a_in, a_out = max(0.0, min(sp["in"], comp.duration)), max(0.0, min(sp["out"], comp.duration))
            layers.append({"id": l.id, "name": l.name, "kind": l.kind, "index": l.index, "parent": l.parent, "in": round(a_in, 3),
                           "out": round(max(a_in, a_out), 3), "start": round(sp["start"], 3), "nativeLocked": l.native_locked, "approvedHere": l.id in locked})
        return {"duration": comp.duration, "frameRate": comp.frame_rate, "layers": layers}

    # ------------------------------------------------------------ timeline (T3): move and trim an unlocked layer
    def layer_timing(self, layer: int, t_in: float | None = None, t_out: float | None = None, delta: float | None = None) -> dict:
        """Trims (`t_in`, `t_out`: seconds, absolute) or slides (`delta`: seconds) one layer, as the person. Measured on EffectCraft 0.24.1
        (spike/results/t3_layer_timing.txt): trimming leaves the layer's source start alone, sliding moves in, out and source start together,
        and keyframes never move on either (they stay at their time in the composition). EffectCraft does not clamp, so this does: the layer stays
        inside 0..duration and keeps at least one frame. Refused on an approved or locked layer. One saved version before and one after, so it can be undone."""
        a = self._need()
        lid = int(layer)
        comp = a.inspect().comp(None)
        target = next((l for l in comp.layers if l.id == lid), None)
        if target is None:
            raise AdapterError("That layer is not in the composition any more.")
        if lid in a._locked.get(comp.id, set()) or target.native_locked:
            raise AdapterError("Unlock this layer first: it is approved or locked.")
        vals = {"t_in": t_in, "t_out": t_out, "delta": delta}
        for k, v in vals.items():
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e6):
                raise AdapterError(f"{k} must be a number of seconds.")
        if delta is not None and (t_in is not None or t_out is not None):
            raise AdapterError("Move or trim, not both at once.")
        if delta is None and t_in is None and t_out is None:
            raise AdapterError("Nothing to change.")
        sp = a.layer_spans(comp.id).get(lid) or {"in": 0.0, "out": comp.duration}
        dur, frame = float(comp.duration), 1.0 / float(comp.frame_rate)
        if delta is not None:
            length = sp["out"] - sp["in"]
            d = max(-sp["in"], min(float(delta), dur - sp["out"] if sp["out"] <= dur else 0.0))
            if length > dur: d = 0.0
            params = {"layers": [lid], "delta": round(d, 4)}
            if abs(d) < 1e-9:
                raise AdapterError("The layer is already at that edge.")
        else:
            new_in = sp["in"] if t_in is None else max(0.0, min(float(t_in), dur))
            new_out = sp["out"] if t_out is None else max(0.0, min(float(t_out), dur))
            if t_in is not None and t_out is None: new_in = min(new_in, new_out - frame)
            if t_out is not None and t_in is None: new_out = max(new_out, new_in + frame)
            if new_out - new_in < frame - 1e-9: raise AdapterError("A layer must last at least one frame.")
            params = {"layers": [lid]}
            if t_in is not None: params["in"] = round(new_in, 4)
            if t_out is not None: params["out"] = round(new_out, 4)
        notes: list[str] = []
        before = self._try_snapshot(notes)
        a.execute([Command(id="layer.timing", params=params)], actor=USER)
        a.save()
        after = self._try_snapshot(notes)
        span = a.layer_spans(comp.id).get(lid) or {}
        return {"layer": lid, "in": round(span.get("in", 0.0), 3), "out": round(span.get("out", 0.0), 3), "applied": params, "warnings": notes,
                "versions": {"before": before, "after": after}, **self._snapshot()}

    # ------------------------------------------------------------ QA (P4-01, P4-02)
    def qa_run(self, facts: dict | None = None, contrast: bool = True) -> dict:
        """Runs the tier-1 checks on the open composition. Read-only: nothing in the project or the composition is changed.
        `facts` is what only the page knows: the deliverable, the imported assets, and the renders made so far."""
        scene = self._qa_scene(facts, contrast)
        results = [qa_checks.to_dict(r) for r in qa_checks.run_all(scene)]
        count = {"error": 0, "warn": 0, "info": 0}
        for r in results:
            for f in r["findings"]:
                count[f["severity"]] += 1
        return {"results": results, "counts": count, "checked": sum(1 for r in results if r["state"] != "not-checked"), "total": len(results)}

    FIXABLE = {"safe-title": qa_checks.safe_title}

    def qa_fix(self, check: str, layer: int | None = None, facts: dict | None = None) -> dict:
        """Applies the safe fix of a QA finding (P4-04). The page names the check and the layer; the commands are worked out here from the
        composition as it is now, never taken from the page. They run as the QA actor, so the adapter refuses them on an approved layer."""
        fn = self.FIXABLE.get(check)
        if fn is None:
            raise AdapterError("This check has no automatic fix.")
        res = fn(self._qa_scene(facts, contrast=False))
        cmds = [c for f in res.findings if (layer is None or f.get("at", {}).get("layerId") == layer) and (f.get("fix") or {}).get("safe")
                for c in f["fix"]["commands"]]
        if not cmds:
            raise AdapterError("There is nothing to fix here any more.")
        a = self._need()
        notes: list[str] = []
        before = self._try_snapshot(notes)
        a.execute([Command(id=c["id"], params=c["params"]) for c in cmds], actor=QA)
        a.save()
        after = self._try_snapshot(notes)
        return {"applied": len(cmds), "fixed": sorted({int(c["params"]["layer"]) for c in cmds}), "versions": {"before": before, "after": after}, **self._snapshot()}

    def _qa_scene(self, facts: dict | None, contrast: bool) -> "qa_checks.Scene":
        a = self._need()
        facts = facts if isinstance(facts, dict) else {}
        snap = a.inspect()
        comp = snap.comp(None)
        qa_checks_layers: list[qa_checks.Layer] = []
        font_keys = ("text/font", "text/fontFamily", "text/fontName", "text/sourceText/font")
        size_keys = ("text/fontSize", "text/size", "text/sourceText/size")

        def val(props: dict, keys: tuple[str, ...]):
            for k in keys:
                v = (props.get(k) or {}).get("value")
                if v is not None:
                    return v
            return None

        def pair(v, default):
            return (float(v[0]), float(v[1])) if isinstance(v, (list, tuple)) and len(v) >= 2 else default

        recorded = self._text_meta()
        for l in comp.layers:
            lp = a.layer_props(comp.id, l.id)
            props = lp.get("props") or {}
            txt = val(props, ("text/sourceText",))
            font, size = val(props, font_keys), val(props, size_keys)
            pos = val(props, ("transform/position",))
            op = val(props, ("transform/opacity",))
            qa_checks_layers.append(qa_checks.Layer(
                id=l.id, name=l.name, kind=l.kind, parent=l.parent, text=txt if isinstance(txt, str) else None,
                font=font if isinstance(font, str) else None,
                size=float(size) if isinstance(size, (int, float)) else (float(recorded[str(l.id)]["size"]) if isinstance((recorded.get(str(l.id)) or {}).get("size"), (int, float)) else None),
                position=pair(pos, None) if isinstance(pos, (list, tuple)) else None,
                position_z=float(pos[2]) if isinstance(pos, (list, tuple)) and len(pos) > 2 and isinstance(pos[2], (int, float)) else 0.0,
                position_keyed=bool((props.get("transform/position") or {}).get("keys")), scale=pair(val(props, ("transform/scale",)), (100.0, 100.0)),
                opacity=float(op) if isinstance(op, (int, float)) else 100.0,
                t_in=float(lp["in"]) if isinstance(lp.get("in"), (int, float)) else None, t_out=float(lp["out"]) if isinstance(lp.get("out"), (int, float)) else None))
        fonts = None
        try:
            res = a.execute([Command(id="text.fonts", params={})], actor=QA).results[0].result or {}
            fams = res.get("families") if isinstance(res, dict) else None
            if isinstance(fams, list):
                fonts = {str(f.get("family") or f.get("name")) if isinstance(f, dict) else str(f) for f in fams}
        except Exception:  # noqa: BLE001 - not available: the font checks say so
            fonts = None
        manifest = None
        if self.pkg is not None:
            try:
                m = json.loads((self.pkg / "fonts" / "manifest.json").read_text(encoding="utf-8"))
                manifest = m if isinstance(m, list) else None
            except (OSError, ValueError):
                manifest = None
        assets = [{"id": x.get("id"), "kind": x.get("kind"), "path": str(x.get("path", ""))} for x in (facts.get("assets") or []) if isinstance(x, dict)][:500]
        audio, skipped = [], []
        for x in assets:
            if x["kind"] != "audio":
                continue
            try:
                info = audio_mod.analyze(self._asset(x["path"], ("audio",)))
                audio.append({"path": x["path"], "duration": info.get("duration"), "beats": info.get("beats") or []})
            except (audio_mod.AudioError, AdapterError) as e:
                skipped.append(f"{x['path']}: {e}")
        frames: dict[int, tuple[float, bytes]] = {}
        if contrast:
            for L in [l for l in qa_checks_layers if l.kind == "Text" and (l.text or "").strip()][:6]:
                t0, t1 = qa_checks.visible_window(L, qa_checks.Scene(comp.width, comp.height, comp.frame_rate, comp.duration, [], {}))
                t = round(max(0.0, min(comp.duration - 1 / max(comp.frame_rate, 1), (t0 + t1) / 2)), 3)
                try:
                    frames[L.id] = (t, a.preview(comp.id, [t], max_side=640).png)
                except Exception:  # noqa: BLE001
                    continue
        real = isinstance(a, EffectCraftAdapter)
        markers = None if real else [{"time": m.time, "comment": m.comment} for m in comp.markers]   # the real engine does not report markers in get_comp
        scene = qa_checks.Scene(width=comp.width, height=comp.height, fps=comp.frame_rate, duration=comp.duration, layers=qa_checks_layers,
                                deliverable=facts.get("deliverable") or {}, assets=assets, package=self.pkg, renders=[x for x in (facts.get("renders") or []) if isinstance(x, dict)],
                                installed_fonts=fonts, font_manifest=manifest, markers=markers, audio=audio, audio_skipped=skipped, frames=frames)
        return scene

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
        n = self._apply(layer, primitive, params, USER)
        self._need().save()
        return {"applied": primitive, "commands": n, **self._snapshot()}

    def _apply(self, layer: int, primitive: str, params: dict | None, actor) -> int:
        """Builds a primitive's commands for one layer and runs them as `actor`. Returns the command count. Does not save."""
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
        a.execute(cmds, actor=actor)
        return len(cmds)

    def _analysis_file(self, f: Path) -> Path:
        """Where the analysis of one audio file is kept: inside the project, named by the file and its size and time, so a changed file never reuses it."""
        st = f.stat()
        return self._pkg() / "analysis" / f"{f.name}.{st.st_size}-{int(st.st_mtime)}.json"

    def audio_cached(self, rel: str) -> dict | None:
        """The analysis made earlier for this audio file, or None. Reads only; never analyses."""
        f = self._asset(rel, ("audio",))
        try:
            data = json.loads(self._analysis_file(f).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) and isinstance(data.get("beats"), list) and isinstance(data.get("peaks"), list) else None

    def audio_analyze(self, rel: str) -> dict:
        f = self._asset(rel, ("audio",))
        try:
            result = audio_mod.analyze(f)
        except audio_mod.AudioError as e:
            raise AdapterError(str(e)) from None
        try:        # keeping it is a convenience: if the folder cannot be written the analysis is still returned
            dest = self._analysis_file(f)
            dest.parent.mkdir(parents=True, exist_ok=True)
            for old in dest.parent.glob(f"{f.name}.*.json"):
                old.unlink(missing_ok=True)
            dest.write_text(json.dumps(result), encoding="utf-8")
        except OSError:
            pass
        return result

    def sync_markers(self, times: list[float], comment: str = "motioncraft:beat", replace: bool = False) -> dict:
        a = self._need()
        ts = sorted({round(float(t), 3) for t in times if 0 <= float(t) < 36000})[:2000]
        if not ts:
            raise AdapterError("There are no marker times to write.")
        self._write_markers([{"time": t, "comment": comment[:80]} for t in ts], replace)
        return {"markers": len(ts), "replaced": replace}

    def sync_labelled_markers(self, items: list, replace: bool = False) -> dict:
        """Beat, section and lyric markers in one write (P3-01). Only MotionCraft's own kinds are accepted. `replace` clears the composition's
        other markers first: EffectCraft can only delete them all, and the real engine cannot report which are ours."""
        try:
            checked = songmap.check_marker_items(items)
        except songmap.SongMapError as e:
            raise AdapterError(str(e)) from None
        self._write_markers(checked, replace)
        kinds = {"beat": 0, "section": 0, "lyric": 0}
        for m in checked:
            kinds[m["comment"].split(":")[1].split(" ")[0]] += 1
        return {"markers": len(checked), "replaced": replace, "kinds": kinds}

    def _write_markers(self, items: list[dict], replace: bool) -> None:
        a = self._need()
        if replace:
            try:
                a.execute([Command(id="comp.deleteAllMarkers", params={})], actor=USER)
            except CommandFailed as e:
                if "no markers" not in str(e):          # nothing to delete is fine
                    raise
        a.execute([Command(id="comp.addMarker", params={"time": m["time"], "comment": m["comment"]}) for m in items], actor=USER)
        a.save()

    def songmap_import(self, rel: str) -> dict:
        """Reads a Pulseframe SongMap kept in the project (assets/audio/<name>.songmap.json): sections, beats and timed lyric lines, checked and clamped."""
        if not str(rel).endswith(".songmap.json"):
            raise AdapterError("That is not a SongMap file.")
        f = self._asset(rel, ("audio",))
        if f.stat().st_size > 5 * 1024 * 1024:
            raise AdapterError("That SongMap is larger than 5 MB.")
        try:
            return songmap.from_pulseframe(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, ValueError, songmap.SongMapError) as e:
            raise AdapterError(f"That SongMap could not be read: {e}") from None

    def preview_movie_start(self) -> dict:
        if self.a is not None:
            self.a.save()                                  # the render reads the file on disk
        return self.renders.start_movie(self._pkg())

    def render_start(self, preset: str, name: str = "render", spend_token: str = "", has_audio: bool = False) -> dict:
        if self.a is not None:
            self.a.save()
        return self.renders.start_final(self._pkg(), preset, name, spend_token, bool(has_audio))

    def render_resume(self, job: str, spend_token: str = "") -> dict:
        """Continues an interrupted render from its last finished part. Needs a fresh spend token, like any final render."""
        if self.a is not None:
            self.a.save()
        return self.renders.resume_final(self._pkg(), job, spend_token)

    def render_cancel(self, job: str) -> dict:
        return self.renders.cancel(job, self._pkg())

    def render_discard(self, job: str) -> dict:
        return self.renders.discard(self._pkg(), job)

    def render_jobs(self) -> dict:
        return self.renders.list_jobs(self._pkg())

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
