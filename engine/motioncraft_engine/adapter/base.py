"""EngineAdapter interface and the shared behaviour both implementations must have.

`EngineAdapter` is the Protocol from docs/ENGINE_ADAPTER.md. `BaseAdapter` implements everything that must NOT differ
between the real engine and the mock (lock check, drift hashing, spend-token rule, events, GUI-write rule), so the contract
tests exercise one policy. Subclasses supply the small set of primitives at the bottom.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable, Literal, Protocol

from .errors import (AdapterContractError, CommandFailed, GuiWriteConflict, LockedLayerError, SpendTokenRequired)
from .models import (Actor, BatchResult, Command, CompSettings, DocSnapshot, EngineEvent, ExportResult, FinalRenderJob,
                     PreviewResult, ProjectHandle, RenderResult, StepResult, UserAction, USER)
from .policy import check_agent_command, hash_props, targets_of

Unsubscribe = Callable[[], None]
SpendVerifier = Callable[[str], bool]


class EngineAdapter(Protocol):
    # lifecycle
    def create(self, package_dir: Path, settings: CompSettings) -> ProjectHandle: ...
    def open(self, ecproj: Path) -> ProjectHandle: ...
    def save(self) -> None: ...
    def close(self) -> None: ...
    def attach_gui(self, control_port: int) -> None: ...
    def detach_gui(self) -> None: ...
    # read
    def inspect(self) -> DocSnapshot: ...
    def layer_props(self, comp: int | str, layer_id: int) -> dict: ...
    # write
    def execute(self, steps: list[Command], *, actor: Actor | str, stop_on_error: bool = True) -> BatchResult: ...
    # approval and drift
    def lock_layers(self, comp: int | str, layer_ids: list[int], *, native: bool = True) -> None: ...
    def unlock_layers(self, comp: int | str, layer_ids: list[int], *, by_user: UserAction) -> None: ...
    def hash_layers(self, comp: int | str, layer_ids: list[int] | None = None) -> dict[int, str]: ...
    # output
    def preview(self, comp: int | str, times: list[float], max_side: int = 960) -> PreviewResult: ...
    def preview_movie(self, comp: int | str, output: Path) -> RenderResult: ...
    def render_final(self, job: FinalRenderJob, spend_token: str) -> RenderResult: ...
    def export(self, kind: Literal["lottie", "ecproj_copy"], comp: int | str, path: Path) -> ExportResult: ...
    # events
    def subscribe(self, on_event: Callable[[EngineEvent], None]) -> Unsubscribe: ...


def as_actor(a: Actor | str) -> Actor:
    return a if isinstance(a, Actor) else Actor(name=a)


class BaseAdapter:
    def __init__(self, spend_verifier: SpendVerifier | None = None):
        self._locked: dict[int, set[int]] = {}
        self._subs: list[Callable[[EngineEvent], None]] = []
        self._gui_port: int | None = None
        self._spend_ok: SpendVerifier = spend_verifier or (lambda token: False)
        self._write_lock = threading.RLock()  # one writer at a time per project (docs: Concurrency rules)

    # ------------------------------------------------------------------ events
    def subscribe(self, on_event: Callable[[EngineEvent], None]) -> Unsubscribe:
        self._subs.append(on_event)
        return lambda: self._subs.remove(on_event) if on_event in self._subs else None

    def _emit(self, kind: str, **data: Any) -> None:
        ev = EngineEvent(kind=kind, data=data)  # type: ignore[arg-type]
        for s in list(self._subs):
            s(ev)

    # ------------------------------------------------------------------ locks
    def is_locked(self, comp: int | str, layer_id: int) -> bool:
        cid = self.inspect().comp(comp).id
        return layer_id in self._locked.get(cid, set())

    def load_locks(self, comp: int | str, layer_ids: list[int]) -> None:
        """Restore approved locks from the project's layerMap after open (the registry is in-memory)."""
        cid = self.inspect().comp(comp).id
        self._locked.setdefault(cid, set()).update(layer_ids)

    def lock_layers(self, comp: int | str, layer_ids: list[int], *, native: bool = True) -> None:
        snap = self.inspect()
        c = snap.comp(comp)
        known = {l.id for l in c.layers}
        bad = [i for i in layer_ids if i not in known]
        if bad:
            raise KeyError(f"unknown layer ids {bad}")
        with self._write_lock:
            self._locked.setdefault(c.id, set()).update(layer_ids)
            if native:
                self._run(Command(id="layer.setSwitch", params={"layers": list(layer_ids), "switch": "lock", "value": True}))
        self._emit("lock", comp=c.id, layers=list(layer_ids))

    def unlock_layers(self, comp: int | str, layer_ids: list[int], *, by_user: UserAction) -> None:
        if not isinstance(by_user, UserAction):
            raise PermissionError("unlock needs a UserAction: only a person can unlock approved layers")
        c = self.inspect().comp(comp)
        with self._write_lock:
            self._locked.setdefault(c.id, set()).difference_update(layer_ids)
            self._native_unlock(c.id, list(layer_ids))
        self._emit("unlock", comp=c.id, layers=list(layer_ids), note=by_user.note)

    # ------------------------------------------------------------------ hashing and drift
    def hash_layers(self, comp: int | str, layer_ids: list[int] | None = None) -> dict[int, str]:
        c = self.inspect().comp(comp)
        ids = layer_ids if layer_ids is not None else [l.id for l in c.layers]
        return {i: hash_props(self.layer_props(c.id, i)) for i in ids}

    def detect_drift(self, comp: int | str, stored: dict[int, str]) -> list[int]:
        """Layer ids whose current hash differs from `stored`. Caller records a user revision; nothing is reverted."""
        now = self.hash_layers(comp, list(stored))
        return sorted(i for i, h in stored.items() if now.get(i) != h)

    # ------------------------------------------------------------------ execute (the only write path)
    def execute(self, steps: list[Command], *, actor: Actor | str, stop_on_error: bool = True) -> BatchResult:
        act = as_actor(actor)
        steps = [s if isinstance(s, Command) else Command(**s) for s in steps]
        with self._write_lock:
            if act.is_agent:
                self._precheck(steps)
            results: list[StepResult] = []
            failed = 0
            for i, step in enumerate(steps):
                if act.is_agent:
                    self._check_one(step)  # re-check at send time: earlier steps may have created layers
                if self._gui_port is None and step.id in ("file.save", "file.saveCopy") and self._gui_has_unsaved():
                    raise GuiWriteConflict("the GUI has unsaved changes; ask the user before saving")
                try:
                    out = self._run(step)
                    results.append(StepResult(index=i, id=step.id, ok=True, result=out))
                    self._emit("command", id=step.id, actor=act.name)
                except (LockedLayerError, AdapterContractError):
                    raise  # a refusal, or a bug in our own arguments: never swallow into a batch result
                except Exception as e:  # noqa: BLE001
                    failed += 1
                    results.append(StepResult(index=i, id=step.id, ok=False, error=str(e)))
                    if stop_on_error:
                        break
            res = BatchResult(completed=len([r for r in results if r.ok]), failed=failed, results=results)
        if failed:
            raise CommandFailed([r.model_dump() for r in results])
        return res

    def _precheck(self, steps: list[Command]) -> None:
        snap = self.inspect()
        for s in steps:
            try:
                check_agent_command(s, snap, self._is_locked_id, snap.active_comp)
            except Exception as e:  # noqa: BLE001
                if _is_forward_reference(e):
                    continue  # references a layer that does not exist yet; re-checked when sent
                self._emit("refused", id=s.id, why=str(e))
                raise

    def _check_one(self, step: Command) -> None:
        snap = self.inspect()
        try:
            check_agent_command(step, snap, self._is_locked_id, snap.active_comp)
        except Exception as e:
            self._emit("refused", id=step.id, why=str(e))
            raise

    def _is_locked_id(self, comp: int | str, layer_id: int) -> bool:
        return layer_id in self._locked.get(comp, set())  # type: ignore[arg-type]

    # ------------------------------------------------------------------ output
    def render_final(self, job: FinalRenderJob, spend_token: str) -> RenderResult:
        if not spend_token or not self._spend_ok(spend_token):
            raise SpendTokenRequired("final renders need a confirmation token obtained from a user click")
        return self._render(job)

    # ------------------------------------------------------------------ GUI mode
    def attach_gui(self, control_port: int) -> None:
        if not (1 <= control_port <= 65535):
            raise ValueError("bad control port")
        self._attach(control_port)
        self._gui_port = control_port
        self._emit("gui_attached", port=control_port)

    def detach_gui(self) -> None:
        self._detach()
        self._gui_port = None
        self._emit("gui_detached")

    def _guard_direct_file_write(self) -> None:
        """While a GUI is attached the adapter writes only through the bridge, never to the file (P0-07)."""
        if self._gui_port is not None:
            raise GuiWriteConflict("a GUI session has this project open; direct file writes are lost. Use the bridge")

    # ------------------------------------------------------------------ primitives for subclasses
    def inspect(self) -> DocSnapshot: raise NotImplementedError
    def layer_props(self, comp: int | str, layer_id: int) -> dict: raise NotImplementedError
    def _native_unlock(self, comp_id: int, layer_ids: list[int]) -> None:
        """The native switch skips locked layers in layer.setSwitch (P0-10); subclasses decide how to really clear it."""
        self._run(Command(id="layer.setSwitch", params={"layers": layer_ids, "switch": "lock", "value": False}), force_unlock=layer_ids)

    def _run(self, cmd: Command, *, force_unlock: list[int] | None = None) -> Any: raise NotImplementedError
    def _render(self, job: FinalRenderJob) -> RenderResult: raise NotImplementedError
    def preview_movie(self, comp: int | str, output: Path) -> RenderResult: raise NotImplementedError
    def _attach(self, port: int) -> None: raise NotImplementedError
    def _detach(self) -> None: raise NotImplementedError
    def _gui_has_unsaved(self) -> bool: return False


def _is_forward_reference(e: Exception) -> bool:
    return "unknown layer id" in str(e) or "no layer at index" in str(e) or "matches 0 layers" in str(e)


__all__ = ["EngineAdapter", "BaseAdapter", "as_actor", "USER", "targets_of"]
