"""The pinned EffectCraft. The commit lives in engine/effectcraft.lock; `effectcraft-cli --version` reports only the version
number (checked in P0-01), so the adapter compares versions and the real-engine contract tests guard the rest."""
from pathlib import Path

PINNED_VERSION = "0.24.1"
PINNED_COMMIT = (Path(__file__).resolve().parents[2] / "effectcraft.lock").read_text(encoding="utf-8").split()[0]
