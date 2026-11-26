"""Synthetic songs with a known structure, written with the standard library only (no numpy), so the built-in analysis can be checked
against ground truth. `pulseframe_song` is Pulseframe's own test song (analysis/make_test_song.py at a0ee7ec): 120 BPM, 4/4,
INTRO 8 | VERSE 8 | CHORUS 8 | VERSE 8 | CHORUS 8 | OUTRO 4 bars of 2 s. The hats use Python's random instead of numpy's generator,
so the audio is not byte-identical to Pulseframe's, but the structure, instruments and levels are the same."""
from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SR = 22050

PULSEFRAME_SECTIONS = [  # name, bars, chord freqs, pad amp, drums on, hats on
    ("INTRO", 8, [220, 277, 330], 0.10, False, False),
    ("VERSE", 8, [196, 247, 294], 0.15, True, False),
    ("CHORUS", 8, [262, 330, 392, 523], 0.30, True, True),
    ("VERSE", 8, [196, 247, 294], 0.15, True, False),
    ("CHORUS", 8, [262, 330, 392, 523], 0.30, True, True),
    ("OUTRO", 4, [220, 277, 330], 0.08, False, False),
]


def _tone(freqs, dur, amp):
    n = int(dur * SR)
    return [amp * sum(math.sin(2 * math.pi * f * i / SR) for f in freqs) / len(freqs) for i in range(n)]


def _kick(amp):
    n = int(0.25 * SR)
    return [amp * math.sin(2 * math.pi * (50 + 100 * math.exp(-(i / SR) * 30)) * (i / SR)) * math.exp(-(i / SR) * 12) for i in range(n)]


def _hat(amp, rng):
    n = int(0.05 * SR)
    return [amp * rng.gauss(0, 1) * math.exp(-i / SR * 80) for i in range(n)]


def write_song(path: Path, sections=PULSEFRAME_SECTIONS, bpm: float = 120.0) -> list[tuple[str, float, float]]:
    """Writes the song as a 16-bit mono WAV and returns the ground truth: [(name, start_s, end_s)]."""
    beat = 60.0 / bpm
    rng = random.Random(0)
    y: list[float] = []
    truth, t0 = [], 0.0
    for name, bars, chord, pad, drums, hats in sections:
        dur = bars * 4 * beat
        seg = _tone(chord, dur, pad)
        if drums:
            for b in range(bars * 4):
                i = int(b * beat * SR)
                k = _kick(0.8 if b % 4 == 0 else 0.5)
                for j, v in enumerate(k[: len(seg) - i]):
                    seg[i + j] += v
        if hats:
            for b in range(bars * 8):
                i = int(b * beat / 2 * SR)
                h = _hat(0.15, rng)
                for j, v in enumerate(h[: len(seg) - i]):
                    seg[i + j] += v
        y.extend(seg)
        truth.append((name, round(t0, 2), round(t0 + dur, 2)))
        t0 += dur
    peak = max(abs(v) for v in y) or 1.0
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack("<" + "h" * len(y), *[int(v / peak * 0.9 * 32767) for v in y]))
    return truth
