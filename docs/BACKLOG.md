# v1 backlog

One ticket = one branch = one PR (`p1-03-intent-card`). Each PR names its ticket and the acceptance tests (AT-n,
[ACCEPTANCE.md](ACCEPTANCE.md)) it moves. The agent layer is built inside each phase, not at the end: every feature is
exercised through the UI and through an agent.

Phase 0 tickets: [PHASE0_SPIKE.md](PHASE0_SPIKE.md). **Nothing below starts until the Phase 0 report says GO** (or
the fallback is chosen, in which case the adapter target changes but these tickets mostly stand).

## Phase 1 — Foundation

| Id | Ticket | Done when |
| --- | --- | --- |
| P1-01 | Scaffold from FilmCrafter3 (Tauri 2, React 19, Vite, Vitest, Playwright, Python sidecar), rename to MotionCraft, CI with lint/type/test | `npm run tauri dev` opens an empty shell; CI green; PORT_LEDGER entries |
| P1-02 | Shell per [UI_UX.md](UI_UX.md): `tokens.css`, bundled fonts, Lucide, header, bottom stage bar with four gate diamonds, optional rail, collapsible inspector with pinned main action, story strip; Projects home and seven empty stage pages; `Sheet`, command palette and UI scale ported | Pages reachable by stage bar and palette; gate diamonds focusable with text status; contrast and a11y checks pass |
| P1-03 | Schemas + generated types; project store with atomic writes, migrations, `.motioncraft` package create/open | Create → close → reopen round trip test |
| P1-04 | Port keychain + `confirm_spend` token + spend-gate test list | No paid path without token (test) |
| P1-05 | Router: port `llm.py`/`localmodels.py`; add Inkling endpoint; capability declarations; offline mode | Manual mode works with no provider (AT-16 partial) |
| P1-06 | Autosave every 30 s + on gates; crash-recovery prompt on next launch | Kill app → ≤ 30 s lost |
| P1-07 | Brief screen: text, script, audio, references, brand PDF, storyboard images → assets with provenance | Inputs stored, relative paths |
| P1-08 | Intent card: Director agent drafts purpose/tone/arc; anchors file; editable; Gate A | AT-5 |
| P1-09 | Rule table: `rules_default.yaml`, evaluator, "which rules fired", user-editable | AT-6 |
| P1-10 | Control modes per stage, defaults, switch to Manual keeps work | Mode change test |
| P1-11 | Adapter wired into app; "Open in EffectCraft" with bridge attach/detach | Edit in GUI visible in Build |
| P1-12 | Stage mode control per stage (`controlModes`, defaults and no-provider behaviour, UI_UX §4.3) | UI criteria 12, 13 |
| P1-13 | State library: engine unavailable, operation failed, offline, no provider, crash recovery, revision impact sheet | UI criteria 6, 14 |

## Phase 2 — Typography and primitives

| Id | Ticket | Done when |
| --- | --- | --- |
| P2-01 | Primitive format, loader, validator, recipe substitution | Invalid primitive rejected with reason |
| P2-02 | First 40 primitives: easing sets, text animators, layout templates (safe-area grids per aspect) | Each has thumbnail + reference render |
| P2-03 | Remaining primitives to launch size (target ~100, see OPEN_QUESTIONS) incl. transitions, 2.5D camera, beat drivers | Regression renders stored |
| P2-04 | 12 style families as YAML with tags, conflict rules, sourced notes | Conflict warning test |
| P2-05 | Direction screen: 2–3 proposals with stills, per-dimension controls; Gate B | Pick stored in StyleProfile |
| P2-06 | Reference translation → original style profile with attribution | AT-7 |
| P2-07 | Treatment screen: beats over waveform, storyboard frames; Gate C | Timing map stored |
| P2-08 | Builder agent: plan → show layers/models/cost → `execute` via primitives; layerMap + provenance | AT-1, AT-2 |
| P2-09 | Lock flow: approve layer → hash + native lock; adapter refusal | AT-8, AT-10 |
| P2-10 | Preview loop + timing instrumentation | **Gate: ≤ 60 s first preview, ≤ 10 s edit preview** on target hardware |
| P2-11 | Save approved layer animation as a user primitive | Reused in another project |
| P2-12 | Build panels per UI_UX §6.1: Layers (lock, provenance, drift), Text, Camera, Primitives, Audio | UI criteria 16, 17 |

## Phase 3 — Audio sync

| Id | Ticket | Done when |
| --- | --- | --- |
| P3-01 | Extract Pulseframe `analyze.py` into shared package (or vendor with ledger); add silence, transients, narration word timing | Same SongMap as Pulseframe on its test song |
| P3-02 | SongMap → EffectCraft comp markers (`comp.addMarker`), re-sync after hand edits | Markers visible in GUI |
| P3-03 | Sync modes + restraint slider driving beat-driver primitives | AT-3 (±1 frame) |
| P3-04 | Lyric video path: lyrics + word timing → lyric-line primitive | AT-4 |
| P3-05 | Sound interface: ElevenLabs official API (voice, music, SFX) with spend token; import for Suno/VoiceKiller/any file with licence note | AT-18 |

## Phase 4 — QA and review

| Id | Ticket | Done when |
| --- | --- | --- |
| P4-01 | QA framework: finding model, evidence capture (frame grabs, measured vs threshold) | Finding schema test |
| P4-02 | Tier 1 checks: assets, fonts + licence, fps, aspect, low-res, safe-title, collisions, contrast, audio drift, beat misalignment, alpha, colour space, unsupported effects, orphans | One test per check; AT-11, AT-12 |
| P4-03 | Enhance interface: Topaz Video AI CLI (local) + Topaz API; raster-only guard; generative off by default; as low-res fix | AT-19 |
| P4-04 | One-click safe fixes → revision, never on locked layers | Test |
| P4-05 | Review screen: player, frame-accurate comments, QA list, version compare and restore as a new revision (needs P0-15) | e2e |
| P4-06 | Drift detection on open / GUI save / refocus | AT-9 |

## Phase 5 — Delivery

| Id | Ticket | Done when |
| --- | --- | --- |
| P5-01 | Deliver screen: presets (ProRes 4444 alpha, H.264, per aspect); Gate D sheet with cost | AT-14 |
| P5-02 | Render queue with resume from last good frame | AT-13 |
| P5-03 | Package export/import, font manifest, relink | AT-15, AT-11 |
| P5-04 | MCP server for MotionCraft itself: import/export package tools (hub contract) | Contract doc + test |
| P5-05 | Offline end-to-end run | AT-17 |
| P5-06 | Golden briefs (10) + reviewer sheets; release checklist | **Gate: all 19 AT pass, rubric median ≥ 4, none < 3** |

## Phase 6 — Other editors: After Effects and DaVinci Resolve (Fusion)

Proposed by Victor on 2026-11-23; plan and evidence in [INTEROP_PLAN.md](INTEROP_PLAN.md), decision pending in
[ADR-0006](adr/0006-other-editors-as-hand-off-targets.md). These are hand-off targets: EffectCraft stays the engine of record.

| Id | Ticket | Done when |
| --- | --- | --- |
| P6-01 | Spike: After Effects round trip with `file.exportAep` and `file.importAep`, opened in After Effects 2025 (and 2026 if available) | Table with pictures and a list of gaps |
| P6-02 | Open in After Effects: dry-run report sheet, allow-losses confirmation, export to `handoff/`, launch | A person opens a project in After Effects from MotionCraft |
| P6-03 | Bring back from After Effects: import as a new composition, revision, bindings re-made, approvals revoked with a note | Round-trip test |
| P6-04 | Hand off to DaVinci Resolve: confirmed render, audio, FCPXML or EDL timeline (port of FilmCrafter3 `editor_export.py`) | Timeline opens in Resolve with media linked |
| P6-05 | Spike: Fusion (Studio versus free, ProRes 4444 alpha clips, title macro generation) | Decision note with evidence |
| P6-06 | Detect After Effects and Resolve in Settings (known folders, Browse, versions) | Same behaviour and tests as EffectCraft detection |
| P6-07 | Editor-neutral QA on the hand-off package (fonts, frame rate, colour space, alpha) | Findings with evidence |
| P6-08 | Later: live bridges (ExtendScript or `aerender`; Resolve Python API, Studio only), behind their own ADR | Separate ADR first |
