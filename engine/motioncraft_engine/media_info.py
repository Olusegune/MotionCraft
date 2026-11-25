"""Picture size of a video file, read from its header with no outside tool (ffprobe is not bundled with MotionCraft).

MP4 and MOV: the width and height in the first video track's `tkhd` box, turned the right way up by the rotation matrix (phone
videos are stored sideways). WebM: the PixelWidth and PixelHeight elements of the first video track. Anything else, or a file
that cannot be understood, gives None and the caller keeps the clip at its own size.
"""
from __future__ import annotations

import struct
from pathlib import Path

_MAX_SCAN = 8 * 1024 * 1024      # the header (moov) is normally at the start or end; scan at most this much of each


def _read_edges(path: Path) -> bytes:
    size = path.stat().st_size
    with path.open("rb") as f:
        head = f.read(_MAX_SCAN)
        if size <= _MAX_SCAN:
            return head
        f.seek(max(size - _MAX_SCAN, _MAX_SCAN))
        return head + f.read(_MAX_SCAN)


def _mp4_size(data: bytes) -> tuple[int, int] | None:
    pos = 0
    while True:
        i = data.find(b"tkhd", pos)
        if i < 0:
            return None
        pos = i + 4
        v = data[i + 4]
        # after the 4 name bytes: version(1) flags(3), then 20 (v0) or 32 (v1) bytes up to the 52-byte block of
        # reserved(8) layer(2) alt(2) volume(2) reserved(2) matrix(36); width and height are 16.16 fixed after it
        base = i + 8 + (20 if v == 0 else 32)
        m = base + 8 + 8
        if m + 36 + 8 > len(data):
            continue
        a, b, _u, c, d, _u2, _x, _y, _w = struct.unpack(">iiiiiiiii", data[m:m + 36])
        w, h = struct.unpack(">II", data[m + 36:m + 44])
        w, h = w >> 16, h >> 16
        if w <= 0 or h <= 0 or w > 32768 or h > 32768:
            continue                                   # an audio track has no picture size; look at the next track
        if a == 0 and d == 0 and b != 0 and c != 0:    # turned a quarter: the picture is stored sideways
            w, h = h, w
        return w, h


def _webm_size(data: bytes) -> tuple[int, int] | None:
    i = data.find(b"\xb0")
    # PixelWidth (0xB0) and PixelHeight (0xBA), each a 1 to 2 byte unsigned integer, close together inside the video track
    for n in range(len(data) - 12):
        if data[n] != 0xB0:
            continue
        ln = data[n + 1]
        if ln not in (0x81, 0x82):
            continue
        k = ln & 0x0F
        w = int.from_bytes(data[n + 2:n + 2 + k], "big")
        j = n + 2 + k
        if data[j] != 0xBA or data[j + 1] not in (0x81, 0x82):
            continue
        kh = data[j + 1] & 0x0F
        h = int.from_bytes(data[j + 2:j + 2 + kh], "big")
        if 16 <= w <= 32768 and 16 <= h <= 32768:
            return w, h
    return None


def video_size(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as f:
            magic = f.read(12)
        data = _read_edges(path)
    except OSError:
        return None
    try:
        if magic[4:8] == b"ftyp" or b"moov" in data[:64]:
            return _mp4_size(data)
        if magic[:4] == b"\x1aE\xdf\xa3":
            return _webm_size(data)
    except (IndexError, struct.error):
        return None
    return None
