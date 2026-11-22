# Open questions

Each has a recommended default so work is not blocked. A coding agent uses the default and flags it in its PR;
Victor confirms or changes it here.

| # | Question | Recommended default | Why | Blocks |
| --- | --- | --- | --- | --- |
| 1 | Target hardware for preview targets | Windows 11, NVIDIA RTX 3060-class 12 GB, 32 GB RAM, NVMe | FilmCrafter3 and Pulseframe already assume NVIDIA on Windows | P2-10 gate |
| 2 | Launch platforms | Windows first; macOS after Phase 0 proves the macOS build | FilmCrafter3 is "Windows (macOS to be proven)" | P0-01, P1-01 |
| 3 | FilmCrafter3's stack | **Confirmed:** Tauri 2, React 19, TS ~6.0, Vite 8, Vitest, Playwright, Rust shell, Python 3.11 engine | Read from FilmCrafter3 0.57.0 | — (closed) |
| 4 | Providers for generated backgrounds/textures; default cost cap | None in v1 (import only); cap $10 per project, approval above $1 per call | Keeps v1 within the wedge; generation is out of scope as primary output | P1-05 |
| 5 | Standalone, bundle, or both | Both (matches the Grad Central Station plan) | No code impact in v1 beyond the package contract | — |
| 6 | Golden-brief reviewers | Victor + one motion-design colleague | Needs a name before P5-06 | P5-06 |
| 7 | Apply to Suno's developer programme | Yes, apply now; import-only until granted | Approval takes time; no code waits on it | — |
| 8 | Voice Studio as the suite's sound step | Not in v1; keep the Sound interface generic | Contract allows it later | — |
| 9 | Topaz licensing | User's own Topaz licence for the local CLI; Topaz API with the user's own key | No resale billing to build | P4-03 |
| 10 | Primitive launch size | 100 (40 by end of P2-02) | PRD working target | P2-03 |
| 11 | Shared audio package home | New repo `Olusegune/wheelbarrow-audio` pinned by all three apps; vendor until it exists | PRD: "shared, not copied" | P3-01 |
| 12 | Motion Studio router | Use FilmCrafter3 `llm.py`/`routing.py` (no Motion Studio repo found) | ADR-0004 | P1-05 |
| 13 | Release gate test count | 19 (roadmap diagram says 15) | The acceptance list has 19 | P5-06 |
