"""The authoritative lock check and the canonical layer hash (docs/ENGINE_ADAPTER.md "Lock check", "Hashing and drift").

Why this is strict: P0-10 measured that EffectCraft's native lock switch stops very little (prop.set, layer.setText,
layer.rename, edit.duplicate and others still change a locked layer), and that most layer commands fall back to the
current selection when they are not given a layer. So for agents we use an allow-list: a command is allowed only if we
know how it names its target layers, and it must name them explicitly.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable

from .errors import LockedLayerError, UnsafeCommandError
from .models import Command, DocSnapshot

# --- command classification (names confirmed against the 7e2d025 snapshot; a contract test checks they all exist) -------
# Commands that neither read nor write an existing layer's content, or only create new layers.
NO_LAYER = {
    "file.newProject", "file.open", "file.save", "file.saveCopy", "file.close", "file.checkOutput", "file.exportLottie",
    "comp.new", "comp.open", "comp.info", "comp.addMarker", "comp.deleteAllMarkers",
    "layer.tree", "prop.get", "text.fonts", "text.fontFeatures",
    "renderQueue.add", "renderQueue.render",
    "layer.newText", "layer.newShape", "layer.newSolid", "layer.newNull", "layer.newCamera",
    "file.import", "layer.addItem",          # bring media into the project and put it in the comp as a NEW layer
}
# Commands that take one layer in `layer`.
SINGLE = {"prop.set", "prop.addKey", "layer.setText", "layer.rename", "text.animatorFontAxes", "layer.addTextAnimator",
          "layer.addTextSelector", "layer.addTextAnimatorProperty"}
# Commands that take a list in `layers` and fall back to the selection when it is omitted.
LISTED = {"layer.setTransform", "layer.setBlendMode", "layer.setParent", "layer.setComment", "layer.addMarker",
          "layer.arrange", "layer.setSwitch", "edit.clear", "edit.duplicate", "layer.style.dropShadow",
          "layer.timing"}      # when a layer is on screen (the Builder times the layers it makes; a locked layer is still refused)
# Commands that must also never run for an agent while any layer of the comp is locked (they can reach every layer).
COMP_WIDE_WHEN_ANY_LOCKED: set[str] = set()

ALLOWED_FOR_AGENTS = NO_LAYER | SINGLE | LISTED


def all_known_ids() -> set[str]:
    return set(ALLOWED_FOR_AGENTS)


class LayerResolver:
    """Turns ints, digit strings, '#N' indexes (1-based from the top) and names into layer ids using a fresh snapshot."""

    def __init__(self, snap: DocSnapshot, comp: int | str | None):
        self.c = snap.comp(comp)

    def one(self, ref: Any) -> int:
        if isinstance(ref, bool):
            raise UnsafeCommandError("?", f"bad layer reference {ref!r}")
        if isinstance(ref, int):
            ids = [l.id for l in self.c.layers]
            if ref in ids:
                return ref
            raise UnsafeCommandError("?", f"unknown layer id {ref}")
        if isinstance(ref, str):
            m = re.fullmatch(r"#(\d+)", ref)
            if m:
                i = int(m.group(1))
                for l in self.c.layers:
                    if l.index == i:
                        return l.id
                raise UnsafeCommandError("?", f"no layer at index {ref}")
            if ref.isdigit() and int(ref) in [l.id for l in self.c.layers]:
                return int(ref)
            named = [l.id for l in self.c.layers if l.name == ref]
            if len(named) == 1:
                return named[0]
            raise UnsafeCommandError("?", f"layer name {ref!r} matches {len(named)} layers")
        raise UnsafeCommandError("?", f"bad layer reference {ref!r}")


def targets_of(cmd: Command, snap: DocSnapshot, active_comp: int | str | None = None) -> list[int]:
    """Layer ids the command would touch, or raise UnsafeCommandError if that cannot be known."""
    cid = cmd.id
    if cid not in ALLOWED_FOR_AGENTS:
        raise UnsafeCommandError(cid, "unknown command id (not in the pinned snapshot allow-list)")
    if cid in NO_LAYER:
        return []
    comp = cmd.params.get("comp", active_comp)
    res = LayerResolver(snap, comp)
    if cid in SINGLE:
        ref = cmd.params.get("layer")
        if ref is None:
            raise UnsafeCommandError(cid, "no `layer` given; it would use the selection. Agents must name layers")
        return [res.one(ref)]
    ref = cmd.params.get("layers")
    if not isinstance(ref, list) or not ref:
        raise UnsafeCommandError(cid, "no `layers` list given; it would use the selection. Agents must name layers")
    return sorted({res.one(r) for r in ref})


def check_agent_command(cmd: Command, snap: DocSnapshot, locked: Callable[[int | str, int], bool],
                        active_comp: int | str | None = None) -> None:
    """Raises before anything is sent. `locked(comp, layer_id)` says whether the layer has lock == 'approved'."""
    ids = targets_of(cmd, snap, active_comp)
    comp = snap.comp(cmd.params.get("comp", active_comp)).id
    hit = [i for i in ids if locked(comp, i)]
    if hit:
        raise LockedLayerError(hit, cmd.id)


# --- canonical hashing -----------------------------------------------------------------------------------------------
def canon(v: Any) -> Any:
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, list):
        return [canon(x) for x in v]
    if isinstance(v, dict):
        return {k: canon(x) for k, x in sorted(v.items())}
    return v


# Keys that are UI or identity state and must not change the hash (selection, expansion, the lock switch itself, uids).
EXCLUDED_KEYS = {"uid", "selected", "expanded", "locked", "lock"}


def strip(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: strip(x) for k, x in v.items() if k not in EXCLUDED_KEYS}
    if isinstance(v, list):
        return [strip(x) for x in v]
    return v


def hash_props(props: dict[str, Any]) -> str:
    """SHA-256 over canonical JSON: sorted keys, floats rounded to 6 places, no selection/UI/lock state."""
    body = json.dumps(canon(strip(props)), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()
