# ADR-0007: A director's timeline, not a timeline editor

Status: **accepted** (Victor, 2026-11-23: "LOVE YOUR PLAN GO FOR IT"; read as approval of the recommended answers in TIMELINE_PLAN.md: read-only T1 and T2 first, move and trim of unlocked layers (T3) only after a spike, docked on Build, a simpler look than FilmCrafter is fine) · Date: 2026-11-23

## Context
`UI_UX.md` says MotionCraft has no timeline (principle, and acceptance criterion 17), because detailed editing belongs to
EffectCraft (ADR-0001) and the `.ecproj` is the only store of composition data (AGENTS.md hard rule 1). Victor asked for a visual
screen and timeline "like FilmCrafter". FilmCrafter3 and Pulseframe have full timelines, but they edit a store those apps own;
MotionCraft does not own the composition. Evidence and the full plan: [TIMELINE_PLAN.md](../TIMELINE_PLAN.md).

## Decision
Add a **director's timeline**: it shows the whole piece (audio sections and beats, the intent arc, layers as bars, markers, QA
findings, saved versions) and edits only what MotionCraft owns (the intent arc), plus, in a later step and only after a spike,
moving and trimming **unlocked** layers through the adapter as a person. Keyframes, effects, properties and the graph editor
stay in EffectCraft, one click away at the chosen time.

This replaces the "no timeline" principle and criterion 17 with "no timeline *editor*": no keyframe editor, property panel or
graph editor. It does not change ADR-0001 or any hard rule: the composition still lives only in the `.ecproj`, every write goes
through the adapter, approved layers stay untouchable by agents, and nothing here edits an approved layer.

## Consequences
- `UI_UX.md` (principle line, criterion 17) and `ACCEPTANCE.md` need amending when this is accepted.
- Reusable pure code from Pulseframe (`laneMath.ts`) comes in with a `PORT_LEDGER.md` entry.
- If rejected, the player with markers and the waveform stay as they are.
- Not decided here: keyframe editing (no), a second editor (no, see ADR-0006), placement (recommended: a dock on Build, read-only on Review).
