# Phase 0 report — EffectCraft @ 7e2d025

**Decision: CONDITIONAL GO.** Criteria 1, 2, 3, 4 pass on Windows. Criterion 5 passes its scripted half; the half that needs
a person at the window is **not checked** (Needs Victor). Criterion 7 is unresolved (two clean builds gave different
binaries, cause unknown; macOS not built). Criteria 1–5 are not all proven until Victor completes the two manual items
below, so this is not an unconditional GO and the rule in PHASE0_SPIKE.md ("1–5 all pass → go") is not yet met.

**Date:** 2026-11-22. **Machine (all timings):** Windows 11 Home build 26200, Intel Core i5-14400F (10 cores / 16
threads), NVIDIA GeForce RTX 4070 SUPER (driver 32.0.16.1088), 31.8 GB RAM, Rust 1.96.0 (`x86_64-pc-windows-msvc`),
ffmpeg 8.1.2. Headless runs used the CPU renderer. Other builds were running on the machine during P0-01 and P0-05.

**Process note:** Phase 1 work (the app shell, PR 2) was started on Victor's instruction in chat before this report existed.
That overrides the BACKLOG rule "nothing below starts until the report says GO". It was Victor's call; it does not change
the evidence below.

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Headless build | **Pass** (Windows) | `spike/c1_headless.py`: 1920×1080 30 fps 10 s comp, native text, rect shape, 3 keyframes each on position and opacity on two layers, camera, saved; no GUI process started. `spike/results/c1_headless_windows.txt` |
| 2 | Round trip, 20 cycles | **Pass** (Windows) | `spike/c2_roundtrip.py`: open → inspect → save → close ×20, in fresh-process and in-process modes. Layer ids, canonical per-layer hashes and file bytes identical every cycle. `c2_roundtrip_windows.json` |
| 3 | Preview | **Pass, weak evidence** | First `render_preview` 0.003 s, edit preview 0.004 s, 10 s half-res H.264 (300 frames) 0.88 s, CPU renderer. The comp has 3 layers, so these say little about real comps. Heavier comps are **not checked**. `c3_preview_windows_cpu.json`, `c3_frame_1.5s.png` |
| 4 | Final render | **Pass** (Windows) | `spike/c4_final.py`, ffprobe: ProRes 4444 `yuva444p12le` 1920×1080, 300/300 frames; H.264 High 300/300 frames; alpha read back by decoding: empty corner alpha 0, opaque shape alpha 255. `c4_final_windows.json` |
| 5 | Agent edits with GUI open | **Scripted half passes; person half NOT CHECKED** | `spike/c5_gui_bridge.py`: edits sent through `effectcraft-cli mcp --bridge` (confinement on) changed the live GUI (frame from the GUI process differed, GUI reported the new text); GUI save, then headless reopen was clean. A person hand-editing at the same time was not tested. **Needs Victor** (steps below) |
| 6 | Text | **Pass** (Windows, one font set) | `spike/c6_text.py`: Bahnschrift variable weight/width, per-character animator reveal, per-character `wght` animation (selected letters visibly bolder), Arabic and Hebrew lines joined and ordered right to left in Segoe UI. Frames `c6_t*.png`, `c6_axis_only.png`. I looked at the pictures; Victor should confirm. Other fonts and scripts not checked |
| 7 | Pinned build reproducible | **Unresolved** | Two clean `cargo build --release --locked` runs: 902.4 s and 847.9 s. Binary SHA-256 **differ** between runs (`effectcraft-cli` 7dbc9a59… vs 4df7633a…). Cause not investigated (likely embedded timestamps or paths). macOS not built: **Needs Victor** (Mac). `p0_01_build_windows.json` |
| 8 | Lottie | **Pass** | `spike/c7_lottie.py`: exports; one warning: "Camera: cameras and lights are not exported". `textAsShapes` also works. Text animators and variable fonts in Lottie not checked |

**Preview timings:** first preview 0.003 s (target 60), edit preview 0.004 s (target 10), CPU renderer, 3-layer comp.
GPU: a GUI launch picked Vulkan on the RTX 4070 SUPER once and reported "GPU compositor unavailable (GL)" on the next, so
the GPU path is not reliable at launch. Headless runs use the CPU unless `--gpu` is passed (not tested).

## Lock behaviour table (P0-10, `spike/c8_lock.py`)

State: `layer.setSwitch lock=true` on a layer, then one command on it in a fresh session.

| Command | Result |
| --- | --- |
| `prop.set`, `prop.addKey`, `layer.setText`, `layer.rename`, `layer.setTransform`, `layer.setBlendMode` | **Applied** despite the lock |
| `edit.duplicate`, `layer.style.dropShadow` | **Applied** (copy made / style added) |
| `layer.setParent`, `layer.arrange`, `edit.clear` (explicit and selection-based) | **Refused**: "is locked" |
| `layer.setSwitch` (video off, and `lock=false`) | **Skipped** without error; so it cannot unlock |
| `layer.setComment`, `layer.addMarker` | Reply success; effect **not verified** (not in my hash) |

Consequence: the native lock is weak. The adapter's own check is the only real protection. Unlock uses `layer.unlockAll` and
re-locks the rest. Most layer commands take `layers` and use the **selection** when it is omitted, so agents must name layers.

## Concurrency rule adopted

1. While a GUI has the project open, the adapter writes **only through the bridge**; it refuses `create` and `open` (code:
   `GuiWriteConflict`). Measured: a second process saving the same file while the GUI is open succeeds silently, the GUI never
   sees it, and the GUI's next save overwrites it (the write is lost with no error).
2. One writer at a time per project inside MotionCraft (lock in `BaseAdapter`).
3. Never `file.save` through the bridge while the GUI has unsaved changes the agent did not make (`GuiWriteConflict`; the
   "dirty" check is implemented but only the mock path is tested).
4. Control port: engine binds `127.0.0.1` itself; random free port above 1023, open only for the live session. Confinement flags
   keep engine commands working through the bridge, and refuse `ui_*` tools, `control`, scripts and writes outside the roots
   (all three checked in P0-07).

## Open in GUI at a named composition (P0-14, `spike/c10_open_comp.py`)

`effectcraft --control <port> <file.ecproj>` opens the project on its **last active composition**. Sending `comp.open
{comp: <name|id>}` over the control channel then switches the active composition (verified: 41 → 1). No window-raise or focus
command exists in the control channel, so refocusing is an operating-system call (not built or tested). UI_UX criterion 9 can be met
with the command-line argument plus `comp.open`.

## Snapshot time and size, `file.saveCopy` (P0-15, `spike/c9_snapshots.py`)

| Comp | Time (median of 5) | Size | Zipped |
| --- | --- | --- | --- |
| 3 layers, 10 s | 1.4 ms | 99 KB | 6.6 KB |
| 30 layers x 8 keyframes, 60 s | 4.5 ms | 1.27 MB | 73 KB |

Revision snapshots are cheap. Projects with large embedded media were not tested.

## Adapter (P0-11, P0-12)

`engine/motioncraft_engine/adapter/`: interface, models with generated JSON Schemas, lock policy (allow-list, named layers
only), canonical hash, `MockAdapter`, `EffectCraftAdapter`. Contract suite: **42 passed on the mock**; **33 passed on the real
engine** with `-m real_engine` (EffectCraft 0.24.1, Windows; the other tests in the same files are mock-only static checks).
The real run covers lock refusals for every command in the table, unlock, drift, batch semantics, preview, spend-token rule
on `render_final`, Lottie export and ecproj copy. The GUI-attach rule is tested on the mock only.

## Risks

- **Reproducible builds (7):** not shown. Pin a toolchain, try `/Brepro` and path remapping, then compare. macOS unknown.
- **Weak native lock:** adapter check must be complete; new engine commands are refused for agents until classified.
- **Silent file overwrite with a GUI open:** any code path that writes the file while a GUI is open loses data. Guarded in
  the adapter; a person saving in the GUI over an agent file edit is the user's risk to be told about in the UI.
- **GPU path:** not reliable at GUI launch; not tested headless with `--gpu`.
- **Alpha engine:** 766 commands at this pin; breaking changes expected. The command snapshot test fails on a pin bump.
- **`--version` does not include the commit:** the pin is checked by version number only.
- **Fonts:** only fonts installed on this machine were tried.
- **Lottie:** camera dropped; more features unchecked.

## Changes made to ENGINE_ADAPTER.md / PROJECT_SCHEMA.md

- `text.sourceText.style` does not exist; text style is on `layer.setText` (P0-02).
- Confirmed params for `file.newProject`, `comp.new`, `file.save`, `layer.setSwitch`, `renderQueue.add`; default frame rate 29.97.
- Lock check section: measured table and the selection fallback; unlock via `layer.unlockAll` (P0-10, P0-13).
- `--version` has no commit; `inspect` uses `get_project` + `get_comp` (P0-13).
- Concurrency rule extended with the measured overwrite (P0-13).
- `engineLayerId` stability noted in PROJECT_SCHEMA.md (P0-13).

## Needs Victor

1. **P0-07 hand edit (criterion 5).** Run `python -I -X utf8 spike/c5_gui_bridge.py`-style setup by hand: start
   `effectcraft --control 9877`, open a comp, run `effectcraft-cli mcp --bridge 9877 --automation-read-root <dir>
   --automation-write-root <dir>`. While you drag a layer in the window, have the agent change its text through the bridge.
   Save in the window, close, reopen. Write down: did both edits survive; did anything revert or corrupt?
2. **P0-01 on a Mac.** Run `spike/p0_01_build.ps1` equivalent: `cargo build --release --locked -p effectcraft-cli -p effectcraft`
   twice from `cargo clean`, record time and `shasum -a 256` of both binaries.
3. **P0-08 pictures.** Look at `spike/results/c6_*.png`; confirm Arabic/Hebrew shaping and the weight sweep.
4. **Sign-off.** You said you would sign off on the report; that applies to the report as written, with items 1–2 open.

## Not checked

- Criterion 5 with a person editing; macOS for everything (builds, renders, GUI); Linux.
- Reproducible build cause; build on a clean machine.
- Preview and render speed on a realistic comp (many layers, effects, footage, 4K); GPU renderer headless.
- Renders at other frame rates (23.976, 29.97, 60) and other sizes; long durations; frame accuracy with audio.
- Footage and audio import, embedded media in snapshots, font missing/substitution behaviour.
- Lottie with text animators or variable fonts.
- `layer.setComment` / `layer.addMarker` on locked layers.
- GUI-attached `file.save` with unsaved changes (real engine); `attach_gui` on the real engine.
- Refocusing the GUI window.
- Crash recovery, autosave (`--autosave`) behaviour.
