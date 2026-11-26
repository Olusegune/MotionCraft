"""Revision snapshots (P4-05): a saved copy of the composition at a moment, so two versions can be compared and an old one restored.

A snapshot is a copy of `comp.ecproj` in `<package>/revisions/<id>.ecproj`. Phase 0 measured `file.saveCopy` at 1 to 5 ms, and a plain
file copy of the saved composition costs the same. Nothing here edits the live composition except `restore`, which saves the current
state first, so a restore can always be undone by restoring that one.

Rules:
  * ids are validated (letters, digits, - and _), so a name can never point outside the revisions folder;
  * an old version is only ever opened on its own, second engine process: previews and diffs never touch the live composition;
  * nothing is deleted. When the folder is full the save is refused with the reason.
"""
from __future__ import annotations

import base64
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, Callable

ECPROJ = "comp.ecproj"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$")
MAX_SNAPSHOTS = 300
MAX_BYTES = 200 * 1024 * 1024


class SnapshotError(Exception):
    pass


class Snapshots:
    def __init__(self, factory: Callable[[Path], Any]):
        self._factory = factory

    # ------------------------------------------------------------------ paths
    @staticmethod
    def folder(pkg: Path) -> Path:
        return pkg / "revisions"

    def path(self, pkg: Path, sid: str) -> Path:
        if not isinstance(sid, str) or not SAFE_ID.match(sid):
            raise SnapshotError("That is not a saved version of this project.")
        p = (self.folder(pkg) / f"{sid}.ecproj").resolve()
        if p.parent != self.folder(pkg).resolve():
            raise SnapshotError("That is not a saved version of this project.")
        if not p.is_file():
            raise SnapshotError("That saved version no longer exists.")
        return p

    # ------------------------------------------------------------------ save
    def save(self, pkg: Path, live: Any, sid: str | None = None) -> dict:
        """Saves the live composition and keeps a copy of it. `live` is the open adapter."""
        src = pkg / ECPROJ
        live.save()
        if not src.is_file():
            raise SnapshotError("There is no composition to save a version of yet.")
        folder = self.folder(pkg)
        folder.mkdir(parents=True, exist_ok=True)
        existing = list(folder.glob("*.ecproj"))
        if len(existing) >= MAX_SNAPSHOTS:
            raise SnapshotError(f"This project already has {MAX_SNAPSHOTS} saved versions. Nothing is deleted automatically: remove old ones from the revisions folder first.")
        if src.stat().st_size > MAX_BYTES:
            raise SnapshotError("The composition is too large to keep a copy of.")
        sid = sid or uuid.uuid4().hex[:12]
        if not SAFE_ID.match(sid) or (folder / f"{sid}.ecproj").exists():
            raise SnapshotError("That version id is not usable.")
        dest = folder / f"{sid}.ecproj"
        tmp = folder / f"{sid}.tmp"
        shutil.copyfile(src, tmp)
        tmp.replace(dest)
        return {"id": sid, "bytes": dest.stat().st_size}

    # ------------------------------------------------------------------ read an old version on its own engine
    def _open(self, pkg: Path, sid: str):
        p = self.path(pkg, sid)
        a = self._factory(pkg)
        try:
            a.open(p)
        except Exception:
            try:
                a.close()
            finally:
                raise
        return a

    def layers_of(self, pkg: Path, sid: str) -> dict:
        a = self._open(pkg, sid)
        try:
            comp = a.inspect().comp(None)
            hashes = a.hash_layers(comp.id)
            return {"comp": {"width": comp.width, "height": comp.height, "duration": comp.duration, "frameRate": comp.frame_rate},
                    "layers": [{"id": l.id, "name": l.name, "kind": l.kind, "hash": hashes.get(l.id)} for l in comp.layers]}
        finally:
            a.close()

    def diff(self, pkg: Path, sid: str, live: Any) -> dict:
        """What differs between a saved version and the live composition, by layer id and content hash."""
        old = self.layers_of(pkg, sid)
        comp = live.inspect().comp(None)
        hashes = live.hash_layers(comp.id)
        now = {l.id: {"id": l.id, "name": l.name, "kind": l.kind, "hash": hashes.get(l.id)} for l in comp.layers}
        was = {l["id"]: l for l in old["layers"]}
        items = []
        for lid, l in now.items():
            if lid not in was:
                items.append({"id": lid, "name": l["name"], "state": "added"})
            elif was[lid]["hash"] != l["hash"]:
                items.append({"id": lid, "name": l["name"], "state": "changed"})
        for lid, l in was.items():
            if lid not in now:
                items.append({"id": lid, "name": l["name"], "state": "removed"})
        same = sum(1 for lid in now if lid in was and was[lid]["hash"] == now[lid]["hash"])
        return {"items": items, "unchanged": same, "then": {"layers": len(was), **old["comp"]},
                "now": {"layers": len(now), "width": comp.width, "height": comp.height, "duration": comp.duration, "frameRate": comp.frame_rate}}

    def preview(self, pkg: Path, sid: str, time: float, max_side: int) -> dict:
        a = self._open(pkg, sid)
        try:
            comp = a.inspect().comp(None)
            t = max(0.0, min(float(time), max(comp.duration - 1.0 / max(comp.frame_rate, 1), 0.0)))
            p = a.preview(comp.id, [t], max_side=max(64, min(int(max_side), 1920)))
            return {"width": p.width, "height": p.height, "time": round(t, 3), "png": base64.b64encode(p.png).decode("ascii")}
        finally:
            a.close()

    # ------------------------------------------------------------------ restore
    def restore_file(self, pkg: Path, sid: str) -> None:
        """Replaces comp.ecproj with a saved version (atomically). The caller has saved the current state and closed the live engine."""
        src = self.path(pkg, sid)
        dest = pkg / ECPROJ
        tmp = pkg / f"{ECPROJ}.restoring"
        shutil.copyfile(src, tmp)
        tmp.replace(dest)
