# ADR-0003: The engine adapter lives in the Python engine, next to the agents

Status: proposed · Date: 2026-11-22

## Context
The PRD writes types in TypeScript, but the agents (Director, Builder, QA), the router and audio analysis follow
FilmCrafter3's pattern and run in the Python engine. The lock check must run before any agent command reaches
EffectCraft.

## Decision
The adapter (`engine/motioncraft_engine/adapter/`) is Python and owns the `effectcraft-cli mcp` child process. The UI
reaches the engine only through Rust → Python commands. JSON Schemas in `schemas/` are the contract; TS and Python
types are generated from them.

## Consequences
- Locks are enforced in the same process as the callers; no path around them.
- The UI never needs MCP; fewer moving parts in the Rust shell.
- If later the Rust shell must call EffectCraft directly (e.g. for a fast scrub preview), it goes through an engine
  command, not a second adapter.
