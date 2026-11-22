# Repositories, pins and reuse map

Checked on 2026-11-22 by reading each repository at the commit below. Clone siblings next to this repo:

```
git clone https://github.com/Olusegune/MotionCraft
git clone https://github.com/Olusegune/FilmCrafter3
git clone https://github.com/Olusegune/Pulseframe-Music-Video-Maker      # private: needs access
git clone https://github.com/storytold/effectcraft
```

## Required

| Repo | Pinned commit | Version | Licence | Stack |
| --- | --- | --- | --- | --- |
| [storytold/effectcraft](https://github.com/storytold/effectcraft) | [`7e2d025`](https://github.com/storytold/effectcraft/commit/7e2d0256209974ffb92a29d8bdb6f2a49078f51f) | 0.24.1 (alpha) | MIT OR Apache-2.0 | Rust 1.95+, egui; apps `effectcraft`, `effectcraft-cli`, `effectcraft-web` |
| [Olusegune/FilmCrafter3](https://github.com/Olusegune/FilmCrafter3) | [`ac99ec9`](https://github.com/Olusegune/FilmCrafter3/commit/ac99ec977c4b5896874dea7d63a7682ec0c82900) | 0.57.0 | UNLICENSED (yours) | Tauri 2, React 19, TS ~6.0, Vite 8, Vitest, Playwright, Python engine |
| [Olusegune/Pulseframe-Music-Video-Maker](https://github.com/Olusegune/Pulseframe-Music-Video-Maker) (private) | [`a0ee7ec`](https://github.com/Olusegune/Pulseframe-Music-Video-Maker/commit/a0ee7ece663df9e68368c27268e6d10d6c254d7b) | 1.61.2 | yours | Same as FilmCrafter3; analysis in Python (librosa, faster-whisper, demucs) |

Full SHAs (put the EffectCraft one in `engine/effectcraft.lock`):

```
effectcraft     7e2d0256209974ffb92a29d8bdb6f2a49078f51f
FilmCrafter3    ac99ec977c4b5896874dea7d63a7682ec0c82900
Pulseframe      a0ee7ece663df9e68368c27268e6d10d6c254d7b
```

## Later (contract only in v1, nothing installed)

| Repo | Use |
| --- | --- |
| [Olusegune/productionOne](https://github.com/Olusegune/productionOne) | ProducerOne: brief/asset hand-off into the Brief screen through the package contract |
| [Olusegune/Greenroom_Local](https://github.com/Olusegune/Greenroom_Local) | Greenroom Local: same contract |
| [Olusegune/VoiceStudio](https://github.com/Olusegune/VoiceStudio) | Candidate sound step for the suite (it is a fork; check its upstream licence before reuse) |

## What to reuse, file by file

Copy by hand and record every copied file in `docs/PORT_LEDGER.md` (source repo, commit, path, what changed) — the
same practice FilmCrafter3 uses. Do not add a git submodule of FilmCrafter3 or Pulseframe.

### From FilmCrafter3 (shell, safety, money, models)

| Need | Source path | Notes |
| --- | --- | --- |
| App skeleton | `package.json`, `vite.config.ts`, `tsconfig*.json`, `playwright.config.ts`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/` | Rename identifiers to `com.motioncraft.app` |
| Design system | `src/ui-system.css`, `src/studio-shared.css`, `src/focus.css` | Port the control patterns, then remap tokens to [UI_UX.md](UI_UX.md) §10: FilmCrafter3 is amber (`--amber`; its focus ring hard-codes `rgba(232,180,92,…)`), MotionCraft is cyan on neutral graphite. Control height 34 → 36. Do not port `icons.tsx` or `glyphs.tsx`: MotionCraft uses Lucide |
| Dialogs | `src/Sheet.tsx` | Every dialog uses it |
| Command palette, UI scale | `src/Palette.tsx`, `src/Command.tsx`, `src/shortcuts.ts`, `src/uiScale.ts` | Register the palette shortcut in the registry; UI scale 90–250% for Windows display scaling |
| Main-action dock, nav rules | `src/Dock.tsx` (`DockBar`, `Cta` with a price), `src/FilmRail.tsx` (rule: a tool that cannot act is greyed with its reason, never hidden), `src/App.tsx` (layout only) | MotionCraft navigates with the bottom stage bar, not FilmCrafter3's left rail ([UI_UX.md](UI_UX.md) §4). Reuse the dock and the grey-with-reason rule |
| Approvals / agent inbox | `analysis/filmcrafter_engine/agent_studio.py`, `src/AgentStudio.tsx`, `docs/AGENT_STUDIO.md`, `docs/architecture/ADR-AGENT-STUDIO.md` | Model for gates A–D and the approval inbox |
| Spend gate (S-01) | `src-tauri/src/lib.rs` → `confirm_spend` and the token check; `src/SpendingSheet.tsx`; `analysis/filmcrafter_engine/paidops.py`, `spending.py`; the `spendgate` test | Keep the token rule exactly |
| Keys | `src-tauri/src/lib.rs` keyring helpers (`KEY_SERVICE`), `provider_env_only` | Service name `motioncraft` |
| Python sidecar launch | `src-tauri/src/lib.rs` → `engine_python`, `env_python`, the engine install path | |
| LLM router | `analysis/filmcrafter_engine/llm.py`, `localmodels.py`, `routing.py`, `router.py`, `model_capabilities.py` | OpenAI, Anthropic, OpenRouter, Gemini, Ollama, LM Studio over the OpenAI API. Add Inkling as another OpenAI-compatible local endpoint |
| Safe names and IO | `analysis/filmcrafter_engine/safe.py`, `safeio.py` | |
| Backups | `analysis/filmcrafter_engine/filmbackup.py`, `src/Backups.tsx` | Basis for the 30 s autosave target; FilmCrafter3 has backups, not a timed autosave, so autosave is new work |
| Font licence data | `analysis/filmcrafter_engine/fonts.py`, `src/FontPicker.tsx` | Check what licence data exists before building QA font checks |
| Reference only | `analysis/filmcrafter_engine/motion_templates.py`, `layerkit.py`, `src/MotionGraphics.tsx` | FilmCrafter's own title/lower-third templates. Useful as content ideas for primitives; they draw with FilmCrafter's renderer, not EffectCraft, so do not port the code |
| Do not reuse | `analysis/filmcrafter_engine/upscale.py` | It reaches Topaz through Kie.ai/fal. MotionCraft uses the official Topaz CLI/API only |

### From Pulseframe (audio)

| Need | Source path | Notes |
| --- | --- | --- |
| Song analysis | `analysis/pulseframe_analysis/analyze.py` | `SongMap` schema v1: `bpm`, `beats`, `downbeats`, `energy_curve`, `accents`, `sections` (label, group, energy 1–10, mood), `lyrics` (word timing via faster-whisper), `peaks`. Emits JSON-line progress on stdout |
| Tests | `analysis/tests/` (analysis tests), `analysis/make_test_song.py` | Synthetic song for deterministic tests |
| Requirements | `analysis/requirements.txt` | librosa 0.11, numpy 2.4, scipy, soundfile; faster-whisper/demucs optional |
| Disclosure component | `src/Fold.tsx` | FilmCrafter3 has no `Fold`; port it from here |

Plan (ticket P3-01): extract `analyze.py` into a shared, pip-installable package (proposed new repo
`Olusegune/wheelbarrow-audio`, not created yet) that Pulseframe, FilmCrafter3 and MotionCraft all pin. Until it exists,
vendor it under `engine/vendor/pulseframe_analysis/` with a PORT_LEDGER entry. MotionCraft must add: silence
detection, transient list, narration word timings, and a converter from `SongMap` to EffectCraft comp markers.

### From EffectCraft (engine — use, never fork)

| Need | Where in effectcraft | Notes |
| --- | --- | --- |
| Agent entry points | `README.md` → "Built for agents"; `docs/agents.md`; `docs/mcp.md`; `docs/control-protocol.md` | Read all four before writing the adapter |
| MCP config example | `.mcp.json` | |
| CLI | `apps/effectcraft-cli` | `effectcraft-cli mcp [--bridge 9877]`, `exec`, `set`, `render`, `run`, `commands` |
| Project format | `crates/project`, `docs/file-format-parity.md` | `.ecproj` is versioned JSON |
| Readiness | `ROADMAP.md` | Alpha; "ready for real work" ≈ 45% (40–50%) as of 2026-11-15 |
| Gaps | `docs/gaps.md`, `docs/effects-parity.md` | Check before promising a primitive |

## Not found

The PRD says to reuse "Motion Studio's multi-provider router". No Motion Studio repository is among the
accessible repos. FilmCrafter3's `llm.py` + `routing.py` is the router to extend instead (see ADR-0004). If Motion
Studio's code lives elsewhere, add its link here.
