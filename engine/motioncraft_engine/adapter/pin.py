"""The pinned EffectCraft. `engine/effectcraft.lock` is the source of truth; a test checks this constant against it, so the
adapter does not need the file at run time (the frozen helper has no checkout). `effectcraft-cli --version` reports only the
version number (P0-01), so the adapter compares versions and the real-engine contract tests guard the rest."""

PINNED_VERSION = "0.24.1"
PINNED_COMMIT = "7e2d0256209974ffb92a29d8bdb6f2a49078f51f"
