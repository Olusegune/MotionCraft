# MotionCraft v1 PRD

Repository copy of the MotionCraft v1 PRD artifact, 2026-11-22. Owner: Victor Edun. Discrepancies found while
checking the repos are listed at the end, not edited into the text.

## Summary

MotionCraft v1 is the director layer for motion design. It turns a brief, script or music track into an editable
EffectCraft project, shows its creative reasoning, and requires approval for anything expensive or final.
Hand-editing happens in EffectCraft; MotionCraft owns intent, style, approvals, provenance, QA and review.

The product stays genre-neutral and style-agnostic. v1 ships one wedge well — typography-led, music-synced 2D/2.5D
motion — instead of every motion-design genre at once. MotionCraft is an internal codename only.

## v1 scope

| Tier | Use cases |
| --- | --- |
| v1 | Kinetic typography; title and credit sequences; logo animation; lyric videos; music-driven 2D/2.5D sequences; social-media motion; simple 2D explainers |
| v1.x | Documentary and broadcast packages; lower thirds; data-visualization templates; Lottie export |
| Later | 3D product animation; scientific and architectural visualization; projection mapping; cel and frame-by-frame animation; game and interactive graphics |

**v1 inputs:** brief text, script, music or narration audio, reference images and mood boards, brand documents
(PDF). Storyboards and shot lists are accepted as images.

**Out of scope for v1:** a custom compositor UI; generative video as the primary output; multi-user collaboration;
live ProducerOne or Greenroom integration (contracts only).

## Architecture

MotionCraft is the director and review layer; EffectCraft is the editor and renderer. The `.ecproj` file is the
only place composition data lives.

- Agents send engine commands through the adapter. The adapter refuses commands on locked layers and reports layer
  hashes back, so manual edits are detected.
- The user hand-edits in EffectCraft's own GUI. MotionCraft reads the result and never mirrors the layer tree.
- Adapter interface: create, open, inspect, execute, preview and final render, export, subscribe, plus
  `lockLayers` and `hashLayers`. A mock adapter runs every test without EffectCraft installed.
- Required repositories: FilmCrafter3 (shell, workflow, approvals, autosave), Pulseframe (audio analysis, as a
  shared package), EffectCraft (engine).

Detail: [ARCHITECTURE.md](ARCHITECTURE.md), [ENGINE_ADAPTER.md](ENGINE_ADAPTER.md).

## Phase 0: EffectCraft go/no-go

v1 commits to EffectCraft only after a two-week spike passes criteria 1–5. The engine is alpha: first commit
1 October 2026; its authors estimate ~45% of the way to professional production readiness.

| # | Criterion | Pass condition |
| --- | --- | --- |
| 1 | Headless build: comp, native text, shape, keyframes, camera through CLI or MCP | All succeed from a script, no GUI |
| 2 | Round trip: save `.ecproj`, reopen, inspect | Layer IDs unchanged after 20 round trips |
| 3 | Preview render of a 10 s 1080p comp | Meets the preview target |
| 4 | Final render: ProRes 4444 with alpha, and H.264 | Correct alpha, frame-accurate |
| 5 | Agent edits while the GUI is open (control channel or MCP bridge) | Edit appears in the GUI, no corruption |
| 6 | Text: variable fonts, right-to-left, per-character animation | Renders correctly |
| 7 | Pinned version builds on each launch platform | Reproducible build |
| 8 | Lottie export of a typography comp | Exports, with unsupported features listed |

**Decision rule:** 1–5 must all pass. Failures on 6–8 become tracked risks, not blockers.
**Version policy:** pin one EffectCraft commit; upgrade only when the adapter's contract tests pass on the new one.
**Fallback:** keep the adapter and evaluate a code-defined 2D renderer behind it, with v1 cut to 2D typography.
Re-test EffectCraft each quarter.

Plan: [PHASE0_SPIKE.md](PHASE0_SPIKE.md).

## Project model

MotionCraft stores intent, decisions and history; EffectCraft stores the composition. Neither duplicates the other.
Types: [PROJECT_SCHEMA.md](PROJECT_SCHEMA.md).

- **Approval lock:** the adapter refuses any agent command that touches a locked layer. Unlocking is a user action
  and creates a new revision.
- **Drift detection:** on open, compare layer hashes. Manual EffectCraft edits are logged as user revisions.
- **Provider assets:** generated or imported voice, music and SFX are assets with provenance and a licence note.
- **Portable package:** a `.motioncraft` folder with `project.json`, the `.ecproj`, assets and a font manifest,
  relative paths only.

## Creative intent

The agent's reading of the brief appears as an editable **Intent card** before any design work, driving a visible
rule table. Three layers:

- **Purpose** — inform, teach, persuade, sell, announce, celebrate, entertain, memorialize.
- **Tone** — authoritative, trustworthy, playful, elegant, instructional, provocative, restrained.
- **Emotion and arc** — per beat: primary and secondary emotion, intensity 1–5, energy 1–5.

Every scale point has a written anchor (energy 1 = near-still, 5 = frantic). No unanchored 0–1 dials.

**Intent-to-parameter rules** (starting defaults; the full table is a v1 deliverable, user-editable, tuned against
golden briefs):

| Signal | Timing | Easing | Typography | Layout | Transitions |
| --- | --- | --- | --- | --- | --- |
| Calm, energy 1–2 | Long holds, few cuts | Long ease-out, no overshoot | Lighter weights, open tracking | Generous negative space | Dissolves, slow push |
| Urgent, energy 4–5 | Short holds | Sharp ease-in, overshoot allowed | Heavy weights, tight leading | Dense, high contrast | Hard cuts, whips |
| Elegant | Measured, even rhythm | Smooth S-curves, no bounce | Refined serif or light sans | Asymmetric grid | Mask reveals |
| Playful | Varied, syncopated | Bounce, squash and stretch | Rounded or variable weight | Loose, overlapping | Pops, scale-ins |

The card shows a plain-language summary, the arc, and which rules fired. Editing it re-runs the treatment, never
approved layers.

## Style system

Styles are assigned **per dimension** (typography, motion, color, texture, camera, transitions, composition), each at
subtle / moderate / strong — not blended by percentage. Example: Typography = Swiss modernist (strong); Motion =
restrained editorial (strong); Camera = cinematic 2.5D push (moderate); Texture = handmade print (subtle).

- **Conflicts:** families carry tags (grid-strict, organic, high-density…); conflicting pairs raise a visible,
  overridable warning with the reason.
- **v1 library:** ~12 fully specified families: Swiss/International, editorial minimal, Bauhaus/constructivist,
  brutalist, bold kinetic type, cinematic title, clean broadcast, cut-paper/handmade, risograph/print,
  retro-futurist, neon/light, collage. Regional and cultural visual languages are added as families with sourced
  notes. No family is the default identity.
- **References:** a designer, studio, title sequence or mood board becomes an original style profile (typography
  behaviour, composition, pacing, camera, transitions, colour, texture, space, depth, density) with attribution
  notes, never an instruction to copy a living designer's signature work.
- **Fonts:** profiles name fonts; QA checks each font's licence allows video use.

## Motion primitive library

Agents assemble tested building blocks instead of writing keyframes from scratch. This is the main design investment
of v1.

| Category | v1 contents |
| --- | --- |
| Easing sets | Named curve families mapped to intent: calm, crisp, elastic, editorial |
| Text animators | Per-character, word and line reveals; tracking expand; mask wipes; type-on; scramble |
| Transitions | Cut, dissolve, mask wipe, push, match-scale, light leak |
| Layout templates | Title card, lower third, end card, lyric line, quote card; safe-area grids per aspect ratio |
| 2.5D camera moves | Push, drift, parallax rack |
| Beat drivers | Scale pulse, opacity flash, position hit, tied to audio markers |

Each primitive: ID, version, parameters with ranges, intent and style tags, EffectCraft command recipe, thumbnail,
reference test render. Users can save any approved layer's animation as a new primitive. Open: launch size (~100?).

## Agents and workflow

| Agent | Owns | Absorbs |
| --- | --- | --- |
| Director | Brief analysis, Intent card, reference translation, style proposals, treatment, timing map | Brief analyst, creative director, reference analyst, audio planning |
| Builder | Engine commands from primitives: typography, 2D/2.5D layout, audio sync, compositing | Motion designer, typography designer, 2D animator, 3D layout artist, compositor |
| QA | Inspects project and renders, files findings with evidence, proposes fixes | QA supervisor |

Workflow (gates A–D need explicit user approval):

1. Intake: brief, script, references, audio — imported, received from the hub, or generated through a sound
   provider (generation needs cost approval).
2. Intent card — **Gate A**: approve or edit the interpretation.
3. Style proposals: two or three directions with stills — **Gate B**: pick one.
4. Treatment and timing map over the audio — **Gate C**.
5. Builder creates the editable composition.
6. Preview render.
7. QA pass, then revisions; 5–7 repeat.
8. Final render — **Gate D**: cost approval and sign-off. Never automatic.
9. Deliver the package.

Before acting, an agent shows what it understood, its plan, the layers it will create or change, the tools and
models it will call, and the estimated cost. Each project has a cost cap; generation above the approval threshold
waits for the user.

## Control modes

| Mode | Agent does | User does |
| --- | --- | --- |
| Manual | Nothing; tools only | Every decision and edit |
| Assisted | Suggests options and fixes | Applies or rejects each |
| Agent-led | Acts within the approval gates | Approves at gates A–D |

Per stage: intent, style, treatment, sound, build, audio sync, QA fixes. Defaults: Assisted for intent and style,
Agent-led for build. Fully usable with every stage on Manual and no AI provider. Switching to Manual keeps agent work
so far. Keyframe-level editing always happens in EffectCraft. Manual edits are logged as user revisions.

## Audio sync

Reuses Pulseframe's beat, phrase and energy work as a shared package.

- **Analysis:** BPM, beats, downbeats, phrases/sections, energy curve, transients, silence, word timings.
- **Sync modes:** every beat, downbeats only, phrases, energy-driven, narration-led, manual markers.
- **Restraint control:** one slider, sparse to aggressive.
- **Markers live in the engine:** analysis markers are written into the EffectCraft comp.

## Providers

| Interface | Used for | v1 providers | How it connects |
| --- | --- | --- | --- |
| Language model | Director, Builder, QA | Cloud model (default); Ollama and Inkling locally | OpenAI-compatible endpoint |
| Sound | Voice, music, SFX | ElevenLabs; file import from Suno, VoiceKiller or any tool | ElevenLabs official API; the rest by import |
| Enhance | Upscaling raster footage and images | Topaz | Local Video AI CLI first; Topaz REST API as cloud option |

Rules: official APIs only (Suno is import-only until its invite-only developer programme grants access; imported
Suno tracks carry a licence note); VoiceKiller import-only; local models handle brief analysis, drafts and QA
summaries, the Builder defaults to the strongest configured model; Topaz only on raster sources, never on text,
vector or logo layers or the final render, generative models off by default; every call records provider, model,
cost and licence terms; providers declare capabilities so the router can fall back. Longer term, Voice Studio may
become the suite's sound step.

## Interface

FilmCrafter3's product language with its own tokens: a compact header, one bottom stage bar (Brief → Intent →
Direction → Treatment → Build → Review → Deliver) with four approval-gate diamonds, an optional left rail, a
collapsible right inspector and a shallow story strip. Projects is the home screen. Full spec: [UI_UX.md](UI_UX.md).

| Screen | Purpose |
| --- | --- |
| Projects | Create, open, import packages |
| Brief | Intake of text, script, audio, references, brand docs |
| Intent | Intent card and rule table, editable |
| Direction | Style proposals side by side, per-dimension controls, conflict warnings |
| Treatment | Beat-by-beat storyboard frames over the waveform |
| Build | Live engine preview, agent activity log, layer list with role/lock/provenance badges, "Open in EffectCraft" |
| Review | Player with frame-accurate comments, QA findings, version compare |
| Deliver | Render presets, package export |

Workspace presets are panel layouts inside this shell: Director, Audio Sync, Review.

## QA

| Tier | Checks | Ships |
| --- | --- | --- |
| 1 — Deterministic | Missing assets/fonts; font licence; frame rate; aspect ratio; low-res media (fix: Topaz upscale of the raster source); safe-title violations; text collisions; contrast ratio on rendered frames; audio drift; beat misalignment vs markers; alpha errors; colour space; unsupported effects; orphan layers | v1 |
| 2 — Measured | Flicker; excessive motion blur; aliasing; text read time; visual density | v1.x |
| 3 — Judgement | Emotional mismatch; style inconsistency; unclear hierarchy; pacing | Later, advisory |

Every finding: severity, timecode or layer, evidence (frame grab, measured value vs threshold), likely cause,
recommended fix. Safe fixes are one-click; each creates a revision and never touches locked layers.

## Targets and tech stack

| Measure | Target |
| --- | --- |
| Brief approved → first preview of a 15 s comp | ≤ 60 s |
| Small edit → updated preview | ≤ 10 s |
| Work lost in a crash | ≤ 30 s (autosave interval) |
| Package opened on another machine | Opens; missing fonts flagged, not silently substituted |
| Offline use | Full workflow offline with local models and the Topaz CLI |

Stack: FilmCrafter3's shell stack; EffectCraft at a pinned commit through CLI and MCP with a mock adapter; AI
providers through the multi-provider router extended with the three interfaces; storage = project JSON plus a local
index.

## Roadmap

0 Feasibility (spike, adapter contract, mock) → **gate: criteria 1–5** → 1 Foundation (shell, Intent card, project
model, router, control modes) → 2 Typography and primitives (library, style families, Builder, preview loop) →
**gate: preview targets** → 3 Audio sync (Pulseframe package, sync modes, ElevenLabs, import) → 4 QA and review
(tier 1 QA with Topaz fixes, Review, revisions, drift) → 5 Delivery (render queue, alpha export, packages, crash
recovery) → **gate: release**. Later: 3D, Lottie, tier 2–3 QA, Suno if API access, integrations. The agent layer is
built alongside each phase. Tickets: [BACKLOG.md](BACKLOG.md).

## Acceptance

19 automated tests plus a golden-brief rubric (10 briefs, two reviewers, 1–5 on hierarchy, timing, typography,
intent fit, polish; release bar median ≥ 4, none below 3). Detail: [ACCEPTANCE.md](ACCEPTANCE.md).

## Non-negotiables

Genre-neutral, style-agnostic · native editable text and layers · explicit, visible, editable intent · references
become original principles · every stage works in Manual with no provider · approved work locked · expensive
generation and final renders need approval · official APIs or import only · portable projects · QA findings carry
evidence · FilmCrafter3, Pulseframe and EffectCraft are the only required repos.

**Future integrations:** ProducerOne, Greenroom and the Grad Central Station hub stay optional; v1 defines their
contract (package format + MCP import/export tools) but ships without them.

## Discrepancies found while checking the repos (2026-11-22)

1. Roadmap release gate says "all 15 tests pass"; the acceptance list has 19. These docs use 19.
2. "Motion Studio's multi-provider router" — no Motion Studio repo found; FilmCrafter3's `llm.py`/`routing.py` is
   used instead (ADR-0004).
3. FilmCrafter3 provides backups (`filmbackup.py`), not a timed autosave; autosave is new work (P1-06).
4. FilmCrafter3 reaches Topaz through Kie.ai/fal; that conflicts with "official APIs only", so it is not reused.
5. EffectCraft has a native layer **lock switch** (`layer.setSwitch … "lock"`). MotionCraft's approval lock uses
   both: adapter refusal (authoritative) and the native switch (so the GUI shows the lock). See ENGINE_ADAPTER.md.
6. EffectCraft's project file lock is taken only by CLI runs, not by the desktop app or `mcp`, so concurrent GUI and
   agent writes are a real risk for criterion 5 — the spike must test it.
7. The first UI brief put a gate diamond between every stage; the PRD has four gates (A–D). UI_UX.md places four. The
   bottom stage bar replaces the PRD's earlier "left navigation and top workspace tabs".
8. FilmCrafter3 is amber, with custom icons and no bundled fonts; MotionCraft is cyan, with Lucide and bundled Inter,
   Space Grotesk and IBM Plex Mono (UI_UX.md §10).
