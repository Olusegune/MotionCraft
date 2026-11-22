# ADR-0002: Reuse FilmCrafter3's stack and shell by porting, not linking

Status: accepted · Date: 2026-11-22

## Context
FilmCrafter3 (0.57.0) is Tauri 2 + React 19 + TypeScript + Vite with a Rust shell and a Python engine sidecar. It
already has the dark graphite design system, `Sheet` dialogs, command palette, approval inbox (Agent Studio),
keychain storage, the `confirm_spend` token gate (S-01) and an LLM router. FilmCrafter3 itself was seeded from
Pulseframe by copying and keeps a `PORT_LEDGER.md`.

## Decision
MotionCraft uses the same stack and ports the listed files by hand (see REPOS.md), logging each in
`docs/PORT_LEDGER.md`. No submodule or runtime dependency on FilmCrafter3.

## Consequences
- Familiar code for the same author; shared look across the suite.
- Fixes must be ported by hand in both directions; the ledger makes that traceable.
- A future shared UI package can replace the copies once two apps prove the same components.
