# ADR-0005: Image and video providers, including aggregators

Status: accepted by Victor Edun in chat, 2026-11-22.

## Context
AGENTS.md and the PRD said "official APIs or file import only". FilmCrafter3 reaches most image and video models through
Kie.ai and fal (resellers) and BytePlus, Google and OpenAI directly, plus local ComfyUI. Victor asked for all of FilmCrafter3's
image and video models in MotionCraft.

## Decision
Image and video generation providers: BytePlus (Seedream), Google, OpenAI, local ComfyUI (official or local) and Kie.ai and fal
(aggregators), all opt-in. Generative models stay off until the user enables them in Settings. Keys live in the OS credential
store and go only to the one provider a call uses. Offline mode disables all cloud providers. Calls go only to an allow-list
of hosts. Every paid call needs a spend token from a user click, shows its price (or Unknown), and records provider, model,
cost (reported or estimate) and licence note as asset provenance.

## Still banned
Scraping; unofficial wrappers; music or voice models via Kie.ai (Suno stays import-only); Topaz via Kie or fal; sending
text, vector or logo layers or final renders through a generative model.

## Consequences
Model availability follows each provider's own list (discovered on request, cached, never silently replaced). Prices that a
provider does not publish are shown as Unknown. FilmCrafter3's registry notes that its BytePlus figures were read from
documentation and not proved by a real render; the same caveat applies here until a live run is made.
