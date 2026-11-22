# ADR-0001: EffectCraft is the editor and renderer; `.ecproj` is the source of truth

Status: accepted, conditional on Phase 0 GO · Date: 2026-11-22

## Context
An earlier draft rebuilt a timeline, layer stack and properties panel inside MotionCraft. EffectCraft
(storytold/effectcraft, MIT/Apache-2.0, Rust) already has them, plus CLI, JSON control channel and MCP access to every
engine command, and a readable JSON project format. It is alpha (~45% "ready for real work", 2026-11-15).

## Decision
MotionCraft does not build a compositor UI. All composition data lives in the `.ecproj`. MotionCraft stores only
intent, bindings (keyed by EffectCraft layer id), approvals, provenance, QA and history. Hand-editing happens in the
EffectCraft GUI. One EffectCraft commit is pinned; upgrades need the adapter contract tests to pass.

## Consequences
- No sync problem between two layer trees.
- MotionCraft depends on an alpha engine → Phase 0 gate and a fallback (code-defined 2D renderer behind the same
  adapter, v1 cut to 2D typography).
- Layer ids must be stable across saves (Phase 0 criterion 2).
