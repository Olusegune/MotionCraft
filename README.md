# MotionCraft

MotionCraft is the **director layer for motion design**. It turns a brief, script or music track into an editable
[EffectCraft](https://github.com/storytold/effectcraft) project, shows its creative reasoning, and asks for approval
before anything expensive or final. Hand-editing happens in EffectCraft; MotionCraft owns intent, style, approvals,
provenance, QA and review.

> MotionCraft is an internal codename. Status: **working app for Windows** (macOS builds are made by CI and have not been run on a Mac). New here? Read the
> **[User guide and walkthrough](docs/USER_GUIDE.md)**: it takes one brief from an empty project to a finished 4K video, with screenshots.

v1 wedge: typography-led, music-synced 2D/2.5D motion (kinetic type, titles and credits, logo animation, lyric
videos, music-driven sequences, social motion, simple 2D explainers).

## Start here (people and code agents)

| Read | Why |
| --- | --- |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | **The walkthrough with screenshots**: install, first project, every stage, spending, troubleshooting |
| [AGENTS.md](AGENTS.md) | Rules, commands and workflow for any coding agent (Claude Code reads it through `CLAUDE.md`) |
| [docs/PRD.md](docs/PRD.md) | What v1 is, in full |
| [docs/REPOS.md](docs/REPOS.md) | Every repository, pinned commit, and exactly which files to reuse |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Processes, modules, data flow |
| [docs/UI_UX.md](docs/UI_UX.md) | UI/UX brief: shell, gates, control modes, tokens, fonts, icons, states |
| [docs/ENGINE_ADAPTER.md](docs/ENGINE_ADAPTER.md) | The adapter contract, mapped to EffectCraft's MCP tools and commands |
| [docs/PROJECT_SCHEMA.md](docs/PROJECT_SCHEMA.md) | `project.json`, the `.motioncraft` package, primitives |
| [docs/PHASE0_SPIKE.md](docs/PHASE0_SPIKE.md) | The two-week go/no-go plan, with commands |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Every v1 ticket by phase, with acceptance criteria |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | The 19 automated tests and the golden-brief rubric |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Product decisions still open, each with a recommended default |
| [docs/adr/](docs/adr/) | Architecture decision records |

## Repositories

| Repo | Role | Required |
| --- | --- | --- |
| [Olusegune/MotionCraft](https://github.com/Olusegune/MotionCraft) | This app | yes |
| [Olusegune/FilmCrafter3](https://github.com/Olusegune/FilmCrafter3) | Shell, design system, approvals, spend gate, autosave, LLM router | yes |
| [Olusegune/Pulseframe-Music-Video-Maker](https://github.com/Olusegune/Pulseframe-Music-Video-Maker) (private) | Audio analysis (`SongMap`) to extract into a shared package | yes |
| [storytold/effectcraft](https://github.com/storytold/effectcraft) | Compositor and renderer, driven through CLI / MCP | yes |
| [Olusegune/productionOne](https://github.com/Olusegune/productionOne) | ProducerOne: planning hand-off | later, contract only |
| [Olusegune/Greenroom_Local](https://github.com/Olusegune/Greenroom_Local) | Greenroom Local | later, contract only |
| [Olusegune/VoiceStudio](https://github.com/Olusegune/VoiceStudio) | Possible future sound step | later |

Pinned commits and reuse map: [docs/REPOS.md](docs/REPOS.md).

## Planned stack

Tauri 2 (Rust) shell · React 19 + TypeScript + Vite UI · Python engine sidecar (agents, audio analysis, adapter) ·
EffectCraft `effectcraft-cli mcp` as a child process. Windows first, macOS second. Same toolchain as FilmCrafter3.

## Source PRD

The living PRD is the MotionCraft v1 PRD artifact; [docs/PRD.md](docs/PRD.md) is its repository copy as of
2026-11-22. When they differ, raise it — do not silently pick one.
