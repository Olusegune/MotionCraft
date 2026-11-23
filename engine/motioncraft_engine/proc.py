"""Child processes started by the engine helper must never open a console window.

The helper is a windowed program on Windows (no console of its own), so a console program it starts would be given a new console,
and with Windows Terminal as the default terminal that shows up as a terminal window flashing on screen. Pass these to every
`subprocess` call.
"""
from __future__ import annotations

import os

NO_WINDOW: dict = {"creationflags": 0x08000000} if os.name == "nt" else {}   # CREATE_NO_WINDOW
