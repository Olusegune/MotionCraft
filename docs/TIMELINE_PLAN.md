# Timeline for MotionCraft: plan

Status: **proposed**, waiting for Victor's decision on [ADR-0007](adr/0007-director-timeline.md) · Date: 2026-11-23 · Nothing here is built.

Victor asked whether MotionCraft will have "a visual screen and timeline", and which way to build it: the FilmCrafter way, the
Pulseframe way, or something else. This is the evidence, the recommendation, and the work.

## 1. What each app does, from their code

| | FilmCrafter3 0.57.0 | Pulseframe 1.61.2 | MotionCraft 0.1.5 |
| --- | --- | --- | --- |
| Screen | `Studio.tsx` (1384 lines): player, timeline, dock | `Studio.tsx` (1500 lines), the same lineage | `Player` with markers and a waveform; no timeline |
| Timeline | Scrolling DOM timeline, zoom in pixels a second (6 to 400, Ctrl+wheel around the pointer), waveform on a canvas, shot cards, a cut lane with trim handles, sound cue lanes | The same, plus **layers as lanes** (`LayerLanes.tsx`, `laneMath.ts`): drag to move, drag an edge to trim, snap to beats, arrow keys nudge | Documented as **not wanted** (`UI_UX.md`: principle, and acceptance criterion 17) |
| Who owns the film's data | The app: shots, cut and overlays live in its own store and it has its own renderer | The same | **EffectCraft's `.ecproj`**; MotionCraft keeps intent, approvals, provenance and history only (ADR-0001, AGENTS.md hard rule 1) |
| Editing happens | In the app's timeline, written straight to its own data | The same | In EffectCraft; MotionCraft writes only through the adapter, never to an approved layer |

So: **yes, FilmCrafter and Pulseframe have a visual screen and a timeline. MotionCraft today does not, on purpose.**

## 2. Why MotionCraft cannot copy either wholesale

Their timeline works because it edits a store the app owns. Copying it would mean MotionCraft writing layer timing and keyframes
into its own data, a second source of truth, which breaks hard rule 1. It would also rebuild what EffectCraft already does, and
reverse a written product decision. What *is* worth taking from them is the parts that do not depend on who owns the data:

- **`laneMath.ts`** (110 lines, pure, tested): lane packing so layers that overlap sit in different lanes, drag and trim arithmetic with snapping (7 px, Alt turns it off), restacking.
- **Zoom and scroll behaviour**: pixels a second, Ctrl+wheel around the pointer, plain wheel scrolls sideways.
- **`timelineView.ts`**: per-project layout (zoom, height, compact) remembered, every read checked and clamped.
- **The lane bar's accessibility**: focusable bars, labelled with name and times, arrow keys nudge.

Not taken: their data model, the 1400-line Studio, their renderer, their keyframe editor.

## 3. The three ways

| | A. The FilmCrafter or Pulseframe way | **B. A director's timeline (recommended)** | C. No timeline |
| --- | --- | --- | --- |
| What it is | A full editor in the app: move and trim anything, edit keyframes | A timeline that shows the whole piece and edits what MotionCraft owns; detailed edits open EffectCraft at that time | Keep today's player and lists |
| Fits the rules | **No.** Needs a second copy of the composition, or full keyframe writing; clashes with ADR-0001 and criterion 17 | **Yes.** Reads the composition; writes intent in MotionCraft's own data; layer moves only through the adapter, as a person, never on an approved layer | Yes |
| What you get | Familiar to FilmCrafter users | See audio sections and beats against the layers, the intent arc, QA findings and versions in one place; move or trim unlocked layers | Less |
| Cost | Largest by far; duplicates EffectCraft | Medium, in stages (section 5) | None |
| Main risk | Becomes a compositor | Scope creep toward A | Users compare it with FilmCrafter and miss the picture over time |

## 4. Design of B

One timeline under the player on Build, and a **read-only** copy on Review. Lanes, top to bottom:

1. **Ruler and playhead**, synced with the player; click to seek.
2. **Audio**: waveform, beats, downbeats, and the sections from P3-01 (INTRO, VERSE, CHORUS, with groups and energy).
3. **Intent arc**: the beats from the Intent card as bars; their boundaries can be dragged. This is MotionCraft's own data.
4. **Layers**: one bar per layer from its in and out points, packed into lanes by `laneMath`. Badges: approved (lock), changed in EffectCraft (drift), made by Builder, QA or you. Keyframes shown as dots, read-only.
5. **Markers**: beat markers, section markers, your notes.
6. **QA**: a pin at the time of each finding, opening the finding.
7. **Versions**: a tick for each revision that has a saved version, opening Compare.

Selecting a layer shows what it is and offers **Open in EffectCraft at this time**. Keyframes, effects, properties and the graph stay in
EffectCraft.

## 5. Work, in order

Prerequisite: **P3-01** (audio sections), which fills the Audio lane. Sizes are relative: S is a day, M a few days, L about a week.

| # | Ticket | Size | Done when |
| --- | --- | --- | --- |
| T0 | Decide ADR-0007; amend `UI_UX.md` (principle line, criterion 17) | S | Victor's yes recorded |
| T1 | Read-only timeline: `timeline_read` in the engine (layers with in, out, key times, lock and role in one call), `timelineMath.ts` ported from `laneMath.ts` with a ledger entry, zoom, seek, lanes 1, 2, 4, 5 | M | Opens on a real project; matches EffectCraft's own in and out for every layer (tested on the real engine); keyboard and screen-reader tests |
| T2 | Intent lane, QA pins, version ticks | S | Dragging a beat boundary re-runs the rules and revalidates Gate A; pins and ticks open their sheets |
| T3 | Move and trim **unlocked** layers: `layer_timing` through `layer.timing` as the person; one revision with a saved version before and after, so it is undoable | M | Refused on an approved layer ("Unlock first") and while an EffectCraft window has the project open; a real-engine test of the numbers and of the hash change; drift not logged for our own write |
| T4 | Snap to beats, sections and markers; compact mode; per-project layout remembered | S | Snapping matches the beat grid within a frame |
| T5 | Optional later: add a layer at the playhead | S | Same path as the Add panel |

Not planned: keyframe or graph editing, effects, a property panel, compositing. Those open EffectCraft.

## 6. What is not known yet (to be measured before T3)

- `layer.timing` exists at the pin and takes `start`, `in`, `out`, `inDelta` and `outDelta`, but its exact meaning (for example whether `out` is exclusive, and what happens to keyframes when a layer is moved) has **not been measured**. T3 starts with a spike like the render-part spike.
- Reading in and out is possible today (`layer.tree` reports `in`, `out`, `start`); the cost of reading 50 or more layers has not been measured.
- It is not known whether Victor wants the timeline on the Review page read-only or at all.

## 7. Decisions needed from Victor

1. **Reverse the "no timeline" decision?** (ADR-0007.) Recommended: yes, as B only.
2. **Allow moving and trimming unlocked layers (T3)**, or keep the timeline read-only plus intent edits (T1 and T2)? Recommended: T1 and T2 first, T3 after the spike.
3. **Placement**: a dock under the player on Build (recommended), or its own stage?
4. **FilmCrafter parity**: is looking like FilmCrafter's timeline important, or is a simpler director's view acceptable?

## 8. Risks

- **Scope creep** toward a compositor. Guard: the non-goals above, and every layer write goes through the adapter as one revision.
- **Two ways to edit one thing** (timeline and EffectCraft). Guard: MotionCraft is read-only while an EffectCraft window is open (already true), and drift is logged, never overwritten.
- **Performance** with many layers. Guard: one read call, measured in T1.
- **Approvals**: moving a layer changes its hash. Guard: only unlocked layers move, so no approval is invalidated by this path.
