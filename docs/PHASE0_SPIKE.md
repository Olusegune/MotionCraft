# Phase 0: EffectCraft go/no-go spike (2 weeks)

Goal: a written yes/no on EffectCraft, plus the adapter contract and the mock adapter, so Phase 1 can start either
way. Output: `docs/PHASE0_REPORT.md` (template at the end) and `spike/` scripts that anyone can re-run.

**Decision rule:** criteria 1–5 all pass → go. Any of 1–5 fails → fallback (keep the adapter, evaluate a
code-defined 2D renderer behind it, cut v1 to 2D typography, re-test EffectCraft quarterly). 6–8 failures become
risks in the report.

## Setup (day 1)

```
git clone https://github.com/storytold/effectcraft && cd effectcraft
git checkout 7e2d0256209974ffb92a29d8bdb6f2a49078f51f
cargo build --release -p effectcraft-cli -p effectcraft      # record wall time, toolchain, OS, GPU
./target/release/effectcraft-cli --version
./target/release/effectcraft-cli commands > ../MotionCraft/spike/commands.txt
```

Record the machine: OS, CPU, GPU, RAM. Run on Windows 11 first (FilmCrafter3's primary platform), then macOS.

## Tickets

| Id | Criterion | Do | Pass |
| --- | --- | --- | --- |
| P0-01 | 7 | Build CLI + app at the pin on Windows and macOS, twice from clean | Same binary hash or a documented reason; build time recorded |
| P0-02 | — | Snapshot `command_list {schemas:true}` to `engine/tests/fixtures/effectcraft_commands.7e2d025.json`; confirm param names used in ENGINE_ADAPTER.md | Fixture committed; doc corrected |
| P0-03 | 1 | `spike/c1_headless.py`: start `effectcraft-cli mcp` (confined), create comp 1920×1080 30 fps 10 s, add native text, a shape, 3 keyframes on position/opacity, a camera; save | All steps OK, no GUI process |
| P0-04 | 2 | `spike/c2_roundtrip.py`: open → `layer.tree` → save → close, ×20; diff layer ids and canonical property hashes | Ids identical every cycle; hashes stable (needed for drift detection) |
| P0-05 | 3 | `spike/c3_preview.py`: time `render_preview` of the c1 comp at 5 times, and a 10 s preview render | Record seconds; compare against ≤ 60 s first-preview and ≤ 10 s edit-preview targets |
| P0-06 | 4 | `spike/c4_final.py`: ProRes 4444 RGBA and H.264; read back alpha and frame count with an independent decoder (ffprobe or PyAV) | Alpha correct on a transparent-background comp; frame count = duration × fps exactly |
| P0-07 | 5 | Start `effectcraft --control 9877`; `effectcraft-cli mcp --bridge 9877`; agent changes text and moves a layer while a person has the comp open; person saves; reopen | Edits visible live, file reopens clean, no lost hand edit. Also try an agent write *to the file* while GUI is open and record what breaks (expected: unsafe → adapter must forbid) |
| P0-08 | 6 | Variable font axis animation, an Arabic or Hebrew line, per-character animator | Renders correctly (screenshot in report) |
| P0-09 | 8 | `file.exportLottie` on the c1 comp | Exports; list `warnings` |
| P0-10 | — | Native lock: `layer.setSwitch lock`; confirm which commands skip vs fail on locked layers | Table in report; feeds the adapter lock check |
| P0-11 | — | Write `engine/motioncraft_engine/adapter/base.py` + JSON Schemas from ENGINE_ADAPTER.md | Reviewed interface |
| P0-12 | — | `MockAdapter` + contract test suite; same suite runs against real engine with `-m real_engine` | Suite green on mock; result recorded on real |
| P0-13 | — | `PHASE0_REPORT.md` with the go/no-go | Signed off by Victor |
| P0-14 | — | Find how to start the EffectCraft GUI on a given project **and composition** (CLI argument, or a control-channel command after launch) and how to refocus it later | A documented command that opens composition X; if impossible, record the fallback (open the project and tell the user which composition to select) |
| P0-15 | — | Revision snapshots: measure `file.saveCopy` time and size on the c1 comp and on a 60 s comp with 30 layers | Numbers in the report; feeds Compare and Restore ([UI_UX.md](UI_UX.md) §9) |

Days: 1–2 setup + P0-01/02 · 3–6 P0-03..P0-07 · 7 P0-08..P0-10, P0-14, P0-15 · 8–9 P0-11/12 · 10 report.

## Things to watch

- EffectCraft's project-file lock is not taken by the desktop app or `mcp`. P0-07 decides the concurrency rule.
- Confinement flags refuse bridge `ui_*` tools; confirm engine commands still pass through the bridge with them on.
- The control port has no authentication: bind only `127.0.0.1`, open it only for the session, random free port.
- Rendering performance depends on GPU path; record whether the GPU renderer was used.

## Report template (`docs/PHASE0_REPORT.md`)

```
# Phase 0 report — EffectCraft @ 7e2d025
Decision: GO | NO-GO (fallback)        Date:        Machine(s):
| # | Criterion | Result | Evidence (script, numbers, screenshot) |
|1..8|
Preview timings: first preview __ s (target 60), edit preview __ s (target 10)
Lock behaviour table:
Open-in-GUI at a named composition (P0-14):
Snapshot time and size, file.saveCopy (P0-15):
Concurrency rule adopted:
Risks (from 6–8 and anything else):
Changes needed to ENGINE_ADAPTER.md / PROJECT_SCHEMA.md:
Not checked:
```
