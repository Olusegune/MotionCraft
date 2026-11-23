# MotionCraft handover — 2026-11-23

Everything needed to continue on another PC. Owner: Victor Edun. Repo: https://github.com/Olusegune/MotionCraft.
A copy of this note is also at the repo root (`HANDOVER.md`) and, once merged, on `main`. Until PR 1 and the stack are merged,
**`main` contains only the README**: the code and docs live on branches (section 2).

## 0. Start here (about 30 minutes)

1. Install the tools in section 3.
2. `gh auth login`, then `git clone --branch docs-interop-plan https://github.com/Olusegune/MotionCraft.git`
   (`docs-interop-plan` is the newest branch and contains everything; `main` does not).
3. `cd MotionCraft; npm ci`, then build the helper and run the checks in section 4. They should reproduce the numbers there.
4. Read, in this order: `AGENTS.md`, `docs/PRD.md`, `docs/UI_UX.md`, `docs/ENGINE_ADAPTER.md`, `docs/PHASE0_REPORT.md`,
   `docs/UX_REVIEW.md`, `docs/INTEROP_PLAN.md`, `docs/adr/` (0001, 0005, 0006).
5. Install the latest installer on a clean PC and use it. **This has never been done by a person**: it is the biggest unverified
   risk (section 7).

## 1. What MotionCraft is

The director layer for motion design. Tauri 2 shell (`src-tauri/`, Rust) + React 19 / TypeScript UI (`src/`) + a Python engine
helper (`engine/motioncraft_engine/`, frozen with PyInstaller and bundled as a sidecar) that drives **EffectCraft** (a separate
Rust motion-graphics app, pinned to commit `7e2d025`, version 0.24.1) through `effectcraft-cli mcp`. MotionCraft stores intent,
approvals, provenance and history in `project.json`; the composition lives only in the `.ecproj` file. Detailed editing happens
in EffectCraft; MotionCraft has no compositor of its own.

## 2. Where everything is

| Thing | Location |
| --- | --- |
| Code and docs | GitHub `Olusegune/MotionCraft`, newest branch `docs-interop-plan` (everything is pushed; nothing is merged) |
| Installers | Built by CI on every PR (Windows setup `.exe`, `.msi`, portable zip; macOS `.dmg` for Apple silicon and Intel). Latest green run with installers: Actions run **45101892053** on branch `p1-splash-fix`. Download with `gh run download 45101892053 --repo Olusegune/MotionCraft`. The old PC also has `Desktop\MotionCraft_Build\` (not transferable) |
| Brand art (app icon, document icon, splash, 21:9 splash) | `brand/` |
| Original mockup images | `Downloads\` on the old PC only (not in the repo): copy them if wanted |
| Phase 0 evidence | `spike/` scripts, `spike/results/`, `docs/PHASE0_REPORT.md` |
| Read-only sibling repos (never push to them) | `storytold/effectcraft` @ `7e2d0256209974ffb92a29d8bdb6f2a49078f51f`; `Olusegune/FilmCrafter3` @ `ac99ec977c4b5896874dea7d63a7682ec0c82900`; `Olusegune/Pulseframe-Music-Video-Maker` @ `a0ee7ece663df9e68368c27268e6d10d6c254d7b` (private) |

**Not in the repo and not transferable:** provider API keys (they live in the operating system credential store under service
`motioncraft`; enter them again in Settings), the GitHub login, your Rafter API key and its fast-scan quota (used up for this
billing period, so `rafter run` fails until it resets), and any Claude session memory.

### Pull requests and merge order

Bottom to top; each is based on the one before it.

1. **PR 1** docs (`docs/v1-agent-docs` → `main`). Merge first.
2. **PR 2** app shell → **18** adapter wiring → **19** providers → **20** menus and UX → **21** visual workspace → **22** playback,
   layers, motion, audio, proposals, render → **23** splash → **24** After Effects and Resolve plan (docs only).
   Merging only PR 24 after PR 1 brings in all of them.
3. **PRs 3 to 17** are the Phase 0 tickets (P0-01 to P0-15), stacked on each other. PR 18 already contains their content, so close
   them as "included" after PR 18 lands, or merge in order for history.

Each PR body lists what was and was not checked. **Auto-fix is enabled** on this session's PRs in the desktop app: it watches CI
and merge conflicts; on another PC that watching does not follow you.

## 3. Install on a new Windows PC

Git, GitHub CLI (`gh`), Node 22, Rust (stable, MSVC toolchain), Visual Studio Build Tools (C++ workload), Python 3.11, WebView2
runtime (included in Windows 11), and **EffectCraft 0.24.1** (its MSI installs to `C:\Program Files\EffectCraft`; the app also finds
it on PATH or via Settings, Browse). Optional: `ffmpeg` and `ffprobe` on PATH (non-WAV audio, and the render tests).
macOS cannot be built on Windows: push a branch and let CI build it, or build on a Mac with `npx tauri build`.

## 4. Build, test, run

```powershell
python -m venv build\venv
build\venv\Scripts\python -m pip install pyinstaller pydantic pytest pillow
npx tsc --noEmit
npx vitest run                                   # 55 tests passed at handover
cd engine; python -m pytest -q; cd ..            # 90 passed on the mock engine
cd src-tauri; cargo test; cd ..                  # 12 passed, 3 ignored (they need a real machine)
npm audit                                        # 0 vulnerabilities
```

Against the real engine (needs EffectCraft installed):

```powershell
$env:EFFECTCRAFT_CLI = "C:\Program Files\EffectCraft\effectcraft-cli.exe"
cd engine; python -m pytest -q -m real_engine; cd ..     # 45 passed on the installed release and on the pinned build
cd src-tauri
$env:MOTIONCRAFT_ENGINE_DIR = "$PWD\..\engine"            # dev builds only: run the helper from source
cargo test -- --ignored                                  # detection, helper round trip, motion + draft + final render
```

Build and run:

```powershell
build\venv\Scripts\python scripts\build_sidecar.py       # REQUIRED before tauri build: makes src-tauri\binaries\motioncraft-engine-<triple>.exe
npx tauri build                                          # installers in src-tauri\target\release\bundle\
npx tauri build --no-bundle                              # just target\release\motioncraft.exe (faster)
npm run dev                                              # web UI only, http://127.0.0.1:1420 (no engine, no file dialogs)
```

## 5. How the pieces connect

- **UI** (`src/`): pages in `src/pages/`, shell in `src/shell/`, tokens in `src/styles/tokens.css` (no raw hex elsewhere; a test
  enforces it), logic in `src/lib/` (`project.ts` gates and revisions, `layers.ts` drift, `api.ts` the only door to the desktop
  shell; in a browser it falls back to local storage and reports the engine as missing).
- **Shell** (`src-tauri/src/lib.rs`): project packages in `Documents\MotionCraft\*.motioncraft`, menus, splash with real progress,
  key storage, spend tokens, engine locator, and `engine_call`, which relays a **closed list** of methods to the helper. Every
  command is `#[tauri::command(async)]`: a plain sync command runs on the UI thread and froze the window for 5 s at startup.
- **Helper** (`engine/motioncraft_engine/sidecar.py`): JSON lines over stdin/stdout, using the **adapter** (`adapter/base.py`,
  `real.py`, `mock.py`, `policy.py`) for everything touching EffectCraft; also `primitives/library.py` (10 motions), `audio.py`,
  `renderjobs.py` (draft movie and final render on their own engine process), `providers/` (image and video generation).
- **Contract tests**: `engine/tests/adapter_contract/`, on the mock in CI and on the real engine with `-m real_engine`. The pinned
  command list is `engine/tests/fixtures/effectcraft_commands.7e2d025.json`.

## 6. Rules that must not be broken (AGENTS.md, in short)

Composition data only in the `.ecproj`. Every engine call goes through the adapter. Approved (locked) layers are untouchable by
agents (the adapter refuses before sending; EffectCraft's own lock is weak). Any paid call and every final render needs a
single-use spend token from a user click (`generate_start` and `render_start` are the paid methods, covered by a Rust test). Keys
only in the OS credential store. Confine the engine to the project folder. Native editable text. Everything works in Manual mode
with no AI provider. **ADR-0005:** image and video generation may use Kie.ai and fal as opt-in providers next to BytePlus, Google
and OpenAI; music and voice via Kie.ai, and Topaz via Kie or fal, stay banned. The global `~/.claude/CLAUDE.md` also requires a
Rafter review (`rafter-code-review` plus `rafter run`) before declaring work done that touches files, shell, network, keys or
dependencies; `rafter run --mode plus` is paid, so ask first.

## 7. Where the project stands

By `docs/BACKLOG.md` the project is formally in **Phase 1 (foundation)**; slices of Phases 2 to 5 exist.

**Done and verified:** Phase 0 spike (conditional GO); adapter, mock and contract suite; seven-stage shell with gates and modes;
projects, menus, splash, settings; EffectCraft auto-detection; Build page on the real engine; media import, wall, moodboard,
storyboard; draft movie player; shapes, solids, media layers; 10 motion presets; WAV beats; direction proposals; final render;
collected project export; provider registry (17 built-in models plus Kie.ai discovery, 157 models checked live).

**Not checked anywhere:** installing and uninstalling the installers; the draft movie playing inside the installed app; the
Documentation button on the splash; every menu item clicked in the packaged app; anything on macOS; any paid provider call (no
keys were available; clients are tested only against a local fake server); audio inside renders; beat grids on real music; a real
screen reader; contrast measured in the rendered app; opening an exported `.aep` in After Effects.

**Facts worth remembering:** the installed EffectCraft 0.24.1 release is **not byte-identical** to the pinned commit (763 vs 766
commands, 7 schemas differ, `render_preview` has no `times`); `--version` cannot tell them apart; the adapter handles what the app
uses and the real-engine suite passes on both. Layer ids are unique, not sequential, and stable across save and reopen.
EffectCraft's native lock stops very little. A second process saving the `.ecproj` while its GUI is open is silently lost, so
MotionCraft is read-only while an EffectCraft window it launched is open. Two clean Windows builds of the pinned EffectCraft gave
different binaries (reproducible build, Phase 0 criterion 7, is unresolved).

## 8. Decisions waiting for Victor, and my recommendations

1. **After Effects and Fusion: hand-off targets or full alternative editors?** Recommended: **hand-off targets**. EffectCraft
   already writes and reads `.aep` files, so After Effects hand-off is the cheapest big feature (days if the files open cleanly).
   Full editors would need a second adapter and contract suite and would break "the `.ecproj` is the only home of composition
   data": a different product. Cost of hand-off: MotionCraft cannot enforce approvals or locks inside the other editor; only an
   `.aep` import brings edits back (as a new revision); Resolve and Fusion give back rendered media only. ADR-0006 is proposed.
2. **First check (P6-01, about a day):** open the `.aep` that `file.exportAep` writes in After Effects 2025. EffectCraft's notes say
   2026 opens it; 2025 is unverified.
3. **Fusion:** start with rendered ProRes 4444 clips with alpha on the Fusion page (any Resolve edition). Do not promise generated
   Fusion comps or live control until you know whether Resolve is the free or **Studio** edition (only Studio can be scripted from
   outside). Is it the Fusion page inside Resolve, or Fusion Studio?
4. **Phase 0 sign-off items:** the hand-edit test (P0-07, steps in `docs/PHASE0_REPORT.md`); a Mac run of the P0-01 build; a look at
   `spike/results/c6_*.png` (Arabic and Hebrew text, per-letter weight).
5. **Templates page** deferral, and the stage-mode defaults marked "proposed" in `docs/UI_UX.md` section 4.3.
6. **Sequence I recommend:** (a) install and use the installer on a clean PC, (b) the language-model router and the agents (what
   makes this a director tool and not a form-filler), (c) After Effects hand-off P6-01 to P6-03, (d) Resolve and Fusion.

## 9. Suggested next steps (most valuable first)

1. Merge PR 1 and the stack; tag a release; install on a clean PC; watch the draft movie play (if it does not, check the asset
   protocol scope and the codec first).
2. Language-model router (port FilmCrafter3 `llm.py`, `routing.py`; add Inkling): unlocks Assisted and Agent-led (P1-05).
3. The agents (Director, Builder, QA) and the intent rule-table editor (P1-08 to P1-10, P2-08).
4. P6-01 After Effects spike, then P6-02 and P6-03.
5. Primitive library toward ~100 (P2-02, P2-03), camera moves, style families as data (P2-04).
6. QA tier-1 checks and the compare view (P4-02, P4-05); render cancel and resume (P5-02).
7. Audio sections, word timings, Pulseframe package (P3-01); ElevenLabs and music import with licence notes (P3-05).
8. Autosave kill test, crash recovery sheet, revision snapshots wired to compare (P1-06, P1-13).
9. Reproducible builds: pin the toolchain, try `/Brepro` and path remapping.

## 10. Gotchas learned the hard way

- Build the sidecar (`scripts\build_sidecar.py`) before `tauri build`, or the bundle fails or the app has no engine helper.
- A `build/` line in `.gitignore` once silently excluded `src/pages/build/` from a commit and broke CI: ignore rules are anchored
  (`/build/`).
- Sync Tauri commands block the UI thread. Keep `#[tauri::command(async)]` on anything that can wait (starting programs, copying
  files, the engine).
- `python -I` ignores environment variables (so `PYTHONIOENCODING` does nothing): use `python -X utf8`.
- Shell here-documents with quotes broke repeatedly on Windows: write multi-line files with an editor or a small Python script, and
  keep commit messages free of double quotes (also in AGENTS.md).
- The installed EffectCraft is not the pinned build; always run the real-engine suite on both before trusting a result.
- CRLF warnings from git on Windows are harmless.
- Rafter's fast scan is limited to one per billing period; the manual `rafter-code-review` checklist was used for most PRs.

## 11. Working agreements

One ticket per branch and PR using `.github/pull_request_template.md`. Report test counts honestly; a skipped test is "not
checked", never "passed". If the PRD, AGENTS.md and the code disagree, stop and say so in the PR.

## 12. What is on the old PC (in case you need it)

`C:\Users\eduni\code\`: `MotionCraft` (main working copy), `MotionCraft_p0` (git worktree for the Phase 0 spike branches),
`effectcraft`, `FilmCrafter3` and `Pulseframe-Music-Video-Maker` (pinned reading copies), `_spike_work` (scratch output), `_ci_artifacts*`
(downloaded installers), `_assets_extract` (your mockup zip). `Desktop\MotionCraft_Build\` holds the latest installers and source zip.
Nothing there is needed if the repo and the CI artifacts are reachable.
