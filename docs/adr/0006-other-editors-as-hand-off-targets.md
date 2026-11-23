# ADR-0006: After Effects and DaVinci Resolve (Fusion) as hand-off targets

Status: **proposed**, waiting for Victor's decision · Date: 2026-11-23

## Context
Victor asked for the option to work in Adobe After Effects and in DaVinci Resolve's motion graphics tool (Fusion) as well as
EffectCraft. ADR-0001 makes EffectCraft the editor and the `.ecproj` the only store of composition data. EffectCraft ships an
After Effects project exporter and importer; Resolve and Fusion can be fed rendered media and timelines, and can only be
scripted from outside in the paid Studio edition. Evidence and unknowns: [INTEROP_PLAN.md](../INTEROP_PLAN.md).

## Decision (proposed)
Treat After Effects and Resolve/Fusion as **hand-off targets**: MotionCraft sends work out (`.aep`, or rendered media with a
timeline) and brings back what can be brought back (`.aep` import). EffectCraft remains the engine of record; this ADR does not
change ADR-0001 or any hard rule in `AGENTS.md`.

## Not decided here
Using After Effects or Fusion as a full alternative engine (composition stored in an `.aep` or a Fusion comp). That would
supersede ADR-0001 and needs its own ADR, adapter contract and lock policy.

## Consequences
Locks and approvals are not enforceable in the other editor, so hand-off marks layers as handed off and a returning `.aep` is a
new revision. Fonts must be installed in the other editor. Work starts with a spike (P6-01) to learn what survives an
After Effects round trip before any UI is built.
