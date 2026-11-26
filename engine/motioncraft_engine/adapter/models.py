"""Adapter value types. JSON Schemas in ./schemas are generated from these (engine/scripts/gen_schemas.py)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ACTOR_RE = re.compile(r"^(user|agent:(director|builder|qa))$")


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Actor(_M):
    """`user` or `agent:<director|builder|qa>`. Only agents are subject to the lock check."""
    name: str

    @field_validator("name")
    @classmethod
    def _v(cls, v: str) -> str:
        if not ACTOR_RE.match(v):
            raise ValueError("actor must be 'user' or 'agent:director|builder|qa'")
        return v

    @property
    def is_agent(self) -> bool:
        return self.name.startswith("agent:")


USER = Actor(name="user")
BUILDER = Actor(name="agent:builder")
DIRECTOR = Actor(name="agent:director")
QA = Actor(name="agent:qa")


class UserAction(_M):
    """Proof that a person did this (for unlock). `kind` is what they clicked."""
    kind: Literal["unlock_layer", "unlock_all"]
    note: str = ""


class CompSettings(_M):
    name: str = "Main"
    width: int = Field(1920, ge=16, le=16384)
    height: int = Field(1080, ge=16, le=16384)
    frame_rate: float = Field(30.0, gt=0, le=240)
    duration: float = Field(10.0, gt=0, le=36000)


class Command(_M):
    """Exactly an EffectCraft engine command id and its params."""
    id: str
    params: dict[str, Any] = Field(default_factory=dict)


class MarkerInfo(_M):
    time: float
    comment: str = ""
    layer: int | None = None


class LayerInfo(_M):
    id: int
    name: str
    kind: str
    index: int
    parent: int | None = None
    native_locked: bool = False


class CompInfo(_M):
    id: int
    name: str
    width: int
    height: int
    frame_rate: float
    duration: float
    layers: list[LayerInfo] = Field(default_factory=list)
    markers: list[MarkerInfo] = Field(default_factory=list)


class DocSnapshot(_M):
    path: str | None = None
    dirty: bool = False
    active_comp: int | None = None
    comps: list[CompInfo] = Field(default_factory=list)

    def comp(self, key: int | str | None) -> CompInfo:
        if key is None:
            key = self.active_comp
        for c in self.comps:
            if c.id == key or c.name == key:
                return c
        raise KeyError(f"no comp {key!r}")


class ProjectHandle(_M):
    path: Path
    active_comp: int | None = None


class StepResult(_M):
    index: int
    id: str
    ok: bool
    result: Any = None
    error: str | None = None


class BatchResult(_M):
    completed: int
    failed: int
    results: list[StepResult]


class PreviewResult(_M):
    comp: int
    times: list[float]
    width: int
    height: int
    png: bytes = Field(repr=False)
    contact_sheet: bool = False


class FinalRenderJob(_M):
    comp: int | str
    preset: Literal["h264", "prores4444"]
    output: Path
    estimated_cost_usd: float | None = None
    # A part of the timeline, in seconds: [start, end), end exclusive (measured on EffectCraft 0.24.1: 0 to 2 s at 30 fps is 60 frames). None = all of it.
    start: float | None = None
    end: float | None = None


class RenderResult(_M):
    output: Path
    frames: int
    bytes: int


class ExportResult(_M):
    path: Path
    bytes: int
    warnings: list[str] = Field(default_factory=list)


class EngineEvent(_M):
    kind: Literal["command", "saved", "lock", "unlock", "refused", "gui_attached", "gui_detached", "opened"]
    data: dict[str, Any] = Field(default_factory=dict)
