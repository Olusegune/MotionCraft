# MotionCraft handover (2026-11-24)

Everything needed to carry on from another PC. Owner: Victor Edun. Repository: https://github.com/Olusegune/MotionCraft.
A copy sits at the repository root (`HANDOVER.md`). The older handover (2026-11-23) described a pre-code state and is replaced by this one.

## 0. Start here (about 45 minutes)

1. Install the tools in section 3.
2. `git clone https://github.com/Olusegune/MotionCraft.git`, then `git checkout feat/macos-native`.
   **All current work is on `feat/macos-native` and is pushed. Check whether it has been merged to `main` before assuming `main` is current.**
3. `npm ci`, then run the checks in section 4. They should reproduce the numbers there.
4. Read the user guide first: [USER_GUIDE.md](USER_GUIDE.md) (the walkthrough, with screenshots). Then [ARCHITECTURE.md](ARCHITECTURE.md),
   [UI_UX.md](UI_UX.md), [ENGINE_ADAPTER.md](ENGINE_ADAPTER.md), [stress-test/FINDINGS.md](stress-test/FINDINGS.md) and [TIMELINE_PLAN.md](TIMELINE_PLAN.md).
5. Build and run it (section 4), open the walkthrough in the user guide with your own brief, and decide what to do from section 8.

## 1. What MotionCraft is

The director layer for motion design. A person writes a brief, script or music, and MotionCraft turns it into an editable
[EffectCraft](https://github.com/storytold/effectcraft) project, shows its reasoning, and asks before anything final or paid.

- **Tauri 2 shell** (`src-tauri/`, Rust): window, file access, the spend-token gate, the allow-lists of engine calls, packaging.
- **React 19 + TypeScript UI** (`src/`): pages Brief, Intent, Direction, Treatment, Build, Review, Deliver; state in `project.json`.
- **Python engine helper** (`engine/motioncraft_engine/`, frozen with PyInstaller and bundled as a sidecar): the EffectCraft adapter, the
  Director and Builder agents, QA checks, audio analysis, providers (image models), render jobs.
- **EffectCraft 0.24.1** (a separate app, pinned to commit `7e2d025`) is driven through `effectcraft-cli mcp`. The composition lives only
  in the `.ecproj` file; `project.json` holds intent, approvals, provenance and history. MotionCraft has no compositor of its own.

## 2. What is local to the old PC and NOT in git

| Thing | Where it was | What to do on the new PC |
|---|---|---|
| **API keys** (Kie, Google, OpenAI, fal, BytePlus, Anthropic, OpenRouter) | the operating system's credential store, service name `motioncraft` | **Not transferable.** Re-enter each key in Settings, Image and video providers. They were never in the repository. |
| **Projects and renders** | `Documents\MotionCraft\*.motioncraft` | Copy the folders you want over, or recreate from the briefs in `docs/stress-test/`. Use **File, Open Project Folder** to bring a project in. |
| **Built packages** | `Desktop\Edun's 2nd Claude\MotionCraft_v0.1.5_*` (latest `..._magic-8`) | Not in git. Rebuild (section 5) or copy the folder. |
| **Language model** | Ollama with `gemma3:12b` | `ollama pull gemma3:12b` (it can also see pictures, which the lettering check uses). |
| **EffectCraft** | `C:\Program Files\ArtCraft\EffectCraft\effectcraft-cli.exe` | Install EffectCraft 0.24.1, or set the path in Settings, Engine. |
| **Claude Code memory** | the old PC's `.claude` folder | Not transferable. The working agreement is in section 9. |

## 3. Tools to install

| Tool | Version used | Notes |
|---|---|---|
| Windows 10/11 + WebView2 | | macOS builds exist in CI but have never been run on a Mac |
| Node.js | 24 LTS | `npm ci` |
| Rust | stable, MSVC toolchain | with Visual Studio Build Tools (C++) |
| Python | 3.11 (64-bit) | `pip install pydantic pillow pytest pyinstaller` (add `websockets` to run `scripts/smoke_app.py`) |
| EffectCraft | 0.24.1 | the engine MotionCraft drives |
| Ollama (optional) | | local language model, free |
| GitHub CLI `gh` (optional) | | to download CI artifacts, including the macOS `.dmg` files |

## 4. Check it works

| What | Command | Expect |
|---|---|---|
| Types | `npx tsc --noEmit` | no output |
| UI tests | `npx vitest run` | 181 pass (this includes a check that every link and picture in the README and user guide exists) |
| Engine tests (mock) | `cd engine; python -m pytest -q` | 229 pass, 59 deselected |
| Engine tests (real EffectCraft) | `cd engine; $env:EFFECTCRAFT_CLI="C:\Program Files\ArtCraft\EffectCraft\effectcraft-cli.exe"; python -m pytest -q -m real_engine` | 59 pass. A skip means NOT CHECKED. |
| Rust tests and lints | `cd src-tauri; cargo test; cargo clippy --all-targets -- -D warnings` | 20 pass, clippy clean |
| Run in development | `npx tauri dev` | the app opens with hot reload |
| Smoke test a build | `python scripts/smoke_app.py portable\MotionCraft\MotionCraft.exe` | four PASS lines |

## 5. Build and package

1. `python scripts/build_sidecar.py` builds the engine helper into `src-tauri/binaries/`. **Check its exit code.** If PyInstaller is missing it fails,
   and a stale helper from an earlier day will be bundled silently (this happened once). It needs `pydantic` and `pillow` installed.
2. `npx tauri build` makes the installer (`src-tauri\target\release\bundle\nsis\*.exe`), the `.msi`, and `src-tauri\target\release\motioncraft.exe`.
   `npx tauri build --no-bundle` builds just the app, which is faster.
3. Portable build: copy `motioncraft.exe` to `portable\MotionCraft\MotionCraft.exe`, the helper to `portable\MotionCraft\motioncraft-engine.exe`, and zip the folder
   (`portable/` is git-ignored).
4. **Delivery folders** (the owner's rule): one new folder per build, `Desktop\Edun's 2nd Claude\MotionCraft_v0.1.5_<name>`, never overwriting an older one, holding
   the installer `.exe`, the `.msi`, the portable zip and a codebase zip made with `git archive --format=zip HEAD` (source only). Say which files could not be made.
5. **macOS** cannot be built on Windows. CI builds both (Apple silicon and Intel). Download the artifacts with `gh run download` and say plainly that
   nothing was run on a Mac. CI status: https://github.com/Olusegune/MotionCraft/actions

## 6. Where things are

| For | Look at |
|---|---|
| The flow of a project and its pages | `src/App.tsx`, `src/pages/*.tsx`, `src/shell/*` |
| Make it, looks and scene plans from the script | `src/lib/makeIt.ts`, `src/lib/briefParse.ts` (reads length, shape, timed scripts, fonts) |
| The next-step guide above the stage bar | `src/lib/nextStep.ts` |
| Spend ledger and limits | `src/lib/spend.ts`; the spend token gate is in `src-tauri/src/lib.rs` |
| Pictures for scenes | `src/pages/SceneMaker.tsx` (Make picture), `src/pages/Proposals.tsx`, `engine/.../sidecar.py` (`place_pictures`, `picture_check`) |
| The Builder and its art direction (spheres, lines, timing) | `engine/motioncraft_engine/agents/builder.py` |
| QA checks | `engine/motioncraft_engine/qa/checks.py` |
| The timeline | `src/pages/build/TimelinePanel.tsx`, `src/lib/timelineMath.ts`, [TIMELINE_PLAN.md](TIMELINE_PLAN.md) |
| Styling and tokens | `src/styles/tokens.css` (all colours; none outside it), `src/styles/app.css` |
| Engine call allow-lists | `src-tauri/src/lib.rs` (`ENGINE_METHODS`, `WRITE_METHODS`, `PAID_ENGINE_METHODS`) and `engine/.../adapter/policy.py` |
| CI | `.github/workflows/build.yml` |
| What was found by testing | [stress-test/FINDINGS.md](stress-test/FINDINGS.md) |

## 7. State of the product (2026-11-24)

**Works and verified in the app on Windows:** a brief with a timed script is read (length, shape, 4K, scenes, sound cues); **Make it** drafts the intent,
chooses a look from what the piece is about and writes each scene's plan from the script, with one review; the Builder builds timed text, rimmed
translucent spheres, hairline connections and bright points; scene pictures (made with **Make picture**, or added) go behind each scene, fill the frame, are dimmed
and push in slowly; sound is analysed and its beats become markers; QA runs 16 checks (text overlap, safe area, contrast, missing media, fonts the brief names and
more) and can fix the safe ones; versions, compare, notes, sign-off; a final 4K H.264 render with sound; package export; spend limits (dollars for known prices,
a call count for unpriced providers); the lettering check on pictures (a local model); the yellow interface with a colour for each tool.

**Not verified:** anything on a Mac; the installer and `.msi` have been built but never run on a clean PC; the per-scene pictures depend on the image model and can
come back plain (use **Try another**); EffectCraft cannot say which font a text layer uses, so the "Missing fonts" and "Font licence" checks stay *Not checked*.

**Stress test.** The brief is `docs/stress-test/type-v-civilization-brief.md`. Budget 5 USD; Kie preferred. Total paid use: six Kie stills (Kie publishes no prices, so the
real cost could not be read from the app; at the usual rate it is a few cents). Everything else used a local model and local renders at no cost. Findings and their
status are in `docs/stress-test/FINDINGS.md`.

## 8. Open list, in order

1. **Mac verification**: download the CI artifacts (`.dmg`), run them on a Mac, fix what breaks. Never done.
2. **Run the installer on a clean Windows PC** and use it once end to end. Never done by a person.
3. **Picture quality**: pictures depend on the model. Ideas: a stronger default image model, a few automatic retries when the lettering check fires, a style reference image.
4. **First run** is a hint plus a "Next" line above the stage bar, not an interactive tour.
5. **Offer a link to install a missing font** (the QA message names it; no in-app link, because the app has no general way to open web links).
6. **Interoperation** with After Effects, Fusion and others is only planned: [INTEROP_PLAN.md](INTEROP_PLAN.md).
7. **Agentic mode** (a person supplies script, story and assets; the agent makes the piece) is partly there: Make it and the Builder. The audio-first and asset-aware planning is not.

## 9. How the owner likes to work (carry this into any new session)

- Full autonomy on UX, architecture and engineering; the owner brings taste. Decide and ship; ask only for real decisions or any spending beyond the 5 USD test budget.
- Sleek, a little futuristic, easy to use. Pictures everywhere beat clever layout. Yellow accent; each tool icon its own colour.
- Be honest in reports: what passed (with counts), what failed, what was not checked, what was not tested on a Mac.
- Every build gets its own delivery folder (section 5). Never overwrite an older one.
- Never type API keys into the app; keys are re-entered by the owner. Spend only through the app's own confirmation sheet.

## 10. Gotchas that cost time

- **PyInstaller exit code** (section 5). Never pipe `build_sidecar.py` into `tail` without checking the exit status.
- **Backslash escapes in generated code.** A `\n` or `\b` written through a shell here-document can become a real newline or a backspace character in the file.
  Write edit scripts to a file with an editor tool, or check the result (`grep -c $'\x08' file`).
- **A blanket CSS rule once overrode `position: fixed`** and put every dialog at the bottom of the page. `qa.test.tsx` now guards it.
- **Native file dialogs** accept typing only in the File name box; navigate folders by clicking, or type a full folder path there and press Enter.
- **`npx tauri dev` hot reload** is fastest for UI work; the engine helper must be rebuilt for engine changes.
- **After a rebuild, the first click into the app can be refused** while Windows shows the desktop in front; bring the app window to the front first.
- **`.gitignore` has `/portable/`**: never commit built binaries.
- **EffectCraft's real adapter is stricter than the mock.** Add a real-engine test (`-m real_engine`) for anything that touches engine commands, and keep the mock's accepted parameters in step.
