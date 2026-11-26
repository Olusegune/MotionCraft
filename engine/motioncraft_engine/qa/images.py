"""Tiny, dependency-free image readers for QA: PNG and JPEG sizes, and a PNG decoder good enough to measure luminance.

Only what the checks need. Anything else returns None and the check says Not checked.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

MAX_PIXELS = 50_000_000


def size_of(path: Path) -> tuple[int, int] | None:
    """(width, height) of a PNG, JPEG or WebP file from its header, or None."""
    try:
        with open(path, "rb") as f:
            head = f.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR":
                return struct.unpack(">II", head[16:24])
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                if head[12:16] == b"VP8X":
                    return (int.from_bytes(head[24:27], "little") + 1, int.from_bytes(head[27:30], "little") + 1)
                return None
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    b = f.read(1)
                    while b and b != b"\xff":
                        b = f.read(1)
                    m = f.read(1)
                    while m == b"\xff":
                        m = f.read(1)
                    if not m:
                        return None
                    if m[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        seg = f.read(7)
                        h, w = struct.unpack(">HH", seg[3:7])
                        return (w, h)
                    if m[0] in (0xD8, 0x01) or 0xD0 <= m[0] <= 0xD7:
                        continue
                    ln = struct.unpack(">H", f.read(2))[0]
                    f.seek(ln - 2, 1)
    except (OSError, struct.error, IndexError):
        return None
    return None


def png_luminance(data: bytes) -> tuple[int, int, list[float]] | None:
    """Decode an 8-bit, non-interlaced RGB or RGBA PNG to (width, height, relative luminance 0..1 per pixel, row by row). None otherwise."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, idat, ihdr = 8, [], None
    while pos + 8 <= len(data):
        ln, typ = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat.append(body)
        elif typ == b"IEND":
            break
        pos += 12 + ln
    if not ihdr:
        return None
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or ctype not in (2, 6) or interlace != 0 or w * h > MAX_PIXELS or w < 1 or h < 1:
        return None
    bpp = 3 if ctype == 2 else 4
    try:
        raw = zlib.decompress(b"".join(idat))
    except zlib.error:
        return None
    stride = w * bpp
    if len(raw) < (stride + 1) * h:
        return None
    prev = bytearray(stride)
    lum: list[float] = []
    lut = [((c / 255) / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4) for c in range(256)]
    for y in range(h):
        row = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        f = raw[y * (stride + 1)]
        if f == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            return None
        prev = row
        for x in range(0, stride, bpp):
            lum.append(0.2126 * lut[row[x]] + 0.7152 * lut[row[x + 1]] + 0.0722 * lut[row[x + 2]])
    return w, h, lum


def contrast_ratio(l1: float, l2: float) -> float:
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
