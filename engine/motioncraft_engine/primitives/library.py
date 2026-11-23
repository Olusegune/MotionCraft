"""Motion primitives: tested building blocks that turn into EffectCraft commands (docs/PROJECT_SCHEMA.md "Motion primitive").

Each primitive has an id, a version, typed parameters with ranges, and a recipe. Recipes only use commands the adapter allows
agents to run (`prop.addKey`, `prop.set`, `layer.addTextAnimator`, `text.animatorFontAxes`) and always name their layer, so the
adapter's lock check covers them. Values are verified against the real engine in tests/test_primitives.py (frames rendered at
different times must differ).

Deviation from PROJECT_SCHEMA.md: primitives are Python data here, not YAML files; the YAML loader is a later ticket.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ..adapter.models import Command


class PrimitiveError(ValueError):
    """The request cannot be turned into commands: says why, nothing was sent."""


@dataclass(frozen=True)
class Param:
    label: str
    kind: str                       # "float" | "int" | "choice"
    default: Any
    min: float | None = None
    max: float | None = None
    choices: tuple[str, ...] = ()
    unit: str = ""


@dataclass(frozen=True)
class Ctx:
    layer: int
    layer_kind: str
    fps: float
    comp_duration: float
    rest_position: list[float]
    rest_scale: list[float]
    rest_opacity: float
    has_animators: bool = False


@dataclass(frozen=True)
class Primitive:
    id: str
    name: str
    version: str
    category: str                   # "entrance" | "exit" | "emphasis" | "motion" | "text"
    applies_to: tuple[str, ...]     # layer kinds; ("*",) means any layer with a transform
    description: str
    tags: tuple[str, ...]
    params: dict[str, Param]
    build: Callable[[Ctx, dict[str, Any]], list[Command]] = field(repr=False, compare=False)


def _key(layer: int, path: str, t: float, value: Any) -> Command:
    return Command(id="prop.addKey", params={"layer": layer, "path": path, "time": round(float(t), 4), "value": value})


def _eased(layer: int, path: str, t0: float, dur: float, a: list[float] | float, b: list[float] | float, ease: str) -> list[Command]:
    """Keys from a to b. `out` adds a middle key that is already 85% of the way (an approximation of ease-out)."""
    def mix(k: float):
        if isinstance(a, list):
            return [round(x + (y - x) * k, 4) for x, y in zip(a, b)]  # type: ignore[arg-type]
        return round(a + (b - a) * k, 4)  # type: ignore[operator]
    keys = [_key(layer, path, t0, mix(0))]
    if ease == "out":
        keys.append(_key(layer, path, t0 + dur * 0.5, mix(0.85)))
    keys.append(_key(layer, path, t0 + dur, mix(1)))
    return keys


def _timing(p: dict[str, Any]) -> tuple[float, float]:
    return float(p["start"]), float(p["duration"])


START = Param("Start (s)", "float", 0.0, 0.0, 600.0, unit="s")
DUR = lambda d=0.8: Param("Duration (s)", "float", d, 0.1, 30.0, unit="s")  # noqa: E731
EASE = Param("Easing", "choice", "out", choices=("linear", "out"))


def _fade_in(c: Ctx, p):
    t0, d = _timing(p)
    return _eased(c.layer, "transform/opacity", t0, d, 0.0, c.rest_opacity, p["ease"])


def _fade_out(c: Ctx, p):
    t0, d = _timing(p)
    return _eased(c.layer, "transform/opacity", t0, d, c.rest_opacity, 0.0, p["ease"])


_DIRS = {"left": (-1, 0), "right": (1, 0), "up": (0, -1), "down": (0, 1)}


def _slide_in(c: Ctx, p):
    t0, d = _timing(p)
    dx, dy = _DIRS[p["from"]]
    dist = float(p["distance"])
    start = [c.rest_position[0] + dx * dist, c.rest_position[1] + dy * dist, c.rest_position[2]]
    return _eased(c.layer, "transform/position", t0, d, start, list(c.rest_position), p["ease"])


def _rise(c: Ctx, p):
    t0, d = _timing(p)
    start = [c.rest_position[0], c.rest_position[1] + float(p["distance"]), c.rest_position[2]]
    return (_eased(c.layer, "transform/position", t0, d, start, list(c.rest_position), p["ease"])
            + _eased(c.layer, "transform/opacity", t0, d, 0.0, c.rest_opacity, p["ease"]))


def _scale_pop(c: Ctx, p):
    t0, d = _timing(p)
    k = float(p["overshoot"]) / 100.0
    s = c.rest_scale
    return [_key(c.layer, "transform/scale", t0, [0.0, 0.0, s[2]]),
            _key(c.layer, "transform/scale", t0 + d * 0.65, [round(s[0] * k, 4), round(s[1] * k, 4), s[2]]),
            _key(c.layer, "transform/scale", t0 + d, list(s))]


def _pulse(c: Ctx, p):
    t0, d = _timing(p)
    k = 1.0 + float(p["amount"]) / 100.0
    s = c.rest_scale
    return [_key(c.layer, "transform/scale", t0, list(s)),
            _key(c.layer, "transform/scale", t0 + d * 0.3, [round(s[0] * k, 4), round(s[1] * k, 4), s[2]]),
            _key(c.layer, "transform/scale", t0 + d, list(s))]


def _drift(c: Ctx, p):
    t0, d = _timing(p)
    end = [c.rest_position[0] + float(p["dx"]), c.rest_position[1] + float(p["dy"]), c.rest_position[2]]
    return _eased(c.layer, "transform/position", t0, d, list(c.rest_position), end, "linear")


def _spin_in(c: Ctx, p):
    t0, d = _timing(p)
    return (_eased(c.layer, "transform/rotation", t0, d, -float(p["degrees"]), 0.0, p["ease"])
            + _eased(c.layer, "transform/opacity", t0, d, 0.0, c.rest_opacity, "linear"))


SEL = "text/animators/animator/selectors/rangeSelector/"
PROP = "text/animators/animator/properties/"


def _text_check(c: Ctx) -> None:
    if c.has_animators:
        raise PrimitiveError("This text layer already has a text animator; remove it in EffectCraft before applying another.")


def _reveal_per_char(c: Ctx, p):
    """Every letter starts hidden (the animator sets opacity 0 for the selected range) and the range's start moves from 0 to 100%,
    so letters leave the selection, and appear, from left to right."""
    _text_check(c)
    t0, d = _timing(p)
    L = c.layer
    return [Command(id="layer.addTextAnimator", params={"layer": L, "properties": ["opacity"]}),
            Command(id="prop.set", params={"layer": L, "path": PROP + "opacity", "value": 0}),
            Command(id="prop.set", params={"layer": L, "path": SEL + "end", "value": 100}),
            Command(id="prop.set", params={"layer": L, "path": SEL + "advanced/smoothness", "value": float(p["softness"])}),
            _key(L, SEL + "start", t0, 0.0),
            _key(L, SEL + "start", t0 + d, 100.0)]


def _rise_per_char(c: Ctx, p):
    _text_check(c)
    t0, d = _timing(p)
    L = c.layer
    return [Command(id="layer.addTextAnimator", params={"layer": L, "properties": ["opacity", "position"]}),
            Command(id="prop.set", params={"layer": L, "path": PROP + "opacity", "value": 0}),
            Command(id="prop.set", params={"layer": L, "path": PROP + "position", "value": [0, float(p["distance"]), 0]}),
            Command(id="prop.set", params={"layer": L, "path": SEL + "end", "value": 100}),
            Command(id="prop.set", params={"layer": L, "path": SEL + "advanced/smoothness", "value": float(p["softness"])}),
            _key(L, SEL + "start", t0, 0.0),
            _key(L, SEL + "start", t0 + d, 100.0)]


_REVEAL_PARAMS = {"start": START, "duration": DUR(1.6), "softness": Param("Softness (%)", "float", 100.0, 0.0, 100.0, unit="%")}

LIBRARY: dict[str, Primitive] = {pr.id: pr for pr in [
    Primitive("entrance.fade-in", "Fade in", "1.0.0", "entrance", ("*",), "Opacity from 0 to the layer's own value.",
              ("calm", "elegant", "restrained"), {"start": START, "duration": DUR(0.8), "ease": EASE}, _fade_in),
    Primitive("exit.fade-out", "Fade out", "1.0.0", "exit", ("*",), "Opacity from the layer's value to 0.",
              ("calm", "elegant", "restrained"), {"start": START, "duration": DUR(0.8), "ease": EASE}, _fade_out),
    Primitive("entrance.slide-in", "Slide in", "1.0.0", "entrance", ("*",), "Moves in from a side to the layer's position.",
              ("clean", "broadcast"), {"start": START, "duration": DUR(0.7), "from": Param("From", "choice", "left", choices=tuple(_DIRS)),
                                       "distance": Param("Distance (px)", "float", 300.0, 20.0, 2000.0, unit="px"), "ease": EASE}, _slide_in),
    Primitive("entrance.rise", "Rise and fade", "1.0.0", "entrance", ("*",), "Floats up into place while fading in.",
              ("elegant", "editorial"), {"start": START, "duration": DUR(0.9), "distance": Param("Distance (px)", "float", 60.0, 5.0, 600.0, unit="px"), "ease": EASE}, _rise),
    Primitive("entrance.scale-pop", "Pop in", "1.0.0", "entrance", ("*",), "Scales up from nothing with a small overshoot.",
              ("playful", "bold"), {"start": START, "duration": DUR(0.5), "overshoot": Param("Overshoot (%)", "float", 112.0, 100.0, 160.0, unit="%")}, _scale_pop),
    Primitive("emphasis.pulse", "Pulse", "1.0.0", "emphasis", ("*",), "A quick scale bump, for a beat or an accent.",
              ("energetic", "beat"), {"start": START, "duration": DUR(0.3), "amount": Param("Amount (%)", "float", 8.0, 1.0, 60.0, unit="%")}, _pulse),
    Primitive("motion.drift", "Slow drift", "1.0.0", "motion", ("*",), "A slow, steady move across the whole duration.",
              ("calm", "cinematic"), {"start": START, "duration": DUR(6.0), "dx": Param("Across (px)", "float", 40.0, -2000.0, 2000.0, unit="px"),
                                      "dy": Param("Down (px)", "float", 0.0, -2000.0, 2000.0, unit="px")}, _drift),
    Primitive("entrance.spin-in", "Spin in", "1.0.0", "entrance", ("*",), "Rotates into place while fading in.",
              ("playful", "dynamic"), {"start": START, "duration": DUR(0.8), "degrees": Param("Turn (degrees)", "float", 90.0, 5.0, 720.0, unit="deg"), "ease": EASE}, _spin_in),
    Primitive("text.reveal-per-char", "Reveal letter by letter", "1.0.0", "text", ("Text",), "Each character fades in, left to right.",
              ("kinetic", "typographic"), dict(_REVEAL_PARAMS), _reveal_per_char),
    Primitive("text.rise-per-char", "Letters rise", "1.0.0", "text", ("Text",), "Each character rises into place and fades in.",
              ("kinetic", "typographic"), {**_REVEAL_PARAMS, "distance": Param("Distance (px)", "float", 40.0, 5.0, 400.0, unit="px")}, _rise_per_char),
]}


def describe() -> list[dict]:
    return [{"id": p.id, "name": p.name, "version": p.version, "category": p.category, "appliesTo": list(p.applies_to), "description": p.description,
             "tags": list(p.tags),
             "params": {k: {"label": v.label, "kind": v.kind, "default": v.default, "min": v.min, "max": v.max, "choices": list(v.choices), "unit": v.unit}
                        for k, v in p.params.items()}} for p in LIBRARY.values()]


def resolve_params(prim: Primitive, given: dict[str, Any] | None) -> dict[str, Any]:
    """Defaults filled in; anything unknown or out of range is rejected with the reason."""
    given = dict(given or {})
    unknown = set(given) - set(prim.params)
    if unknown:
        raise PrimitiveError(f"{prim.id} has no parameter {sorted(unknown)[0]!r}.")
    out: dict[str, Any] = {}
    for k, spec in prim.params.items():
        v = given.get(k, spec.default)
        if spec.kind == "choice":
            if v not in spec.choices:
                raise PrimitiveError(f"{spec.label} must be one of {', '.join(spec.choices)}.")
        else:
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
                raise PrimitiveError(f"{spec.label} must be a number.")
            if (spec.min is not None and v < spec.min) or (spec.max is not None and v > spec.max):
                raise PrimitiveError(f"{spec.label} must be between {spec.min} and {spec.max}.")
        out[k] = v
    return out


def build(prim_id: str, ctx: Ctx, given: dict[str, Any] | None) -> list[Command]:
    prim = LIBRARY.get(prim_id)
    if prim is None:
        raise PrimitiveError(f"Unknown primitive {prim_id!r}.")
    if "*" not in prim.applies_to and ctx.layer_kind not in prim.applies_to:
        raise PrimitiveError(f"{prim.name} works on {', '.join(prim.applies_to)} layers, not {ctx.layer_kind}.")
    p = resolve_params(prim, given)
    if float(p.get("start", 0)) + float(p.get("duration", 0)) > ctx.comp_duration + 1e-6 and prim.category != "emphasis":
        raise PrimitiveError(f"Start plus duration run past the end of the composition ({ctx.comp_duration:g} s).")
    return prim.build(ctx, p)
