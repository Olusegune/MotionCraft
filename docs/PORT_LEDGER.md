# Port ledger

Every file copied from another repository, so fixes can be ported both ways. Add a row in the same PR as the copy.

| Date | Source repo @ commit | Source path | MotionCraft path | Changes |
| --- | --- | --- | --- | --- |
| 2026-11-22 | FilmCrafter3 @ ac99ec9 | `analysis/filmcrafter_engine/render.py` (BYTEPLUS_MODELS, GOOGLE_MODELS, OPENAI_IMAGE_MODELS, MJ_MODELS, `_kie_index`, `KIE_NOT_A_GENERATOR`, fal `/v1/models` listing, Fal/Kie/BytePlusImages request flows) | `engine/motioncraft_engine/providers/registry.py`, `clients.py` | Model lists and prices copied by hand; discovery and client flows re-written on urllib with a host allow-list, no `requests`, no env keys; Google and OpenAI clients written from the providers' docs |
| 2026-11-22 | FilmCrafter3 @ ac99ec9 | `analysis/filmcrafter_engine/registry.py` (rules: never remove, mark not listed, failed discovery changes nothing) | `engine/motioncraft_engine/providers/registry.py` | Idea and rules only; image and video media only |
| 2026-11-22 | FilmCrafter3 @ ac99ec9 | `src-tauri/src/lib.rs` (`confirm_spend` pattern, keyring helpers) | `src-tauri/src/lib.rs` | Re-written: single-use 5 min token, key service `motioncraft`, keys never returned to the page |
