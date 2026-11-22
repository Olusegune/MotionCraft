"""Adapter errors (docs/ENGINE_ADAPTER.md "Errors")."""
from __future__ import annotations


class AdapterError(Exception):
    """Base class."""


class LockedLayerError(AdapterError):
    def __init__(self, layer_ids: list[int], command_id: str):
        self.layer_ids, self.command_id = layer_ids, command_id
        super().__init__(f"{command_id} refused: layer(s) {layer_ids} are approved and locked")


class UnsafeCommandError(AdapterError):
    """An agent command the lock check cannot reason about (unknown id, or it names no layer and would use the selection)."""

    def __init__(self, command_id: str, why: str):
        self.command_id, self.why = command_id, why
        super().__init__(f"{command_id} refused for agents: {why}")


class AdapterContractError(AdapterError):
    """The engine rejected our arguments (JSON-RPC -32602): a bug in our code, not the user's."""


class CommandFailed(AdapterError):
    def __init__(self, results: list[dict]):
        self.results = results
        failed = [r for r in results if not r.get("ok")]
        super().__init__(f"{len(failed)} of {len(results)} steps failed: {failed[:1]}")


class EngineUnavailable(AdapterError):
    pass


class EnginePinMismatch(AdapterError):
    def __init__(self, found: str, expected: str):
        super().__init__(f"EffectCraft {found} found, MotionCraft is pinned to {expected}")


class SpendTokenRequired(AdapterError):
    """A final render was requested without a valid confirmation token from a user click (AGENTS.md money rule)."""


class GuiWriteConflict(AdapterError):
    """A direct file write was attempted while a GUI session has the project open (P0-07: such writes are silently lost)."""
