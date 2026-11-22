# MotionCraft: notes for coding agents

MotionCraft = Tauri 2 shell (`src-tauri/`) + React/TS UI (`src/`) + Python engine (`engine/motioncraft_engine/`)
+ EffectCraft driven through `effectcraft-cli mcp`. The repository is at **pre-Phase 0**: there is no code yet.
Your first work is [docs/PHASE0_SPIKE.md](docs/PHASE0_SPIKE.md), then [docs/BACKLOG.md](docs/BACKLOG.md) in order.

## Read before writing code

1. [docs/PRD.md](docs/PRD.md) — scope and non-negotiables.
2. [docs/REPOS.md](docs/REPOS.md) — where to copy from, at which commit. Clone the sibling repos next to this one.
3. [docs/ENGINE_ADAPTER.md](docs/ENGINE_ADAPTER.md) and [docs/PROJECT_SCHEMA.md](docs/PROJECT_SCHEMA.md) — the
   two contracts everything else depends on.
4. The ticket you are working on in [docs/BACKLOG.md](docs/BACKLOG.md). Work one ticket per branch and PR.
5. For any UI work: [docs/UI_UX.md](docs/UI_UX.md).

## Hard rules (a PR that breaks one is not mergeable)

- **The `.ecproj` file is the only store of composition data.** Never mirror the layer tree, keyframes or
  properties into `project.json`. MotionCraft stores intent, bindings, approvals, provenance, QA and history only.
- **Every engine call goes through the adapter** (`engine/motioncraft_engine/adapter/`). No other module talks to
  `effectcraft-cli`, the control port or the MCP server.
- **Locked layers are untouchable by agents.** The adapter refuses any command whose targets include a layer with
  `lock: "approved"`, before sending it. Add a test whenever you add a command that can target layers.
- **Drift is logged, never overwritten.** If a layer hash differs from the stored hash, record a user revision.
- **Money:** any provider call that costs money and every final render needs a confirmation token obtained from a
  user click (port FilmCrafter3's `confirm_spend` pattern, S-01). No code path may queue paid work without one.
  Register every new paid path in the spend-gate test list.
- **Official APIs or file import only.** No unofficial wrappers or resellers (no Suno via Kie.ai, no scraping).
  Topaz = the local Topaz Video AI CLI or Topaz's own API — not via Kie or fal.
- **Manual mode works with no AI provider configured.** Never make an AI call a prerequisite for a screen.
- **Keys live only in the OS credential store** (`keyring` crate, as FilmCrafter3). Pass the narrowest set of keys
  to a child process. Never log or write keys.
- **EffectCraft is pinned** to the commit in `engine/effectcraft.lock` (see REPOS.md). Upgrading = a PR that only
  bumps the pin and passes the adapter contract tests against the real engine.
- **Confine the engine.** Always start `effectcraft-cli mcp` with `--automation-read-root` and
  `--automation-write-root` set to the project package folder (and the asset cache). Never expose the control port
  beyond `127.0.0.1`, and only open it while a bridged session is live (it has no authentication).
- **Native, editable text.** Never bake essential text into an image.
- **No style is the default identity.** Do not hard-code a house look.
- **Names from outside go through a sanitiser before becoming paths** (port `safe.py`). No `shell=True`, `eval`,
  `innerHTML`.

## Commands (once scaffolded; mirror FilmCrafter3)

```
npm ci
npm run tauri dev
npx tsc --noEmit
npx vitest run
npx playwright test
cd engine && python -m pytest -q                       # uses the mock adapter
cd engine && python -m pytest -q -m real_engine        # needs EFFECTCRAFT_CLI=path/to/effectcraft-cli
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
npm audit && npm run build
```

CI runs everything against the **mock adapter**; the `real_engine` marker runs nightly and before any EffectCraft
pin bump.

## How to report work

- PR description: what changed, which ticket, which acceptance tests it moves, and a **"Not checked"** list.
- Report test counts honestly. A skipped real-engine test is "not checked", not "passed".
- If the PRD, this file and the code disagree, stop and say so in the PR instead of choosing.
- UI changes: follow [docs/UI_UX.md](docs/UI_UX.md) (tokens, fonts, Lucide icons, gates, modes). FilmCrafter3 supplies
  patterns (shared `Sheet` dialogs, pinned main-action dock), not its amber look; `Fold` comes from Pulseframe
  (`src/Fold.tsx`). Update component and e2e tests.
- Windows: write multi-line files via Python, not PowerShell `Set-Content -Encoding Byte`; commit messages without
  double quotes.
