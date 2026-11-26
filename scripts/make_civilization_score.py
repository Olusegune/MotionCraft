"""A 90-second placeholder score for the Civilization I-VII walkthrough, made from plain tones (no samples, no outside music).

A slow drone that rises with each civilization type, a soft bell at the start of every shot, a low pulse under each speculative type, and
a last chord that stops on the scrape of a chair (a short noise burst) at 1:27. It exists so the walkthrough has real audio to import and
analyse. Replace it with the real score.

    python scripts/make_civilization_score.py out.wav
"""
import math
import random
import struct
import sys
import wave

SR = 44100
DUR = 90
STARTS = [0, 8, 18, 28, 38, 43, 53, 63, 73, 83]       # the shots of the script


def main(path: str) -> None:
    random.seed(7)
    n = SR * DUR
    buf = [0.0] * n
    # drone: three sines whose pitch steps up a little with each type, with a slow swell
    for i in range(n):
        t = i / SR
        shot = max(k for k, s in enumerate(STARTS) if t >= s)
        base = 55.0 * (1.0 + 0.06 * shot)
        swell = 0.55 + 0.45 * math.sin(2 * math.pi * t / 12.0)
        v = (math.sin(2 * math.pi * base * t) + 0.6 * math.sin(2 * math.pi * base * 1.5 * t) + 0.35 * math.sin(2 * math.pi * base * 2.0 * t)) * 0.12 * swell
        buf[i] += v
    # a bell at the start of every shot
    for k, s in enumerate(STARTS):
        f = 440.0 * (1.0 + 0.0595 * k)
        for j in range(int(SR * 4)):
            i = s * SR + j
            if i >= n:
                break
            t = j / SR
            buf[i] += (math.sin(2 * math.pi * f * t) + 0.4 * math.sin(2 * math.pi * f * 2.76 * t)) * 0.16 * math.exp(-t * 1.3)
    # a low pulse every second under the speculative types (43 s to 83 s)
    for beat in range(43, 83):
        for j in range(int(SR * 0.5)):
            i = beat * SR + j
            t = j / SR
            buf[i] += math.sin(2 * math.pi * 48.0 * t) * 0.22 * math.exp(-t * 7.0)
    # the scrape of a chair at 1:27 and then silence
    for j in range(int(SR * 0.6)):
        i = 87 * SR + j
        buf[i] += (random.random() * 2 - 1) * 0.25 * math.exp(-j / SR * 5.0) * (1.0 - j / (SR * 0.6))
    # fade out over the last second
    for j in range(SR):
        buf[n - 1 - j] *= j / SR
    peak = max(abs(x) for x in buf) or 1.0
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x / peak * 0.85)) * 32767)) for x in buf))
    print("wrote", path)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "civilization-score.wav")
