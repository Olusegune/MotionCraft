# ADR-0004: Provider router = FilmCrafter3's `llm.py` extended to three interfaces; official APIs only

Status: accepted · Date: 2026-11-22

## Context
The PRD says to reuse "Motion Studio's multi-provider router"; no Motion Studio repository is accessible.
FilmCrafter3's `llm.py` already serves OpenAI, Anthropic, OpenRouter, Gemini, Ollama and LM Studio through the
OpenAI API, with keys in the OS keychain. FilmCrafter3's `upscale.py` reaches Topaz through Kie.ai and fal, and its
music path reaches Suno through Kie.ai — both resellers, which the PRD's "official APIs only" rule forbids.

## Decision
- **Language model:** port `llm.py`/`localmodels.py`; add Inkling as another OpenAI-compatible local endpoint.
- **Sound:** ElevenLabs official API; Suno, VoiceKiller and anything else by file import with a licence note.
- **Enhance:** Topaz Video AI CLI locally; Topaz's own API as cloud option. Raster sources only.
- Every provider declares `{offline, costPerUnit, unit, limits, capabilities}`; the router falls back or asks.
- Every paid call needs a `confirm_spend` token and records provenance.

## Consequences
FilmCrafter3's Kie/fal paths are not ported. If Motion Studio's router turns up, compare and record the choice here.
