# MotionCraft handover — 2026-11-22

Everything you need to continue on another PC. Written at the end of the session that built Phase 0 and a slice of Phases 1 to 5.
Owner: Victor Edun. Repo: https://github.com/Olusegune/MotionCraft. Latest work: branch `p1-splash-fix` (PR 23).

## 1. What MotionCraft is (one paragraph)

The director layer for motion design. Tauri 2 shell (`src-tauri/`, Rust) + React 19 / TypeScript UI (`src/`) + a Python engine
helper (`engine/motioncraft_engine/`, frozen with PyInstaller and bundled as a sidecar) that drives **EffectCraft** (a separate
Rust motion-graphics app, pinned to commit `7e2d025`, version 0.24.1) through `effectcraft-cli mcp`. MotionCraft stores intent,
approvals, provenance and history in `project.json`; the composition lives only in the `.ecproj` file. Read first, in this
order: `AGENTS.md` (hard rules), `docs/PRD.md`, `docs/UI_UX.md`, `docs/ENGINE_ADAPTER.md`, `docs/PHASE0_REPORT.md`,
`docs/UX_REVIEW.md`, `docs/adr/0005-image-video-providers.md`.

## 2. Where everything is

| Thing | Location |
| --- | --- |
| Code | GitHub `Olusegune/MotionCraft`. The newest branch contains everything: `p1-splash-fix` |
| Latest installers and a source zip | Desktop of the old PC: `MotionCraft_Build\` (also rebuilt by CI on every PR; artifacts on the Actions run) |
| Brand art (app icon, document icon, splash, 21:9 splash) | `brand/` in the repo |
| Original mockup images | `Downloads\` on the old PC (not in the repo): copy them if you want them |
| Phase 0 evidence (scripts and results) | `spike/` and `spike/results/` |
| Sibling repos used for reading only (never push) | `effectcraft` @ `7e2d0256209974ffb92a29d8bdb6f2a49078f51f`, `FilmCrafter3` @ `ac99ec977c4b5896874dea7d63a7682ec0c82900`, `Pulseframe-Music-Video-Maker` @ `a0ee7ece663df9e68368c27268e6d10d6c254d7b` (private) |

Not in the repo and not transferable: provider API keys (they live in the **operating system credential store** under service
`motioncraft`; enter them again on the new PC in Settings), the GitHub login (`gh auth login`), your Rafter API key
(`RAFTER_API_KEY`) and its fast-scan quota (it was used up in this billing period, so `rafter run` fails until it resets).

## 3. Pull requests and merge order

Nothing is merged. PR 1 is the docs; everything else is stacked. Bottom to top:

1. **PR 1** docs (branch `docs/v1-agent-docs`, base `main`): merge first.
2. **PR 2** app shell, then **PR 18** adapter wiring, **PR 19** providers, **PR 20** menus and UX, **PR 21** visual workspace, **PR 22**
   playback, layers, motion, audio, proposals, render, **PR 23** splash. Each is based on the one before, so merge in this order, or
   merge only PR 23 (it contains all of them) after PR 1.
3. **PRs 3 to 17** are the Phase 0 tickets (P0-01 to P0-15), one branch each, stacked on each other and on PR 1. PR 18 already
   includes their content by merge, so after PR 18 lands you can close them as "included", or merge them in order for history.

Each PR body lists what was and was not checked. CI (`.github/workflows/build.yml`) runs the frontend tests, the Python tests and
`npm audit`, then builds Windows and two macOS targets (Apple silicon, Intel) and uploads the installers.

## 4. Set up on a new Windows PC

Install: Git, GitHub CLI (`gh`), Node 22, Rust (stable, MSVC toolchain), Visual Studio Build Tools (C++), Python 3.11,
WebView2 runtime (included in Windows 11), and **EffectCraft 0.24.1** (the MSI installs to `C:\Program Files\EffectCraft`).
Optional: `ffmpeg` and `ffprobe` on PATH (used for non-WAV audio and for the render tests).

```powershell
gh auth login
git clone https://github.com/Olusegune/MotionCraft.git
cd MotionCraft
git switch p1-splash-fix            # or main once the PRs are merged
npm ci
python -m venv build\venv
build\venv\Scripts\python -m pip install pyinstaller pydantic pytest pillow
```

Run the tests (all of these passed at handover):

```powershell
npx tsc --noEmit
npx vitest run                                   # 55 tests
cd engine; python -m pytest -q; cd ..            # 90 on the mock engine
cd src-tauri; cargo test; cd ..                  # 12 (+3 that need a real machine)
npm audit
```

Run against the real engine (needs EffectCraft installed):

```powershell
$env:EFFECTCRAFT_CLI = "C:\Program Files\EffectCraft\effectcraft-cli.exe"
cd engine; python -m pytest -q -m real_engine; cd ..             # 45; the same suite passed on two different engine builds
cd src-tauri
$env:MOTIONCRAFT_ENGINE_DIR = "$PWD\..\engine"                    # dev builds only: run the helper from source
cargo test -- --ignored                                          # engine detection, helper round trip, motion + draft + final render
```

Build the app:

```powershell
build\venv\Scripts\python scripts\build_sidecar.py     # makes src-tauri\binaries\motioncraft-engine-<triple>.exe (needed before tauri build)
npx tauri build                                        # installers in src-tauri\target\release\bundle\ (nsis exe, msi)
npx tauri build --no-bundle                            # just src-tauri\target\release\motioncraft.exe, faster
npm run dev                                            # the web UI only, at http://127.0.0.1:1420 (no engine, no file dialogs)
```

macOS cannot be built on Windows: push a branch and let CI build it, or build on a Mac with the same commands (`npx tauri build`,
Rust targets `aarch64-apple-darwin` or `x86_64-apple-darwin`).

## 5. How the pieces connect

- **UI** (`src/`): pages in `src/pages/`, shell pieces in `src/shell/`, tokens in `src/styles/tokens.css` (no raw hex elsewhere,
  a test enforces it), project logic in `src/lib/` (`project.ts` gates and revisions, `layers.ts` drift, `api.ts` the only door to
  the desktop shell; in a browser it falls back to local storage and reports the engine as missing).
- **Shell** (`src-tauri/src/lib.rs`): project packages in `Documents\MotionCraft\*.motioncraft`, menus, splash, key storage,
  spend tokens, engine locator, and `engine_call`, which relays a **closed list** of methods to the helper. Every command runs
  off the UI thread (`#[tauri::command(async)]`): a plain sync command freezes the window.
- **Helper** (`engine/motioncraft_engine/sidecar.py`): JSON lines over stdin/stdout. Uses the **adapter**
  (`adapter/base.py`, `real.py`, `mock.py`, `policy.py`) for everything touching EffectCraft; also `primitives/library.py` (10
  motions), `audio.py`, `renderjobs.py` (draft movie and final render on their own engine process), `providers/` (image and
  video generation).
- **Adapter contract tests**: `engine/tests/adapter_contract/`. They run on the mock in CI and on the real engine with
  `-m real_engine`. The pinned command list is `engine/tests/fixtures/effectcraft_commands.7e2d025.json`; a test fails if a command
  the adapter uses disappears.

## 6. Rules that must not be broken (from AGENTS.md, in short)

Composition data only in the `.ecproj`. Every engine call goes through the adapter. Approved (locked) layers are untouchable by
agents (the adapter refuses before sending; EffectCraft's own lock is weak, see PHASE0_REPORT). Any paid call and every final
render needs a single-use spend token from a user click (`confirm_spend`; `generate_start` and `render_start` are the paid
methods and are covered by a Rust test). Keys only in the OS credential store. Confine the engine to the project folder.
Native editable text. Everything must work in Manual mode with no AI provider. **ADR-0005 (Victor, 2026-11-22):** image and video
generation may use Kie.ai and fal as opt-in providers next to BytePlus, Google and OpenAI; music and voice via Kie.ai and Topaz
via Kie or fal stay banned.

Your global instructions (`~/.claude/CLAUDE.md`) also require a Rafter review (`rafter-code-review` plus `rafter run`) before
declaring work that touches files, shell, network, keys or dependencies done. `rafter run --mode plus` is paid: ask first.

## 7. Where the project stands

By `docs/BACKLOG.md` the project is formally in **Phase 1 (foundation)**; slices of Phases 2 to 5 exist.

**Done and verified:** Phase 0 spike (conditional GO); adapter, mock and contract suite; seven-stage shell with gates and modes;
projects, menus, splash, settings; EffectCraft auto-detection; Build page on the real engine; media import, wall, moodboard,
storyboard; draft movie player; shapes, solids, media layers; 10 motion presets; WAV beats; direction proposals; final render;
collected project export; provider registry (17 built-in models plus Kie.ai discovery, 157 models checked live).

**Open for Victor (Phase 0 sign-off):**
1. The **hand-edit test** (P0-07): edit in the EffectCraft window while the agent edits through the bridge; steps are in `docs/PHASE0_REPORT.md`.
2. A **Mac** run of the P0-01 build (reproducible-build criterion is unresolved: two clean Windows builds gave different binaries).
3. Look at `spike/results/c6_*.png` (Arabic and Hebrew text, per-letter weight).
4. Confirm: Templates page deferred, and the stage-mode defaults marked "proposed" in `docs/UI_UX.md` section 4.3.

**Not checked anywhere (be honest about these):** installing and uninstalling the installers; the draft movie playing inside the
installed app; the Documentation button on the splash; every menu item clicked in the packaged app; anything on macOS; any
paid provider call (no keys were available; clients are tested against a local fake server, and the Kie.ai model index was fetched
live without a key); audio inside renders; beat grids on real music; a real screen reader; contrast measured in the rendered app.

**Known facts worth remembering:** the installed EffectCraft 0.24.1 release is **not byte-identical** to the pinned commit
(763 vs 766 commands, 7 schemas differ, `render_preview` has no `times`); `--version` cannot tell them apart. The adapter handles
what the app uses and the real-engine suite passes on both. Layer ids from EffectCraft are unique, not sequential, and stable
across save and reopen. EffectCraft's native lock stops very little. A second process saving the `.ecproj` while its GUI is open
is silently lost: MotionCraft is read-only while an EffectCraft window it launched is open.

## 8. Suggested next steps (most valuable first)

1. Merge PR 1 and the stack, tag a release, and install the installers on a clean PC (the biggest untested thing).
2. Watch the draft movie play in the installed app; if it does not, check the asset protocol scope and codec first.
3. Language-model router (port FilmCrafter3 `llm.py`, `routing.py`; add Inkling): unlocks Assisted and Agent-led modes (backlog P1-05).
4. The agents (Director, Builder, QA) and the intent rule table editor (P1-08 to P1-10, P2-08).
5. Primitive library growth toward ~100 (P2-02, P2-03), camera moves, style families as data (P2-04).
6. QA tier-1 checks and the compare view (P4-02, P4-05); render cancel and resume (P5-02).
7. Audio: sections, word timings, Pulseframe analysis package (P3-01); ElevenLabs and music import with licence notes (P3-05).
8. Autosave kill test, crash recovery sheet, revision snapshots wired to compare (P1-06, P1-13).
9. Reproducible builds: pin the toolchain, try `/Brepro` and path remapping (Phase 0 criterion 7).

## 9. Working agreements

One ticket per branch and PR using `.github/pull_request_template.md`. Report test counts honestly; a skipped test is "not
checked", never "passed". If the PRD, AGENTS.md and the code disagree, stop and say so in the PR. On Windows, write multi-line
files with Python or an editor (shell here-documents with quotes broke repeatedly) and keep commit messages free of double quotes.
