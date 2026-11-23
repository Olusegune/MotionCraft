"""Song structure for MotionCraft (P3-01): sections, transients, and a validated import of Pulseframe's SongMap.

Two ways to get sections, on purpose:

  * `estimate_sections` is built in. It uses only the standard library (the helper stays small; librosa would add hundreds of MB), and
    it works from loudness and onset density per bar. It is an ESTIMATE, labelled as one. Measured on Pulseframe's own synthetic test
    song (tests/test_songmap.py): the same six sections as Pulseframe's librosa analysis, within a second.
  * `from_pulseframe` imports a SongMap made by Pulseframe (librosa, and optionally demucs and whisper lyrics with timings): the
    better analysis for real music, which MotionCraft can use without carrying its heavy dependencies. Everything in the file is
    checked and clamped; nothing is trusted.

The labelling rules (`label_sections`) and the moods are ported from Pulseframe `analysis/pulseframe_analysis/analyze.py` at a0ee7ec
(see docs/PORT_LEDGER.md), rewritten without numpy.
"""
from __future__ import annotations

import math
from typing import Any

MIN_SECTION_BARS = 3
GROUP_LOUDNESS = 0.20      # natural-log difference of mean loudness: 0.20 is about 22%
GROUP_BUSYNESS = 0.35      # natural-log difference of onset density: 0.35 is a factor of about 1.4
GROUP_BRIGHTNESS = 0.30    # natural-log difference of high-frequency content: about a factor of 1.35
MAX_SECTIONS = 200
MAX_LYRICS = 2000
MAX_BEATS = 20000
MAX_POINTS = 5000
MOODS = [(3, "Dreamlike"), (5, "Intimate"), (7, "Building"), (9, "Driving"), (11, "Celebratory")]
MARKER_PREFIXES = ("motioncraft:beat", "motioncraft:section:", "motioncraft:lyric:")


class SongMapError(ValueError):
    pass


def mood(energy: int) -> str:
    return next(m for limit, m in MOODS if energy < limit)


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


# ------------------------------------------------------------------------------------------------ labels (ported from Pulseframe)
def label_sections(groups: list[str], energies: list[int], durations: list[float]) -> list[str]:
    n = len(groups)
    counts = {g: groups.count(g) for g in set(groups)}
    mean_energy = {g: _mean([e for gg, e in zip(groups, energies) if gg == g]) for g in counts}
    repeated = [g for g in counts if counts[g] > 1]
    chorus = max(repeated or list(counts), key=lambda g: mean_energy[g])
    labels = []
    for i, (g, e) in enumerate(zip(groups, energies)):
        if g == chorus:
            labels.append("CHORUS")
        elif i == 0 and e <= 4:
            labels.append("INTRO")
        elif i == n - 1 and e <= 5:
            labels.append("OUTRO")
        elif (i + 1 < n and groups[i + 1] == chorus and e < mean_energy[chorus]
              and durations[i] < 0.75 * _mean([d for gg, d in zip(groups, durations) if gg == chorus])):
            labels.append("PRE-CHORUS")
        elif counts[g] == 1 and i > n / 2:
            labels.append("BRIDGE")
        else:
            labels.append("VERSE")
    return labels


# ------------------------------------------------------------------------------------------------ the built-in estimate
def downbeat_phase(beats: list[float], onset: list[float], fps: float, meter: int = 4) -> int:
    """Which of the `meter` beats in a bar is the first: the one whose beats carry the most onset strength (crude, 4/4 assumed)."""
    if len(beats) < meter * 2:
        return 0
    strength = []
    for b in beats:
        c = int(round(b * fps))
        lo, hi = max(0, c - 3), min(len(onset), c + 4)
        strength.append(max(onset[lo:hi]) if hi > lo else 0.0)
    scores = [_mean(strength[p::meter]) for p in range(meter)]
    best = max(range(meter), key=lambda p: (scores[p], -p))
    return best if scores[best] > 1.1 * scores[0] else 0       # no clear accent (a plain click track): the first beat is the first


def _bars(beats: list[float], phase: int, duration: float, meter: int = 4) -> list[tuple[float, float]]:
    starts = beats[phase::meter]
    if len(starts) < 2:
        return []
    period = (starts[-1] - starts[0]) / (len(starts) - 1)
    edges = list(starts) + [starts[-1] + period]
    return [(edges[i], min(edges[i + 1], duration)) for i in range(len(edges) - 1) if edges[i] < duration]


def estimate_sections(env: list[float], onset: list[float], fps: float, beats: list[float], duration: float, bright: list[float] | None = None) -> list[dict]:
    """Sections from loudness, onset density and brightness (high-frequency content) per bar. Returns [] when there is no steady beat to build bars from."""
    if len(beats) < 16 or not env or duration < 20:
        return []
    phase = downbeat_phase(beats, onset, fps)
    bars = _bars(beats, phase, duration)
    if len(bars) < 2 * MIN_SECTION_BARS:
        return []
    rms, dens, bri = [], [], []
    for a, b in bars:
        i0, i1 = int(a * fps), max(int(a * fps) + 1, int(b * fps))
        seg, osg = env[i0:i1], onset[max(0, i0 - 1):max(0, i1 - 1)]
        rms.append(_mean(seg))
        dens.append(sum(osg) / max(b - a, 1e-6))
        bri.append(_mean(bright[i0:i1]) if bright else 0.0)
    nf = 3 if bright else 2
    feats = [[math.log(r + 1e-4), math.log(d + 1e-4), math.log(x + 1e-4)][:nf] for r, d, x in zip(rms, dens, bri)]
    cols = list(zip(*feats))
    centre = [sorted(c)[len(c) // 2] for c in cols]
    spread = [max(math.sqrt(_mean([(x - m) ** 2 for x in c])), 0.25) for c, m in zip(cols, centre)]    # floor: a flat feature must not blow up
    f = [[(x - m) / s for x, m, s in zip(row, centre, spread)] for row in feats]
    n = len(f)
    w = 2
    nov = [0.0] * (n + 1)
    for k in range(1, n):
        left = [_mean([f[j][c] for j in range(max(0, k - w), k)]) for c in range(nf)]
        right = [_mean([f[j][c] for j in range(k, min(n, k + w))]) for c in range(nf)]
        nov[k] = math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))
    top = max(nov)
    if top <= 0:
        return []
    noise = sorted(nov[1:n])[(n - 1) // 4]                              # how much bars differ from their neighbours inside one section: a low percentile,
    thr = max(0.3, 3 * noise, 0.12 * top)                               # because a median is inflated in songs with many short sections
    cands = sorted((k for k in range(MIN_SECTION_BARS, n - MIN_SECTION_BARS + 1) if nov[k] >= thr and nov[k] >= nov[k - 1] and nov[k] >= nov[min(k + 1, n)]),
                   key=lambda k: -nov[k])
    cuts: list[int] = []
    for k in cands:                                                   # strongest first, never closer than the minimum section length
        if all(abs(k - c) >= MIN_SECTION_BARS for c in cuts):
            cuts.append(k)
    edges_i = [0] + sorted(cuts) + [n]
    segs = list(zip(edges_i[:-1], edges_i[1:]))
    # per-section features: group repeated material (in log units, so a tolerance is a ratio)
    sec_feat = [[_mean([feats[j][c] for j in range(a, b)]) for c in range(nf)] for a, b in segs]
    groups: list[str] = []
    reps: list[list[float]] = []
    for v in sec_feat:
        # the same material when it is about as loud (within ~22%) and about as busy (within a factor of ~1.4) and as bright
        close = [i for i, r in enumerate(reps) if abs(v[0] - r[0]) < GROUP_LOUDNESS and abs(v[1] - r[1]) < GROUP_BUSYNESS and (nf < 3 or abs(v[2] - r[2]) < GROUP_BRIGHTNESS)]
        if close:
            best = min(close, key=lambda i: sum(abs(a - b) for a, b in zip(v, reps[i])))
            groups.append(chr(65 + best))
        else:
            reps.append(v)
            groups.append(chr(65 + len(reps) - 1))
    # one section cannot be followed by more of the same material: that is one longer section (a cut inside it was a false alarm)
    merged: list[list] = []                                                  # [first bar, end bar, group]
    for (a, b), g in zip(segs, groups):
        if merged and merged[-1][2] == g:
            merged[-1][1] = b
        else:
            merged.append([a, b, g])
    segs = [(m[0], m[1]) for m in merged]
    groups = [m[2] for m in merged]
    sec_rms = [_mean(rms[a:b]) for a, b in segs]
    lo, hi = min(rms), max(rms)
    energies = [int(min(10, max(1, round(1 + 9 * ((r - lo) / (hi - lo or 1.0)))))) for r in sec_rms]
    times = [(bars[a][0] if a else 0.0, duration if b >= n else bars[b][0]) for a, b in segs]
    labels = label_sections(groups, energies, [t1 - t0 for t0, t1 in times])
    return [{"start": round(t0, 2), "end": round(t1, 2), "label": lab, "group": g, "energy": e, "mood": mood(e)}
            for (t0, t1), lab, g, e in zip(times, labels, groups, energies)]


def find_transients(onset: list[float], fps: float, duration: float) -> list[dict]:
    """Sharp attacks (drum hits, claps, word starts): local peaks well above the typical onset strength, at least 80 ms apart."""
    if len(onset) < 10:
        return []
    mean = _mean(onset)
    sd = math.sqrt(_mean([(x - mean) ** 2 for x in onset]))
    thr = mean + 2.5 * sd
    peak = max(onset)
    if peak <= 0 or thr <= 0:
        return []
    win = max(1, int(0.05 * fps))
    gap = int(0.08 * fps)
    found: list[tuple[int, float]] = []
    for i in range(len(onset)):
        v = onset[i]
        if v < thr:
            continue
        lo, hi = max(0, i - win), min(len(onset), i + win + 1)
        if v < max(onset[lo:hi]):
            continue
        if found and i - found[-1][0] < gap:
            if v > found[-1][1]:
                found[-1] = (i, v)
            continue
        found.append((i, v))
    found.sort(key=lambda p: -p[1])
    keep = sorted(found[:400])
    return [{"t": round((i + 0.5) / fps, 3), "strength": round(v / peak, 3)} for i, v in keep if (i + 0.5) / fps < duration]


def energy_curve(env: list[float], fps: float, step_s: float = 0.5, smooth_s: float = 1.0) -> list[list[float]]:
    """Loudness over time, 0 to 1, a point every half second (as Pulseframe's energy curve)."""
    if not env:
        return []
    w = max(1, int(smooth_s * fps))
    pre = [0.0]
    for x in env:
        pre.append(pre[-1] + x)
    sm = [(pre[min(len(env), i + w // 2 + 1)] - pre[max(0, i - w // 2)]) / (min(len(env), i + w // 2 + 1) - max(0, i - w // 2)) for i in range(len(env))]
    lo, hi = min(sm), max(sm)
    step = max(1, int(step_s * fps))
    return [[round(i / fps, 2), round((sm[i] - lo) / (hi - lo or 1.0), 3)] for i in range(0, len(sm), step)][:MAX_POINTS]


# ------------------------------------------------------------------------------------------------ Pulseframe SongMap import
def _num(v: Any, lo: float, hi: float) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and lo <= v <= hi else None


def _text(v: Any, n: int) -> str:
    return " ".join(str(v or "").split())[:n]


def from_pulseframe(d: Any) -> dict:
    """A Pulseframe SongMap (schema v1), checked and clamped. Raises SongMapError for something that is not one. Returns the normalised map
    plus `warnings` for anything dropped or changed."""
    if not isinstance(d, dict):
        raise SongMapError("That is not a SongMap file.")
    if d.get("schema_version") != 1:
        raise SongMapError(f"This SongMap is schema version {d.get('schema_version')!r}; MotionCraft reads version 1.")
    duration = _num(d.get("duration"), 1, 36000)
    if duration is None:
        raise SongMapError("The SongMap has no usable duration.")
    warnings: list[str] = []
    bpm = _num(d.get("bpm"), 20, 400)
    out_times = {}
    for key in ("beats", "downbeats", "accents"):
        raw = d.get(key) if isinstance(d.get(key), list) else []
        ts = sorted({round(float(t), 3) for t in raw[:MAX_BEATS * 2] if _num(t, 0, duration + 0.5) is not None})[:MAX_BEATS]
        if len(raw) > MAX_BEATS:
            warnings.append(f"Only the first {MAX_BEATS} {key} were kept.")
        out_times[key] = ts
    sections, cursor = [], 0.0
    for s in [x for x in (d.get("sections") if isinstance(d.get("sections"), list) else []) if isinstance(x, dict)][:MAX_SECTIONS]:
        a, b = _num(s.get("start"), 0, duration + 1), _num(s.get("end"), 0, duration + 1)
        if a is None or b is None:
            warnings.append("A section with no usable times was dropped.")
            continue
        a, b = max(a, cursor), min(b, duration)
        if b - a < 0.2:
            warnings.append("A section that was empty, backwards or overlapping was dropped.")
            continue
        e = s.get("energy")
        finite = isinstance(e, (int, float)) and not isinstance(e, bool) and e == e and abs(e) != float("inf")
        energy = int(min(10, max(1, round(e)))) if finite else 5          # out of range is clamped, not replaced; a missing or non-number gets the middle
        sections.append({"start": round(a, 2), "end": round(b, 2), "label": _text(s.get("label"), 24).upper() or "SECTION",
                         "group": _text(s.get("group"), 24) or "A", "energy": energy, "mood": _text(s.get("mood"), 24) or mood(energy)})
        cursor = b
    lyrics = []
    for ln in [x for x in (d.get("lyrics") if isinstance(d.get("lyrics"), list) else []) if isinstance(x, dict)][:MAX_LYRICS]:
        a, b = _num(ln.get("start"), 0, duration + 1), _num(ln.get("end"), 0, duration + 1)
        text = _text(ln.get("text"), 200)
        if a is None or b is None or b < a or not text:
            continue
        lyrics.append({"text": text, "start": round(a, 2), "end": round(min(b, duration), 2), "section": _text(ln.get("section"), 24)})
    lyrics.sort(key=lambda x: x["start"])
    curve = []
    for p in (d.get("energy_curve") if isinstance(d.get("energy_curve"), list) else [])[:MAX_POINTS]:
        if isinstance(p, (list, tuple)) and len(p) == 2 and _num(p[0], 0, duration + 1) is not None and _num(p[1], 0, 1) is not None:
            curve.append([round(float(p[0]), 2), round(float(p[1]), 3)])
    return {"source": "pulseframe", "analyzer": _text(d.get("analyzer"), 80), "duration": round(duration, 3), "bpm": round(bpm, 2) if bpm else None,
            "beats": out_times["beats"], "downbeats": out_times["downbeats"], "accents": out_times["accents"], "energyCurve": curve,
            "sections": sections, "lyrics": lyrics, "lyricMatch": _num(d.get("lyric_match"), 0, 1), "warnings": warnings}


# ------------------------------------------------------------------------------------------------ markers
def markers_for(*, beats: list[float] | None = None, sections: list[dict] | None = None, lyrics: list[dict] | None = None) -> list[dict]:
    """The comp markers for a song: beats, section starts (`motioncraft:section:VERSE B`) and lyric lines (`motioncraft:lyric:text`)."""
    items = [{"time": round(float(t), 3), "comment": "motioncraft:beat"} for t in (beats or [])]
    for s in sections or []:
        grp = s.get("group") or ""
        items.append({"time": float(s["start"]), "comment": f"motioncraft:section:{s['label']}" + (f" {grp}" if grp and len(grp) <= 3 else "")})
    for ln in lyrics or []:
        items.append({"time": float(ln["start"]), "comment": "motioncraft:lyric:" + ln["text"][:50]})
    return sorted(items, key=lambda m: (m["time"], m["comment"]))[:3000]


def check_marker_items(items: Any) -> list[dict]:
    """Markers a page asks to be written: only ours (the three prefixes), sane times, short comments."""
    if not isinstance(items, list) or not items:
        raise SongMapError("There are no markers to write.")
    out = []
    for m in items[:3000]:
        t = _num(m.get("time") if isinstance(m, dict) else None, 0, 36000)
        c = m.get("comment") if isinstance(m, dict) else None
        if t is None or not isinstance(c, str) or not c.startswith(MARKER_PREFIXES):
            raise SongMapError("A marker was not one MotionCraft writes (beat, section or lyric).")
        out.append({"time": round(t, 3), "comment": " ".join(c.split())[:80]})
    return out
