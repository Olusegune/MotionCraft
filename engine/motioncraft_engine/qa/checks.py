"""The 14 tier-1 checks (PRD "QA"). Each takes a `Scene` (plain data the sidecar collects) and returns a `Result`.

Rules every check follows:
  * a missing input is "not-checked" with the reason, never "passed";
  * a number measured or estimated is shown with its threshold, and an estimate says it is an estimate;
  * a finding on a layer names the layer; a fix is offered only when it is safe (and none is applied here: fixes are P4-04).
Assumptions are named where they are made: layer positions are pixels from the top-left of the composition (the mock and the
primitives use that convention), and text size is the font size in pixels.
"""
from __future__ import annotations

import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import images

SAFE_TOLERANCE_PX = 0.5       # less than half a pixel outside is not a violation (and absorbs rounding in the fix)
SAFE_FRACTION = 0.90          # graphics-safe: the inner 90% of width and height
CHAR_WIDTH = 0.55             # average glyph width as a fraction of the font size (an estimate)
LINE_HEIGHT = 1.2
CONTRAST_SMALL, CONTRAST_LARGE = 4.5, 3.0   # WCAG AA; "large" text is 36 px or more in a video frame
LARGE_PX = 36
BEAT_TOLERANCE_FRAMES = 1.0
AUDIO_LONG_S, AUDIO_SHORT_S = 0.5, 1.0
ASPECT_TOLERANCE = 0.005      # comp size against the deliverable size
LABEL_TOLERANCE = 0.02        # a label such as 21:9 against the real pixel ratio


@dataclass
class Layer:
    id: int
    name: str
    kind: str
    parent: int | None = None
    text: str | None = None
    font: str | None = None
    size: float | None = None
    position: tuple[float, float] | None = None
    position_z: float = 0.0
    position_keyed: bool = False        # the position is animated: a fixed value would fight the keyframes
    scale: tuple[float, float] = (100.0, 100.0)
    opacity: float = 100.0
    t_in: float | None = None
    t_out: float | None = None


@dataclass
class Scene:
    width: int
    height: int
    fps: float
    duration: float
    layers: list[Layer]
    deliverable: dict[str, Any]
    assets: list[dict[str, Any]] = field(default_factory=list)       # [{id, kind, path}] path relative to the package
    package: Path | None = None
    renders: list[dict[str, Any]] = field(default_factory=list)      # [{preset}]
    installed_fonts: set[str] | None = None                          # None: the engine could not list them
    font_manifest: list[dict[str, Any]] | None = None                # fonts/manifest.json; None: unreadable
    markers: list[dict[str, Any]] | None = None                      # [{time, comment}]; None: not readable from this engine
    audio: list[dict[str, Any]] = field(default_factory=list)        # [{path, duration, beats}] for analysable audio
    audio_skipped: list[str] = field(default_factory=list)           # audio assets that could not be analysed, with why
    frames: dict[int, tuple[float, bytes]] = field(default_factory=dict)   # layer id -> (time, PNG of the composition)


@dataclass
class Result:
    check: str
    label: str
    state: str = "passed"                  # passed | findings | not-checked
    reason: str = ""
    findings: list[dict] = field(default_factory=list)


def finding(check: str, severity: str, detail: str, cause: str, *, layer: int | None = None, time: float | None = None,
            measured: float | None = None, threshold: float | None = None, fix: dict | None = None, **extra: Any) -> dict:
    at: dict[str, Any] = {}
    if layer is not None:
        at["layerId"] = layer
    if time is not None:
        at["timeSec"] = round(time, 3)
    ev: dict[str, Any] = {"detail": detail, **extra}
    if measured is not None:
        ev["measured"] = round(float(measured), 4)
    if threshold is not None:
        ev["threshold"] = round(float(threshold), 4)
    f: dict[str, Any] = {"id": secrets.token_hex(4), "check": check, "tier": 1, "severity": severity, "evidence": ev, "cause": cause}
    if at:
        f["at"] = at
    if fix:
        f["fix"] = fix
    return f


def _done(res: Result) -> Result:
    if res.state != "not-checked":
        res.state = "findings" if res.findings else "passed"
    return res


def _unchecked(check: str, label: str, why: str) -> Result:
    return Result(check, label, "not-checked", why)


def _text_layers(s: Scene) -> list[Layer]:
    return [l for l in s.layers if l.kind == "Text" and (l.text or "").strip()]


def box(l: Layer) -> tuple[float, float, float, float] | None:
    """Estimated (left, top, right, bottom) of a text layer: centred on its position. An estimate: the real glyph extents are not reported."""
    if l.position is None or not l.size:
        return None
    lines = (l.text or "").split("\n")
    w = max((len(x) for x in lines), default=0) * l.size * CHAR_WIDTH * l.scale[0] / 100
    h = len(lines) * l.size * LINE_HEIGHT * l.scale[1] / 100
    x, y = l.position
    return (x - w / 2, y - h / 2, x + w / 2, y + h / 2)


def visible_window(l: Layer, s: Scene) -> tuple[float, float]:
    return (max(0.0, l.t_in if l.t_in is not None else 0.0), min(s.duration, l.t_out if l.t_out is not None else s.duration))


# ------------------------------------------------------------------------------------------------------------------ 1
def missing_assets(s: Scene) -> Result:
    r = Result("missing-assets", "Missing assets")
    if s.package is None:
        return _unchecked(r.check, r.label, "No project folder is open in the engine.")
    for a in s.assets:
        rel = Path(str(a.get("path", "")))
        ok_path = not rel.is_absolute() and ".." not in rel.parts
        if ok_path and (s.package / rel).is_file():
            continue
        cands = []
        if ok_path:
            for p in (s.package / "assets").rglob(rel.name):
                if p.is_file():
                    cands.append(p.relative_to(s.package).as_posix())
        fix = {"label": f"Relink to {cands[0]}", "safe": True, "commands": [], "kind": "relink", "relink": {"assetId": a.get("id"), "to": cands[0]}} if len(cands) == 1 else None
        r.findings.append(finding(r.check, "error", f"{a.get('path')} is not in the project folder.", "The file was moved, renamed or deleted after it was imported.",
                                  fix=fix, assetId=a.get("id"), candidates=cands))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 2
def _fonts_used(s: Scene) -> dict[str, list[Layer]]:
    used: dict[str, list[Layer]] = {}
    for l in _text_layers(s):
        if l.font:
            used.setdefault(l.font, []).append(l)
    return used


def missing_fonts(s: Scene) -> Result:
    r = Result("missing-fonts", "Missing fonts")
    texts = _text_layers(s)
    used = _fonts_used(s)
    if texts and not used:
        return _unchecked(r.check, r.label, "EffectCraft did not report which font each text layer uses.")
    if s.installed_fonts is None:
        return _unchecked(r.check, r.label, "The list of installed fonts could not be read from EffectCraft.")
    have = {f.lower() for f in s.installed_fonts}
    for fam, ls in used.items():
        if fam.lower() not in have:
            for l in ls:
                r.findings.append(finding(r.check, "error", f"{fam} is not installed on this computer.", "The project was made on a computer with this font, or it was uninstalled. "
                                          "Text would be drawn in a substitute font.", layer=l.id))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 3
def font_licence(s: Scene) -> Result:
    r = Result("font-licence", "Font licence for video use")
    used = _fonts_used(s)
    if _text_layers(s) and not used:
        return _unchecked(r.check, r.label, "EffectCraft did not report which font each text layer uses.")
    if s.font_manifest is None:
        return _unchecked(r.check, r.label, "The project's font manifest (fonts/manifest.json) could not be read.")
    by = {str(m.get("family", "")).lower(): m for m in s.font_manifest if isinstance(m, dict)}
    for fam, ls in used.items():
        m = by.get(fam.lower())
        for l in ls:
            if m is None:
                r.findings.append(finding(r.check, "info", f"No licence is recorded for {fam}.", "Fonts used in video need a licence that allows it. Record it in the font manifest.", layer=l.id))
            elif str(m.get("videoUse", "")).lower() in ("no", "false", "not-allowed"):
                r.findings.append(finding(r.check, "error", f"The licence recorded for {fam} does not allow video use.", f"Licence: {m.get('licence', 'not stated')}.", layer=l.id))
            elif str(m.get("videoUse", "")).lower() not in ("yes", "true", "allowed"):
                r.findings.append(finding(r.check, "info", f"The recorded licence for {fam} does not say whether video use is allowed.", f"Licence: {m.get('licence', 'not stated')}.", layer=l.id))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 4
def frame_rate(s: Scene) -> Result:
    r = Result("frame-rate", "Frame rate")
    want = float(s.deliverable.get("fps") or 0)
    if want <= 0:
        return _unchecked(r.check, r.label, "The deliverable has no frame rate.")
    if abs(s.fps - want) > 0.005:
        r.findings.append(finding(r.check, "error", f"The composition runs at {s.fps:g} fps; the deliverable asks for {want:g} fps.", "The composition was created with other settings, or the deliverable was changed later.",
                                  measured=s.fps, threshold=want))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 5
def _ratio(label: str) -> float | None:
    m = re.fullmatch(r"\s*([0-9.]+)\s*:\s*([0-9.]+)\s*", str(label))
    return float(m.group(1)) / float(m.group(2)) if m and float(m.group(2)) else None


def aspect_ratio(s: Scene) -> Result:
    r = Result("aspect-ratio", "Aspect ratio")
    dw, dh = int(s.deliverable.get("width") or 0), int(s.deliverable.get("height") or 0)
    if not (dw and dh and s.width and s.height):
        return _unchecked(r.check, r.label, "The deliverable has no size.")
    comp, want = s.width / s.height, dw / dh
    if abs(comp - want) / want > ASPECT_TOLERANCE:
        r.findings.append(finding(r.check, "error", f"The composition is {s.width}x{s.height} ({comp:.3f}); the deliverable is {dw}x{dh} ({want:.3f}).",
                                  "Frames would be stretched or cropped on delivery.", measured=comp, threshold=want))
    lab = _ratio(str(s.deliverable.get("aspect", "")))
    if lab is not None and abs(lab - want) / want > LABEL_TOLERANCE:
        r.findings.append(finding(r.check, "warn", f"The deliverable is labelled {s.deliverable.get('aspect')} but {dw}x{dh} is {want:.3f}.", "The label and the size disagree.", measured=want, threshold=lab))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 6
def low_resolution(s: Scene) -> Result:
    r = Result("low-resolution", "Low-resolution media")
    if s.package is None:
        return _unchecked(r.check, r.label, "No project folder is open in the engine.")
    pics = [a for a in s.assets if a.get("kind") == "image"]
    vids = [a for a in s.assets if a.get("kind") == "video"]
    for a in pics:
        rel = Path(str(a.get("path", "")))
        if rel.is_absolute() or ".." in rel.parts:
            continue
        sz = images.size_of(s.package / rel)
        if sz is None:
            continue
        stem = rel.stem.lower()
        used = [l for l in s.layers if l.kind == "Footage" and l.name.lower() in (stem, rel.name.lower())]
        for l in used:
            shown = max(sz[0] * l.scale[0] / 100, 1)
            pct = l.scale[0]
            if pct > 100 + 0.5:
                r.findings.append(finding(r.check, "warn", f"{rel.name} is {sz[0]}x{sz[1]} and is shown at {pct:.0f}% (about {shown:.0f} px wide).", "A picture scaled above 100% is enlarged and looks soft.",
                                          layer=l.id, measured=pct, threshold=100,
                                          fix={"label": "Upscale the original picture (Topaz)", "safe": False, "commands": []}))
        if not used and sz[0] < s.width and sz[1] < s.height:
            r.findings.append(finding(r.check, "info", f"{rel.name} is {sz[0]}x{sz[1]}, smaller than the {s.width}x{s.height} composition.",
                                      "Fine if it is used smaller than full frame. Soft if it is stretched to fill it.", measured=sz[0], threshold=s.width))
    if vids and not r.findings:
        return Result(r.check, r.label, "not-checked", "Video sizes need ffprobe, which is not used yet. Pictures were checked.") if not pics else _done(r)
    return _done(r)


def _move_fix(l: Layer, b: tuple[float, float, float, float], s: Scene, mx: float, my: float) -> dict | None:
    """A static nudge back inside the safe area. Offered only when it can work: the text fits inside, and its position is not animated."""
    if l.position is None or l.position_keyed:
        return None
    if (b[2] - b[0]) > s.width - 2 * mx or (b[3] - b[1]) > s.height - 2 * my:
        return None                      # wider than the safe area: moving cannot help, the text itself has to change
    dx = mx - b[0] if b[0] < mx else (s.width - mx) - b[2] if b[2] > s.width - mx else 0.0
    dy = my - b[1] if b[1] < my else (s.height - my) - b[3] if b[3] > s.height - my else 0.0
    x, y = round(l.position[0] + dx, 1), round(l.position[1] + dy, 1)
    way = " and ".join(w for w in (f"{abs(dx):.0f} px {'right' if dx > 0 else 'left'}" if dx else "", f"{abs(dy):.0f} px {'down' if dy > 0 else 'up'}" if dy else "") if w)
    return {"label": f"Move it {way}", "safe": True, "kind": "move",
            "commands": [{"id": "prop.set", "params": {"layer": l.id, "path": "transform/position", "value": [x, y, l.position_z]}}]}


# ------------------------------------------------------------------------------------------------------------------ 7
def safe_title(s: Scene) -> Result:
    r = Result("safe-title", "Safe-title violations")
    texts = _text_layers(s)
    if not texts:
        return _done(r)
    margin_x, margin_y = s.width * (1 - SAFE_FRACTION) / 2, s.height * (1 - SAFE_FRACTION) / 2
    known = 0
    for l in texts:
        b = box(l)
        if b is None:
            continue
        known += 1
        out = max(margin_x - b[0], b[2] - (s.width - margin_x), margin_y - b[1], b[3] - (s.height - margin_y), 0)
        if out > SAFE_TOLERANCE_PX:
            r.findings.append(finding(r.check, "warn", f"“{(l.text or '')[:40]}” reaches about {out:.0f} px outside the {SAFE_FRACTION:.0%} safe area (estimated from its size and position).",
                                      "Some screens crop the edges. Move the text inwards.", layer=l.id, measured=out, threshold=0, estimated=True, fix=_move_fix(l, b, s, margin_x, margin_y)))
    if not known:
        return _unchecked(r.check, r.label, "EffectCraft did not report the position and size of the text layers.")
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 8
def text_collisions(s: Scene) -> Result:
    r = Result("text-collisions", "Text collisions")
    items = [(l, box(l)) for l in _text_layers(s)]
    items = [(l, b) for l, b in items if b is not None]
    if len(_text_layers(s)) > 1 and len(items) < 2:
        return _unchecked(r.check, r.label, "EffectCraft did not report the position and size of the text layers.")
    for i, (a, ba) in enumerate(items):
        for b, bb in items[i + 1:]:
            wa, wb = visible_window(a, s), visible_window(b, s)
            t0, t1 = max(wa[0], wb[0]), min(wa[1], wb[1])
            if t1 - t0 <= 1e-6:
                continue
            ox, oy = min(ba[2], bb[2]) - max(ba[0], bb[0]), min(ba[3], bb[3]) - max(ba[1], bb[1])
            if ox > 0 and oy > 0:
                small = min((ba[2] - ba[0]) * (ba[3] - ba[1]), (bb[2] - bb[0]) * (bb[3] - bb[1])) or 1
                share = ox * oy / small
                if share > 0.1:
                    r.findings.append(finding(r.check, "warn", f"“{(a.text or '')[:30]}” and “{(b.text or '')[:30]}” overlap by {share:.0%} between {t0:.2f}s and {t1:.2f}s (estimated).",
                                              "Two texts are on screen in the same place at the same time.", layer=a.id, time=t0, measured=share, threshold=0.1, estimated=True, otherLayer=b.id))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 9
def contrast(s: Scene) -> Result:
    r = Result("contrast", "Contrast on rendered frames")
    texts = _text_layers(s)
    if not texts:
        return _done(r)
    if not s.frames:
        return _unchecked(r.check, r.label, "No rendered frame was available to measure.")
    measured_any = False
    for l in texts:
        fr = s.frames.get(l.id)
        b = box(l)
        if fr is None or b is None:
            continue
        t, png = fr
        dec = images.png_luminance(png)
        if dec is None:
            continue
        w, h, lum = dec
        sx, sy = w / s.width, h / s.height
        x0, x1 = max(0, int(b[0] * sx)), min(w, int(b[2] * sx) + 1)
        y0, y1 = max(0, int(b[1] * sy)), min(h, int(b[3] * sy) + 1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        px = sorted(lum[y * w + x] for y in range(y0, y1) for x in range(x0, x1))
        lo, hi = px[int(len(px) * 0.05)], px[min(len(px) - 1, int(len(px) * 0.95))]
        ratio = images.contrast_ratio(hi, lo)
        measured_any = True
        need = CONTRAST_LARGE if (l.size or 0) >= LARGE_PX else CONTRAST_SMALL
        if ratio < need:
            r.findings.append(finding(r.check, "warn", f"“{(l.text or '')[:40]}” has a contrast of {ratio:.2f}:1 at {t:.2f}s; {need:g}:1 is the minimum for this size (measured on the rendered frame, in an estimated text area).",
                                      "The text colour is too close to what is behind it.", layer=l.id, time=t, measured=ratio, threshold=need, estimated=True))
    if not measured_any:
        return _unchecked(r.check, r.label, "The rendered frames could not be read (an 8-bit RGB or RGBA PNG is needed).")
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 10
def audio_drift(s: Scene) -> Result:
    r = Result("audio-drift", "Audio drift")
    if not s.audio:
        why = f" ({'; '.join(s.audio_skipped)})" if s.audio_skipped else ""
        return _unchecked(r.check, r.label, f"No audio file could be analysed{why}." if s.audio_skipped else "There is no audio in the project.")
    for a in s.audio:
        d = float(a.get("duration") or 0)
        diff = d - s.duration
        if diff > AUDIO_LONG_S:
            r.findings.append(finding(r.check, "info", f"{a['path']} is {d:.2f}s; the composition is {s.duration:.2f}s. The last {diff:.2f}s will be cut.",
                                      "The audio is longer than the piece.", measured=d, threshold=s.duration))
        elif -diff > AUDIO_SHORT_S:
            r.findings.append(finding(r.check, "warn", f"{a['path']} is {d:.2f}s; the composition is {s.duration:.2f}s. The last {-diff:.2f}s will be silent.",
                                      "The audio ends before the piece does.", measured=d, threshold=s.duration))
    r.reason = "Measures the length mismatch between audio and composition, the part of drift that needs no render."
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 11
def beat_misalignment(s: Scene) -> Result:
    r = Result("beat-misalignment", "Beat misalignment")
    if s.markers is None:
        return _unchecked(r.check, r.label, "Markers cannot be read back from this EffectCraft yet.")
    beats = sorted({round(float(t), 4) for a in s.audio for t in (a.get("beats") or [])})
    marks = sorted(float(m["time"]) for m in s.markers if str(m.get("comment", "")).startswith("motioncraft:beat"))
    if not beats:
        return _unchecked(r.check, r.label, "There are no detected beats to compare with (needs a WAV file with a steady beat).")
    if not marks:
        return _unchecked(r.check, r.label, "No beat markers have been written to the composition.")
    tol = BEAT_TOLERANCE_FRAMES / s.fps
    for t in marks:
        near = min(beats, key=lambda b: abs(b - t))
        if abs(near - t) > tol + 1e-9:
            r.findings.append(finding(r.check, "warn", f"The marker at {t:.3f}s is {abs(near - t) * s.fps:.1f} frames from the nearest beat ({near:.3f}s).",
                                      "The markers were written for different audio, or the audio was trimmed or moved.", time=t, measured=abs(near - t) * s.fps, threshold=BEAT_TOLERANCE_FRAMES))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 12
def alpha_errors(s: Scene) -> Result:
    r = Result("alpha", "Alpha errors")
    if not s.deliverable.get("alpha"):
        r.reason = "The deliverable does not ask for transparency."
        return _done(r)
    for rn in s.renders:
        if str(rn.get("preset", "")) == "h264":
            r.findings.append(finding(r.check, "error", "A render for this transparent deliverable used H.264, which has no alpha channel.", "Use ProRes 4444 for transparency.", preset="h264"))
    for l in s.layers:
        if l.kind == "Solid" and l.opacity >= 99.5 and l.scale[0] >= 99.5 and l.scale[1] >= 99.5:
            r.findings.append(finding(r.check, "warn", f"{l.name} is an opaque full-frame solid, so the exported picture will not be transparent.",
                                      "A solid background fills the alpha channel. Hide it or lower its opacity for a transparent export.", layer=l.id, measured=l.opacity, threshold=0))
    return _done(r)


# ------------------------------------------------------------------------------------------------------------------ 13, 14
def colour_space(s: Scene) -> Result:
    return _unchecked("colour-space", "Colour space", "EffectCraft does not report colour management at this version, so there is nothing to compare.")


def unsupported_effects(s: Scene) -> Result:
    return _unchecked("unsupported-effects", "Unsupported effects", "This compares the composition with an export target (After Effects or Lottie). No target is chosen yet.")


# ------------------------------------------------------------------------------------------------------------------ 15
def orphan_layers(s: Scene) -> Result:
    r = Result("orphan-layers", "Orphan layers")
    ids = {l.id for l in s.layers}
    for l in s.layers:
        if l.parent is not None and l.parent not in ids:
            r.findings.append(finding(r.check, "warn", f"{l.name} is parented to a layer that no longer exists.", "The parent was deleted.", layer=l.id))
        if l.kind == "Text" and not (l.text or "").strip():
            r.findings.append(finding(r.check, "warn", f"{l.name} is a text layer with no text.", "Nothing is drawn. Delete it or type the text.", layer=l.id))
        if l.t_in is not None and l.t_out is not None and (l.t_out <= 0 or l.t_in >= s.duration):
            r.findings.append(finding(r.check, "warn", f"{l.name} is outside the composition's {s.duration:g}s ({l.t_in:g}s to {l.t_out:g}s).", "The layer is never on screen.", layer=l.id))
    return _done(r)


CHECKS: list[Callable[[Scene], Result]] = [
    missing_assets, missing_fonts, font_licence, frame_rate, aspect_ratio, low_resolution, safe_title, text_collisions, contrast, audio_drift,
    beat_misalignment, alpha_errors, colour_space, unsupported_effects, orphan_layers,
]


def run_all(s: Scene) -> list[Result]:
    out = []
    for fn in CHECKS:
        try:
            out.append(fn(s))
        except Exception as e:  # noqa: BLE001 - one broken check must not hide the others, and must not read as a pass
            out.append(Result(fn.__name__.replace("_", "-"), fn.__name__.replace("_", " ").capitalize(), "not-checked", f"The check failed to run: {type(e).__name__}."))
    return out


def to_dict(r: Result) -> dict:
    return {"check": r.check, "label": r.label, "state": r.state, "reason": r.reason, "count": len(r.findings), "findings": r.findings}
