# Working in After Effects and DaVinci Resolve (Fusion): plan

Requested by Victor, 2026-11-23: "add to the plan the option to also work in Adobe After Effects as well as DaVinci Resolve's
motion graphics tool, Fusion". Status: **proposed**, needs Victor's decision on the one question in section 4. Nothing in this
plan is built yet. The only thing run so far is the evidence in section 1.

## 1. What is known (and what is not)

| Fact | Source | Checked? |
| --- | --- | --- |
| EffectCraft can **export an After Effects project** (`file.exportAep`, writes an `.aep` that After Effects 2026 opens) and **import one** (`file.importAep`). Both are deliberately narrow: what they cannot carry is reported, never dropped silently | EffectCraft `docs/aep-export.md`, `aep-import.md` | The commands exist in the installed release and in the pinned snapshot |
| A dry run and a real export on a typical MotionCraft composition (solid, rectangle, text with opacity keys, a per-letter text animator, one marker) reported 3 layers, 6 keyframes, 1 text animator, 1 marker as exported, no losses, and wrote a 39 KB `.aep` | Run on this PC, 2026-11-23, installed EffectCraft 0.24.1 | **The file was not opened in After Effects.** "Exported" is not "opens correctly" |
| After Effects 2025 is installed on this PC; EffectCraft's notes say 2026 opens the export | This PC; EffectCraft docs | **Version compatibility is unverified** |
| EffectCraft's `.aep` export does not carry the render queue, most project settings, or colour spaces beyond None, sRGB and Rec.709 Gamma 2.4 | `aep-export.md` "limitations" | Read, not tested |
| EffectCraft also exports Lottie (no warnings on the same composition) and imports timelines (FCP7 XML, FCPXML, OTIO, EDL, AAF, OMF), but does not export timelines | `agents.md`, run on this PC | Lottie checked; timeline export does not exist |
| FilmCrafter3 already writes EDL, OpenTimelineIO, FCPXML and xmeml for Resolve and Premiere (`interchange.py`, `editor_export.py`). Its notes say Resolve can only be scripted from outside in the paid Studio edition while Resolve is running, and Premiere has no stable external hook | FilmCrafter3 @ ac99ec9 source comments | Not verified by me |
| DaVinci Resolve is installed on this PC with `Resolve.exe`, `fusionscript.dll` and `ResolvePython`; **the edition (free or Studio) is unknown**; no separate Fusion Studio was found | This PC | Files seen only |
| "Fusion" means two things: the Fusion page inside Resolve, and the standalone Fusion Studio. This plan assumes the Fusion page | Victor said "fusion, I think" | **Please confirm** |

## 2. Principle

EffectCraft stays the engine of record (ADR-0001: the `.ecproj` is the only store of composition data). After Effects and Fusion
are **targets you can hand work to**, not second engines. MotionCraft stays the director layer: intent, approvals, provenance, QA
and delivery wrap the whole round trip.

| Target | Send out | Bring back | Live control | Realistic first step |
| --- | --- | --- | --- | --- |
| EffectCraft | live | live | yes | built |
| After Effects | `.aep` from `file.exportAep` | `.aep` through `file.importAep` | later, via ExtendScript or a panel | spike P6-01, then Open in After Effects |
| DaVinci Resolve (Edit and Color pages) | rendered video (H.264 or ProRes) plus audio, with an FCPXML or EDL timeline | media only | Studio edition scripting only | P6-04 |
| Fusion page | rendered ProRes 4444 with alpha clips as Fusion inputs; later, generated title macros | none | Studio edition scripting only | P6-05 research |

Consequences, stated plainly:

- **Locks and approvals cannot be enforced inside another editor.** At hand-off the affected layers show **Handed off**. When
  an After Effects project comes back it is imported as a new composition, logged as a user revision, and its bindings are
  re-made; approvals on layers it touches are revoked with a note. (Whether the layer ids change on re-import is assumed, to be
  verified in P6-03.)
- **Drift detection** works only for what comes back through `.aep` import. Nothing comes back from Resolve or Fusion except
  rendered media.
- **Fonts**: the other editor needs the same fonts installed. The font manifest travels with the package; a missing font is
  flagged by name and never substituted.
- **Colour**: HDR and wide-gamut working spaces are outside the `.aep` export today.
- **Money**: unchanged. A final render still needs the spend token; exporting a hand-off file is free.

## 3. Tickets (added to `docs/BACKLOG.md` as Phase 6)

| Id | Ticket | Done when |
| --- | --- | --- |
| P6-01 | Spike: round trip through After Effects. Export typical comps with `file.exportAep`, **open them in After Effects 2025 and 2026 if available**, compare, import back with `file.importAep`; record what survives (text, shapes, keyframes, per-letter animators, variable fonts, markers) and what the report misses | Table in the PR with pictures from After Effects; list of gaps |
| P6-02 | **Open in After Effects**: dry-run report sheet, explicit allow-losses confirmation, export to `handoff/`, launch After Effects on the file | A person opens a project in After Effects from MotionCraft |
| P6-03 | **Bring back from After Effects**: import the edited `.aep` as a new composition, revision, bindings re-made, approvals revoked with a note | Round-trip test; drift shown as Changed in After Effects |
| P6-04 | **Hand off to DaVinci Resolve**: render (confirmed, as any final render), audio, and an FCPXML or EDL timeline written by a port of FilmCrafter3 `editor_export.py` (PORT_LEDGER entry) | A timeline opens in Resolve with the media linked |
| P6-05 | Spike: Fusion. Detect Studio versus free; try ProRes 4444 alpha clips on the Fusion page; research generating a Fusion title macro from a text or shape layer; decide how far to go | Decision note with evidence |
| P6-06 | Editors in Settings: find After Effects and Resolve automatically (known folders, Browse, exact program names), show versions, offer only what is installed | Same behaviour as EffectCraft detection, with tests |
| P6-07 | Editor-neutral QA: missing fonts and licences, frame rate, colour space, alpha, checked on the hand-off package | Findings with evidence |
| P6-08 | Later: live bridges. After Effects through ExtendScript or `aerender`; Resolve through its Python API (Studio only) | Separate ADR before starting |

Order: P6-01 first. It is cheap, it uses what EffectCraft already ships, and it decides whether P6-02 and P6-03 are a few days or
a few weeks.

## 4. Decision needed from Victor

Do you want After Effects and Fusion as **hand-off targets** (recommended), or as **full alternative editors** where the
composition lives in an `.aep` or a Fusion comp?

- **Hand-off targets** fit ADR-0001 and every hard rule in `AGENTS.md`, reuse EffectCraft's exporter and importer, and can start
  now. Costs: edits in the other editor are one-way except through `.aep` import, and MotionCraft cannot police them.
- **Alternative editors** would break "the `.ecproj` is the only store of composition data", need a new adapter with its own
  contract tests, a lock policy for ExtendScript or Fusion scripting, and (for Resolve) the paid Studio edition. That is a new
  product line, not a Phase 6 ticket.

Also please confirm: Fusion page versus Fusion Studio, and whether your Resolve is the free or Studio edition (Help, About).

## 5. Security notes for the build

Launching another program uses a fixed program name found in known install folders or picked by Browse, checked by exact file
name, never from project content; files passed to it are generated inside the package. No scripts from a project are ever run in
After Effects or Resolve. Network paths are refused, as for EffectCraft detection.
