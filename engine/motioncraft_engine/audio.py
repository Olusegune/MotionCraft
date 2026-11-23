"""Audio analysis for the waveform, tempo and beats (pure Python for WAV; other formats need ffmpeg to convert first).

Scope, honestly: a waveform (peaks), loudness envelope, a tempo estimate from onset energy, a beat grid, and silences. It is
not Pulseframe's analysis (sections, word timings, stems); that package is a later ticket (P3-01). Results are an estimate; the
UI shows them as such.
"""
from __future__ import annotations

import array
import math
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

from .proc import NO_WINDOW


class AudioError(Exception):
    pass


MAX_SECONDS = 20 * 60


def _read_wav(path: Path) -> tuple[list[float], int]:
    """Mono float samples in -1..1 and the sample rate. 8, 16, 24 and 32 bit PCM."""
    try:
        with wave.open(str(path), "rb") as w:
            ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            if n / max(rate, 1) > MAX_SECONDS:
                raise AudioError("That audio is longer than 20 minutes.")
            raw = w.readframes(n)
    except wave.Error as e:
        raise AudioError(f"Not a PCM WAV file ({e}).") from None
    if width == 2:
        a = array.array("h")
        a.frombytes(raw)
        data = [x / 32768.0 for x in a]
    elif width == 1:
        data = [(x - 128) / 128.0 for x in raw]
    elif width == 3:
        data = [int.from_bytes(raw[i:i + 3], "little", signed=True) / 8388608.0 for i in range(0, len(raw) - 2, 3)]
    elif width == 4:
        a = array.array("i")
        a.frombytes(raw)
        data = [x / 2147483648.0 for x in a]
    else:
        raise AudioError("Unsupported WAV sample size.")
    if ch > 1:
        data = [sum(data[i:i + ch]) / ch for i in range(0, len(data) - ch + 1, ch)]
    return data, rate


def to_wav(path: Path) -> tuple[Path, bool]:
    """Returns (a WAV path, is_temporary). Non-WAV needs ffmpeg on PATH."""
    if path.suffix.lower() == ".wav":
        return path, False
    ff = shutil.which("ffmpeg")
    if not ff:
        raise AudioError("This audio is not a WAV file and ffmpeg is not installed. Convert it to WAV, or install ffmpeg.")
    out = Path(tempfile.mkstemp(suffix=".wav")[1])
    r = subprocess.run([ff, "-v", "error", "-y", "-i", str(path), "-ac", "1", "-ar", "22050", "-t", str(MAX_SECONDS), str(out)],
                       capture_output=True, timeout=300, shell=False, **NO_WINDOW)
    if r.returncode != 0:
        out.unlink(missing_ok=True)
        raise AudioError("ffmpeg could not read that audio file.")
    return out, True


def analyze(path: Path, *, bins: int = 600) -> dict:
    wav, temp = to_wav(Path(path))
    try:
        data, rate = _read_wav(wav)
    finally:
        if temp:
            wav.unlink(missing_ok=True)
    if not data:
        raise AudioError("That audio is empty.")
    duration = len(data) / rate
    # waveform peaks
    step = max(1, len(data) // bins)
    peaks = [round(max(abs(x) for x in data[i:i + step]), 4) for i in range(0, len(data), step)][:bins]
    # loudness envelope at 100 Hz (10 ms RMS frames)
    hop = max(1, rate // 100)
    env = []
    for i in range(0, len(data) - hop + 1, hop):
        seg = data[i:i + hop]
        env.append(math.sqrt(sum(x * x for x in seg) / hop))
    fps_env = rate / hop
    # onset strength: positive change of the envelope, lightly smoothed
    onset = [max(0.0, env[i] - env[i - 1]) for i in range(1, len(env))]
    onset = [(onset[i - 1] + onset[i] + (onset[i + 1] if i + 1 < len(onset) else 0)) / 3 if i else onset[0] for i in range(len(onset))]
    bpm, beats = _tempo(onset, fps_env, duration)
    silences = _silences(env, fps_env)
    return {"duration": round(duration, 3), "sampleRate": rate, "peaks": peaks, "bpm": bpm, "beats": beats, "silences": silences,
            "downbeats": beats[::4], "estimate": True}


def _tempo(onset: list[float], fps: float, duration: float) -> tuple[float | None, list[float]]:
    if len(onset) < fps * 3 or max(onset, default=0) < 1e-4:
        return None, []
    mean = sum(onset) / len(onset)
    on = [x - mean for x in onset]
    best, best_lag = -1e18, 0
    for bpm in range(60, 181):
        lag = int(round(fps * 60.0 / bpm))
        if lag >= len(on) // 2:
            continue
        s = sum(on[i] * on[i + lag] for i in range(len(on) - lag)) / (len(on) - lag)
        # a small bias towards 90-150 BPM avoids picking half or double time
        s *= 1.0 + 0.05 * math.exp(-((bpm - 120) / 40.0) ** 2)
        if s > best:
            best, best_lag = s, lag
    if best <= 0:
        return None, []
    period = best_lag / fps
    # phase: the offset whose grid collects the most onset energy
    best_phase, best_sum = 0, -1.0
    for ph in range(best_lag):
        s = sum(onset[i] for i in range(ph, len(onset), best_lag))
        if s > best_sum:
            best_sum, best_phase = s, ph
    t = best_phase / fps
    grid = []
    while t < duration:
        grid.append(t)
        t += period
    # Refine: snap each predicted beat to the strongest onset within +-60 ms, then fit a straight line through the snapped
    # times. That removes the rounding of the lag to whole 10 ms frames, which otherwise drifts by tens of ms over a song.
    win = int(0.06 * fps)
    snapped = []
    for k, g in enumerate(grid):
        c = int(round(g * fps))
        lo, hi = max(0, c - win), min(len(onset), c + win + 1)
        if hi - lo < 3:
            continue
        j = max(range(lo, hi), key=lambda i: onset[i])
        if onset[j] > 0.2 * max(onset[lo:hi] + [1e-9]) and onset[j] > mean:
            snapped.append((k, (j + 0.5) / fps))
    if len(snapped) >= 4:
        n = len(snapped)
        sk = sum(k for k, _ in snapped)
        st = sum(x for _, x in snapped)
        skk = sum(k * k for k, _ in snapped)
        skt = sum(k * x for k, x in snapped)
        den = n * skk - sk * sk
        if den:
            period = (n * skt - sk * st) / den
            t0 = (st - period * sk) / n
            grid = [t0 + k * period for k in range(int(-t0 / period) + 1 if t0 < 0 else 0, int((duration - t0) / period) + 1)]
    beats = [round(x, 3) for x in grid if 0 <= x < duration]
    return round(60.0 / period, 1), beats


def _silences(env: list[float], fps: float, min_len: float = 0.5) -> list[list[float]]:
    peak = max(env, default=0)
    if peak <= 0:
        return []
    thr = peak * 0.02
    out, start = [], None
    for i, e in enumerate(env + [peak]):
        if e < thr and start is None:
            start = i
        elif e >= thr and start is not None:
            if (i - start) / fps >= min_len:
                out.append([round(start / fps, 3), round(i / fps, 3)])
            start = None
    return out


def make_click_track(path: Path, bpm: float = 120.0, seconds: float = 12.0, rate: int = 22050) -> None:
    """A synthetic test song: a short click on every beat. Used by tests."""
    n = int(seconds * rate)
    samples = [0] * n
    period = int(rate * 60.0 / bpm)
    for b in range(0, n, period):
        for i in range(int(0.02 * rate)):
            if b + i < n:
                samples[b + i] = int(20000 * math.sin(2 * math.pi * 1000 * i / rate) * (1 - i / (0.02 * rate)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<" + "h" * n, *samples))
