# MotionCraft UI/UX brief

Revised 2026-11-22 from Victor's first brief, checked against the [PRD](PRD.md), [PROJECT_SCHEMA.md](PROJECT_SCHEMA.md)
and the FilmCrafter3 and Pulseframe source.

**Precedence:** PRD non-negotiables and the hard rules in [AGENTS.md](../AGENTS.md) → this brief → the generated
mockups. The mockups are visual references only; where their navigation, labels or controls differ, this brief wins.

Build MotionCraft as a calm, visual workspace for directing, building, reviewing and delivering motion graphics. It
should feel precise, cinematic and approachable: Apple's restraint, DaVinci Resolve's production workflow, the user's
artwork always visually dominant. It follows FilmCrafter's product language, not its amber look (see §13).

## 1. What changed from the first brief

| # | Change | Why |
| --- | --- | --- |
| 1 | Four gate diamonds (A–D) at fixed places, not one between every stage | The PRD has four gates; the Build ↔ Review loop has none |
| 2 | Stage modes use the PRD's seven keys; Brief and Deliver have no mode | PRD "Control modes" and `controlModes` in the schema; a final render is never automatic |
| 3 | The 25 "screens" are sorted into 7 stage pages + Projects, panels, sheets and states (§7) | The first list mixed pages, panels and dialogs; the stage bar needs exactly seven pages |
| 4 | Typography and Camera are limited Build panels; Storyboard is part of Treatment; Render is part of Deliver; References and Style system sit in Direction | The PRD forbids a compositor UI and a properties panel, and defines Treatment as the storyboard |
| 5 | Templates page deferred to v1.x | Not in PRD scope: v1 ships primitives and 12 style families, not a template gallery |
| 6 | Added UI the PRD requires and the first brief left out: rule table, per-dimension style controls and conflict warnings, primitive library, layer list with lock/provenance/drift badges, sync modes and restraint slider, budget chip and spend confirmation, font licence status, Gate D sheet, offline and no-provider states, crash recovery | PRD sections Creative intent, Style system, Motion primitive library, Audio sync, Providers, QA, Targets |
| 7 | The bottom stage bar replaces the PRD's left navigation and top workspace tabs; the PRD Interface section is updated | Your explicit direction; avoids triple navigation |
| 8 | New "control border" token; primary buttons use a dark label on cyan | Divider contrast is 1.21–1.60:1, below the 3:1 needed for input borders; a light label on cyan is 1.49:1 (§10) |
| 9 | "Scenes" become beats (intent, treatment) and compositions (engine) | The data model has no scenes (§3) |
| 10 | Story-strip "approval gates" become per-beat lock badges | Gates are stage-level, not positions on a timeline |
| 11 | Review keeps your four result labels and adds severity; creative suggestions are human comments in v1 | PRD QA: judgement checks (tier 3) ship later and are advisory |
| 12 | FilmCrafter3's icons and amber accent are not ported; Lucide and the cyan tokens are | Your choice; [REPOS.md](REPOS.md) updated |

## 2. Principles

- The artwork is the brightest, largest thing on screen. Interface colour never follows artwork colour.
- One main action per view, named for its result: **Interpret brief**, **Approve treatment**, **Build preview**.
- A control that cannot act is greyed with the reason beside it, never hidden.
- Approval and execution are separate clicks and look different.
- Status is never colour alone: icon + text always.
- No timeline, layer-property panel, graph editor or keyframe editor. Detailed editing opens EffectCraft.
- Every stage works in Manual with no AI provider configured.

## 3. Vocabulary

| Term | Meaning | Lives in |
| --- | --- | --- |
| Beat | A timed moment with an emotion, intensity and energy | `intent.arc[]` |
| Composition | An EffectCraft comp (one per deliverable aspect ratio or sequence) | `.ecproj` |
| Layer | An EffectCraft layer; shown read-only next to its binding | `.ecproj` + `layerMap` |
| Primitive | A tested motion building block | `primitives/library/` |
| Revision | A recorded change by an agent or the user | `revisions[]` |
| Gate | A user approval point, A–D | `approvals[]` |

## 4. Navigation, gates and modes

### 4.1 Stage bar

Projects is the home screen, outside the stage bar. Inside a project, seven persistent pages sit along the bottom:

**Brief → Intent → ◆A → Direction → ◆B → Treatment → ◆C → Build → Review → ◆D → Deliver**

Users can revisit any earlier page. Editing approved material opens a **revision impact sheet**: it names the new
revision, lists the downstream stages and layers affected, and changes nothing until confirmed. Approved layers stay
locked; unlocking is an explicit user action that creates a revision. Do not show the same navigation in the header, a
sidebar and the bottom bar at once.

### 4.2 Gates

| Gate | Between | Approves | Passes when |
| --- | --- | --- | --- |
| A | Intent · Direction | The interpretation (Intent card and rule table) | User clicks **Approve intent** |
| B | Direction · Treatment | One style direction | User clicks **Approve direction** |
| C | Treatment · Build | Treatment and timing map | User clicks **Approve treatment** |
| D | Review · Deliver | Final render: sign-off and cost | Sign-off is recorded in Review (**Approve for final render**), then the cost is confirmed on the Deliver render sheet. Never automatic, in any mode |

Each diamond is a focusable button with a tooltip and an accessible name such as "Gate B, Direction: approved 14:02".

| UI state | `ApprovalRecord.state` | Diamond shape | Text |
| --- | --- | --- | --- |
| Not reached | no record | empty outline | not reached |
| Ready | no record, stage complete | outline with centre dot | ready for your approval |
| Approved | `approved` | solid with check | approved *time* |
| Changed in EffectCraft | `changed_by_user` | solid with exclamation | changed since approval, review it |
| Needs re-approval | `revoked`, note names the revision | outline with slash | needs re-approval after revision *n* |

If "needs re-approval" must be told apart from a user revoking, add a `stale` state to the schema in P1-03 and update
PROJECT_SCHEMA.md. States differ by shape and text, not colour.

### 4.3 Control modes

Each stage has a segmented control (**Manual · Assisted · Agent-led**, text labels), stored per project in
`controlModes` with the PRD's keys.

| Page | Key | Default |
| --- | --- | --- |
| Brief | none (intake is user-driven); its Audio panel carries `sound` | `sound`: Assisted (proposed) |
| Intent | `intent` | Assisted (PRD) |
| Direction | `style` | Assisted (PRD) |
| Treatment | `treatment` | Assisted (proposed) |
| Build | `build`; its Audio panel carries `audio-sync` | `build`: Agent-led (PRD); `audio-sync`: Assisted (proposed) |
| Review | `qa-fixes` | Assisted (proposed) |
| Deliver | none: final render is never automatic | — |

- **Manual:** the user decides and starts every operation; the agent panel is not shown for that stage.
- **Assisted:** the agent proposes; the user applies or rejects each proposal.
- **Agent-led:** the agent acts inside the approved plan and budget. It still stops at gates A–D, never spends without a
  confirmed spend token, and never touches a locked layer.
- Switching to Manual keeps all agent work so far and stops further agent actions. If an operation is running, ask:
  finish it or cancel it.
- With no AI provider configured, **Assisted** and **Agent-led** are disabled with the reason beside them and a link to
  Settings › Providers. No page is blocked. Keyframe-level editing is in EffectCraft whatever the mode.

## 5. Shell

One shell for every page:

- **Header (≈48 px):** project name · save status · stage mode · budget chip · engine status · command search ·
  settings.
  - Save status: *Saving…*, *Saved 12 s ago*, *Unsaved changes in EffectCraft*, *Recovered after a crash*. Autosave runs
    every 30 s.
  - Budget chip, e.g. "$0.40 of $10.00", shown once a paid provider is configured or any cost is recorded. Label each
    amount *Reported*, *Estimate* or *Unknown*. Never add amounts in different units.
  - Engine chip: EffectCraft version against the pinned commit, connected or not, and Offline mode on or off. It opens a
    popover with detail and actions.
- **Viewer (centre, large):** neutral surround. It shows the latest **preview** from the engine, not live playback.
  Preview states: *No preview yet · Rendering (elapsed time) · Ready (time, resolution) · Out of date (the project
  changed since)*. Show elapsed time against the targets (first 15 s preview ≤ 60 s, small edit ≤ 10 s).
- **Left rail (optional):** beats (Treatment, Review), compositions (Build), assets (Brief, Media).
- **Right inspector (collapsible):** contextual panels. The page's main action is pinned at its bottom, as in
  FilmCrafter3's dock. It must stay reachable when the inspector is collapsed.
- **Story strip (shallow, where timing matters):** beat thumbnails, narration/music waveform, beat markers read from
  the engine comp, optional emotional arc, and a lock badge on beats whose layers are approved.
- **Bottom stage bar:** persistent, same on every page.
- Panels resize and collapse without losing work. Defaults: rails 240–280 px, inspector 320–380 px, story strip
  96–120 px; minimum window 1100 × 660 (FilmCrafter3's minimum). **Viewer-only mode** hides rails, inspector and strip;
  Esc returns.

## 6. Pages

| Page | Views and panels | Main action |
| --- | --- | --- |
| Brief | Brief and script editor; attachments (script, music or narration audio, reference images, brand PDFs, storyboard images); Media panel; Audio panel | **Interpret brief** |
| Intent | Intent card: purpose, tone, beats with primary and secondary emotion, intensity 1–5 and energy 1–5, each point with its written anchor; source evidence quoted from the brief; rule table showing which rules fired, editable | **Approve intent** (Gate A) |
| Direction | 2–3 large visual proposals with stills and a short description; Style system panel; References panel | **Approve direction** (Gate B); on a card, **Use this direction** |
| Treatment | Beat-by-beat storyboard frames over the audio waveform; sequence plan and motion language per beat; animatic (stills over audio, not an engine render) | **Approve treatment** (Gate C); secondary **Preview animatic** |
| Build | Viewer; Layers, Text, Camera, Primitives, Audio and Agent panels (§6.1) | **Build preview** |
| Review | Player with frame-accurate comments; findings; Compare; History | **Approve for final render**; secondary **Request changes** |
| Deliver | Outputs; render queue; collected project | **Render final…** (opens the Gate D sheet); secondary **Export selected** |

**Direction › Style system** holds the seven dimensions from the schema: typography, motion, color, texture, camera,
transitions, composition. Each is assigned a style family and an intensity (subtle, moderate, strong), never a
percentage. Show conflict warnings with the reason and an override. Show fonts with licence status (video use allowed
or not), and the palette.

**Direction › References:** moodboard, source information, attribution notes and the extracted principles.
**Apply principles** applies principles, not the work. Never put a living designer's name into a generation prompt as
an instruction to imitate.

### 6.1 Build panels (the limit of what MotionCraft edits)

| Panel | Does | Does not |
| --- | --- | --- |
| Layers | Read-only list from the engine and `layerMap`: name, role, primitive, provenance (agent, user, imported, provider), lock, drift. Actions: approve (lock), unlock (new revision), **Open in EffectCraft** | Edit properties or keyframes |
| Text | Change the words, font (from the style profile and installed fonts, with licence chip), size step, palette colour, alignment, through the adapter | Anything else; those go to EffectCraft |
| Camera | Choose a 2.5D move primitive (push, drift, parallax rack), strength, duration | Keyframes or curves |
| Primitives | Browse by category and tag, thumbnail, parameters within their allowed ranges, **Apply to selected layer**, **Save approved layer as primitive** | Author primitives from scratch in v1 |
| Audio | Waveform, sections, beats, downbeats, silence, word timings; sync mode (every beat, downbeats only, phrases, energy-driven, narration-led, manual markers); restraint slider (sparse ⇄ aggressive, with a number); sound sources: import, or ElevenLabs generation with cost approval; licence note on imported tracks; the `sound` and `audio-sync` mode controls | Edit audio |
| Agent | §8 | — |

Controls on a locked layer are disabled with "Approved. Unlock to edit; this creates a revision." A layer edited in
EffectCraft after approval shows **Changed in EffectCraft**; it is logged as a user revision and never reverted.
**Open in EffectCraft** starts the GUI with the bridge attached ([ARCHITECTURE.md](ARCHITECTURE.md)); whether it can open
a *named composition* is unverified (ticket P0-14).

## 7. Where each screen from the first brief went

| First brief | Now |
| --- | --- |
| Projects | Home screen |
| New project | Sheet: name, duration, deliverables (aspect, width, height, frame rate 23.976–60, alpha on or off), colour settings the engine supports |
| Templates | Deferred to v1.x |
| Brief | Page |
| Intent | Page, with the rule table |
| Direction | Page |
| References | Direction panel |
| Style system | Direction panel |
| Treatment | Page |
| Storyboard | Treatment view |
| Media | Panel (Brief, Build): provenance, licence note, availability |
| Build | Page |
| Typography | Build › Text panel |
| Camera direction | Build › Camera panel |
| Audio | Build › Audio panel (also reachable from Brief) |
| Agent plan | Build › Agent panel; a drawer on other pages |
| Review | Page |
| Compare | Review view |
| Render | Deliver view (queue) and the Gate D sheet |
| Deliver | Page |
| Relink media | Sheet |
| Settings | Sheet from the header: appearance, UI scale, shortcuts, engine (path, pinned version), providers and keys status, local models, Topaz CLI path, budget cap and approval threshold, offline mode, storage |
| Command palette | Overlay |
| Engine unavailable | Full-page state for engine-dependent pages |
| Operation failed | Sheet, or inline on the failed operation |

New sheets: spend confirmation, Gate D, revision impact, crash recovery, missing fonts.

## 8. Agent panel

Collapsed until relevant. When open it shows, in this order:

1. **Understood:** the agent's reading of the request, attached to the selected beat or layer. Instructions are short and
   attach to a selection. The full conversation lives in a drawer.
2. **Plan:** operations, affected beats and compositions, layers it will create or change, locked layers it will leave
   alone, dependencies.
3. **Tools and models:** provider and model, marked local or cloud.
4. **Cost:** *Estimate*, *Reported* or *Unknown*, per unit, against the project cap and the approval threshold.
5. **Progress** with elapsed time, **Pause** and **Cancel** where supported.
6. **Review changes:** the layers and bindings changed, then keep or undo.

States, each with its own text label: *Draft → Awaiting your approval → Approved → Running → Paused → Done · Failed ·
Cancelled*. An operation awaiting approval has no progress bar and no animation. Reserve the cyan pulse for *Running*;
stop it when work stops; honour reduced motion.

Anything that costs money needs a separate click on a **spend confirmation sheet** that shows the price. That click
obtains the spend token ([AGENTS.md](../AGENTS.md)); the panel's **Run approved plan** never queues paid work itself.
Cost above the threshold, or above the cap, blocks until the user acts. "Undo" uses the engine's undo where it exists,
otherwise restores the previous revision as a new revision (needs revision snapshots, ticket P0-15).

## 9. Review and delivery

**Findings** are separate from creative notes. In v1, technical findings are PRD tier 1 (deterministic); creative notes
are the reviewers' frame-accurate comments. Tier 2 and 3 checks appear later and are labelled advisory.

Every finding shows: location (timecode or layer, in IBM Plex Mono), evidence (frame grab, or measured value against
threshold), severity (info, warn, error), likely cause, status, and a next action. Check result labels:

| Label | Meaning |
| --- | --- |
| Passed | Check ran, nothing found |
| Needs review | Finding raised; needs a decision |
| Not checked | Check did not run (and why) |
| Unable to check | Check ran but could not decide (and why) |

Safe fixes offer one-click apply; each creates a revision and never touches locked layers.

**Compare** shows two revisions in sync with a change summary; **Restore as new revision** never deletes the other.
**Annotations** are removable from the viewer. Approval seals live only in interface chrome; renders come from the
composition, so neither can reach an export (tested, §14).

**Deliver** separates three outputs:

| Output | v1 presets (only what the connected engine supports) |
| --- | --- |
| Rendered video | H.264 |
| Graphics with transparency | ProRes 4444 with alpha |
| Collected editable project | `.motioncraft` package with the `.ecproj`, assets and font manifest |

The render sheet (Gate D) shows settings, estimated cost, "rendered at target resolution, no upscaling" and the sign-off
already given. Progress, elapsed time and cancel are visible; an interrupted render resumes from the last good frame.
Lottie export is v1.x and not offered in v1.

## 10. Visual system

### Tokens

Put these in `src/styles/tokens.css` and use no raw hex elsewhere.

```css
:root {
  --mc-bg-app: #181A1C;      --mc-bg-panel: #222426;
  --mc-bg-raised: #2B2E30;   --mc-bg-viewer: #303030;
  --mc-divider: #3A3D40;           /* decorative only */
  --mc-control-border: #7A8086;    /* inputs, segmented controls, gate outlines */
  --mc-text: #F2F3F4;  --mc-text-2: #B8BDC2;  --mc-text-3: #92999F;
  --mc-accent: #48DCE5;  --mc-on-accent: #181A1C;
  --mc-success: #83C5A0; --mc-warning: #E5BB72; --mc-error: #E68C88;
  --mc-r-ctl: 6px; --mc-r-panel: 8px; --mc-r-card: 10px;
  --mc-ctl-h: 36px;
  --mc-focus: 0 0 0 2px var(--mc-bg-app), 0 0 0 4px var(--mc-accent);
  --mc-t-panel: 180ms;
}
@media (prefers-reduced-motion: reduce) { :root { --mc-t-panel: 0ms; } }
```

Use an 8 px spacing system with 4 px adjustments. Standard controls are about 36 px high (FilmCrafter3 uses 34 px).
Avoid tiny icon-only buttons. Panel and menu transitions are 160–220 ms.

### Contrast (computed 2026-11-22, WCAG relative luminance)

| Token | Lowest over the four surfaces | Highest | Verdict |
| --- | --- | --- | --- |
| Primary text | 11.88 (viewer) | 15.71 | Pass |
| Secondary text | 6.97 (viewer) | 9.22 | Pass |
| Muted text | 4.57 (viewer) | 6.05 | Pass, barely; not below 12 px, not over artwork |
| Accent | 7.95 (viewer) | 10.51 | Pass |
| Success, warning, error | 6.57, 7.34, 5.32 | 8.69, 9.71, 7.04 | Pass |
| Divider | 1.21 | 1.60 | Decorative only; fails 3:1 for borders |
| Control border `#7A8086` | 3.31 | 4.37 | Pass 3:1 on every surface |
| Dark label `#181A1C` on accent fill | 10.51 | — | Pass |
| Light label `#F2F3F4` on accent fill | 1.49 | — | **Forbidden** |

Re-validate in the built components with axe (FilmCrafter3 already has `test:a11y`) and by eye. Never rely on colour
alone.

### Fonts

| Font | Role | Weights |
| --- | --- | --- |
| Inter | Interface, controls, navigation, body | 400, 500, 600 |
| Space Grotesk | Page headings and introductory titles | 500, 600 |
| IBM Plex Mono | Timecode, frame counts, technical values (tabular numerals) | 400, 500 |

Sizes: page heading 24–28, section heading 16–18, controls and body 14, supporting 12–13, timecode 13–14 px. No
ultra-light weights, little uppercase, no wide letter-spacing in controls.

Bundle the font files with the app: FilmCrafter3 has no font packages or font files, and the offline requirement (AT-17)
rules out a CDN. Ship each licence file in a `THIRD_PARTY_NOTICES` (these families are published under the SIL Open
Font License; confirm the licence in each package you bundle). Interface fonts are separate from fonts inside a user's
composition, which are never silently substituted: a missing one is flagged by name with its licence status.

### Icons

Lucide, 18–20 px for controls and 16 px for compact metadata, stroke 1.75 px (set `strokeWidth` once). All 26 names in
the mapping below resolve in `lucide-react` 1.77.0 (checked 2026-11-22): pin that exact version and let the build fail on
a missing import. Pair unfamiliar icons with text.

| Area | Icon | Area | Icon |
| --- | --- | --- | --- |
| Projects | `Folder` | Camera | `Camera` |
| New project | `FilePlus2` | Audio | `AudioLines` |
| Brief | `FileText` | Agent | `Bot` |
| Intent | `HeartPulse` | Settings | `Settings2` |
| Direction | `Compass` | Search | `Search` |
| Treatment | `PanelsTopLeft` | Command palette | `Command` |
| Build | `Clapperboard` | Import, Export | `Upload`, `Download` |
| Review | `ScanEye` | Compare | `Columns2` |
| Deliver | `PackageCheck` | History | `History` |
| Media | `Images` | Relink | `Link2` |
| Typography | `Type` | Approved material | `LockKeyhole` |
| Warning | `TriangleAlert` | Retry | `RotateCcw` |
| EffectCraft hand-off | `ExternalLink` | | |

Custom SVGs: the **M** brand mark (a simplified version for small sizes and the taskbar, no texture or glow), the gate
diamond in its five states, and the emotional-arc symbol if needed. The silver M artwork is not in the repository; add it
under `brand/` before the icon work starts.

## 11. States to design

| State | What the user sees | Recovery |
| --- | --- | --- |
| Engine unavailable | Full-page for Build, Review, Deliver; Brief to Treatment stay usable. Shows last project data and last preview read-only | **Reconnect**, locate EffectCraft, details |
| Engine version differs from the pin | Warning in the engine chip, no silent run | Install the pinned version, or continue read-only |
| Operation failed | Cause, affected operation, what was kept | **Retry**, **Edit request**, open log |
| Offline mode | Cloud providers disabled with the reason | Switch off offline mode |
| No AI provider | Assisted and Agent-led disabled with reason; nothing else blocked | Settings › Providers |
| Over budget or above threshold | Operation held, amount shown | Raise the cap, or cancel |
| Out-of-date preview | Badge on the viewer | **Build preview** |
| Changed in EffectCraft | Layer badge and a notice on open | Review the revision; never reverted |
| Missing assets | Sheet listing each with candidates | **Confirm matches** |
| Missing fonts | Named, with licence status; never substituted | Install, or choose another |
| Crash recovery | Prompt on next launch, up to 30 s lost | Restore or discard |
| Empty project, loading, long operation, completed | Designed for each page; long operations show progress when measurable, elapsed time and cancel where supported | — |

Error copy says what happened, what is affected and what to do next.

## 12. Accessibility and keyboard

- Focus is always visible (`--mc-focus`, 7.95:1 against the viewer surround) and the order is predictable.
- The stage bar, gate diamonds, mode control and panels are reachable by keyboard; arrow keys move along the stage bar.
- Register shortcuts in a registry like FilmCrafter3's `src/shortcuts.ts`; do not hard-code keys in components.
- Text stays readable at Windows display scaling: reuse FilmCrafter3's UI-scale setting (`src/uiScale.ts`, 90–250%).
- Honour `prefers-reduced-motion`. Respect screen-reader names on every icon-only or state-only element.

## 13. What to reuse, and what not to

| Source | Use for | Notes |
| --- | --- | --- |
| FilmCrafter3 `src/ui-system.css` | Control patterns: one `.primary` per view, `.sel`, `.quiet`, `.why` (the reason a control is off) | Remap tokens: its accent is amber (`--amber`) and its focus ring hard-codes `rgba(232,180,92,…)` |
| FilmCrafter3 `src/Dock.tsx` | Pinned main action (`DockBar`, `Cta` with a price) | |
| FilmCrafter3 `src/FilmRail.tsx` | The rule "greyed with the reason, never hidden" | Not its left rail: navigation is the bottom bar |
| FilmCrafter3 `src/Sheet.tsx`, `src/Palette.tsx`, `src/uiScale.ts` | Dialogs, command palette, UI scale | |
| Pulseframe `src/Fold.tsx` | Disclosures | FilmCrafter3 does not have `Fold` |
| FilmCrafter3 `src/icons.tsx`, `src/glyphs.tsx` | Nothing | Lucide instead |

## 14. Implementation acceptance criteria

The first brief's ten criteria stand; 11–20 are new.

1. All screens use the same shell, typography, icons and tokens.
2. The bottom stage bar is identical on every page.
3. The viewer has a neutral surround.
4. Panels collapse without losing work.
5. Keyboard focus is visible and predictable.
6. Loading, empty, failed, disconnected and completed states exist (§11).
7. Text stays readable at Windows display scaling.
8. The main workflow completes without opening a dense editor.
9. EffectCraft opens the correct composition for detailed editing. *Depends on P0-14; if the engine cannot open a named composition, the UI names the composition to select.*
10. Mockup text and sample values are replaced with real application data.
11. Four gate diamonds sit at A–D as in §4.2, each with a tooltip and accessible text status, distinguishable without colour.
12. `controlModes` is stored per project with the PRD's keys and the defaults in §4.3.
13. A project completes with every stage on Manual and no provider configured (AT-16); no page is blocked.
14. Offline mode disables cloud providers with a reason and the workflow still completes (AT-17).
15. No paid operation runs without the spend confirmation sheet showing its price.
16. Controls on a locked layer are disabled with a reason; drift shows **Changed in EffectCraft**.
17. The UI has no timeline, property panel, graph editor or keyframe editor.
18. Seals and annotations never appear in an export (test: export frames are identical with and without them).
19. Fonts load with the network off; every Lucide import resolves at build; axe reports no contrast failures on the built tokens.
20. The app is usable at 1100 × 660 and at 100–250% UI scale.

## 15. Open items

| Item | Needs |
| --- | --- |
| Open EffectCraft on a named composition | P0-14 |
| Revision snapshots for Compare and Restore (size and time) | P0-15 |
| Silver M artwork | Victor adds it to `brand/` |
| Templates page | Confirm deferral to v1.x |
| Default modes marked "proposed" in §4.3 | Confirm |
