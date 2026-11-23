# UI/UX review and QA — 2026-11-22

Reviewed against [UI_UX.md](UI_UX.md) and Victor's mockups, after Victor's feedback: "feels more like a prompting tool",
"where is the visual area", "Settings keeps slipping down", "where is the option to work manually".

## The honest answer to "am I missing something?"

No hidden feature is missing from the build: **the visual-first workspace in the mockups is not built yet.** Phase 1 built the
process skeleton (seven stages, gates, modes, projects, adapter plumbing, providers). Most pages were forms because the things
that fill the visual area did not exist: no way to bring pictures in, no frames, no audio, no playback. This round starts on
that. MotionCraft is also, by the PRD, the **director layer on EffectCraft**: it has no compositor of its own, so detailed
motion work opens in EffectCraft. FilmCrafter3's film pipeline (cast, locations, shot takes, video clips, lip-sync) is a
different product and was not ported; only its shell patterns, spend gate and model lists were.

## Findings and what was done

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Sheets re-focused their first field every time the app re-rendered (every few seconds), so Settings scrolled back down. Cause: the parent passed a new `onClose` each render and the focus effect depended on it | High (reported) | **Fixed**, regression test |
| 2 | Brief was two text boxes; attachments were disabled placeholders | High | **Fixed**: Add media… (pictures, video, audio, checked by file bytes, size-capped, copied into the project), media wall |
| 3 | Viewer empty on most pages; story strip was text chips | High | **Partly fixed**: strip shows each beat's frame; Treatment shows the selected frame large. Viewer still empty on Intent and Direction |
| 4 | Direction had no visuals | High | **Partly fixed**: moodboard of your pictures. AI-proposed directions with stills still need a provider |
| 5 | Treatment was text areas only | High | **Fixed**: storyboard, one frame and one plan per beat |
| 6 | UI scale slider did nothing (all sizes in px) | Medium | **Fixed** (root zoom); narrow-width layout stacks the inspector; checked at 100% on 1100x660 and 250% on a 1536 px screen: no horizontal overflow on any page |
| 7 | Duplicate banner landmark inside every dialog; palette options contained buttons (axe) | Medium | **Fixed**; axe now runs on all pages and sheets in the test suite |
| 8 | Installed EffectCraft 0.24.1 is not byte-identical to the pinned commit: 763 vs 766 commands, 7 command schemas differ (including `prop.set`), `render_preview` has no `times` | Medium | **Handled** for what the app uses (contact-sheet falls back to one frame); real-engine suite passes 33/33 on both builds. `--version` cannot tell them apart: still a risk |
| 9 | Old project files (before assets, layerMap, moodboard) | Medium | Tested: open and every page renders |
| 10 | Settings is one long sheet | Low | Open: split into tabs |

## Second round: items 1 to 5 from the open list (this branch)

| # | Open item | Status |
| --- | --- | --- |
| 1 | Playback and timeline | **Built.** A draft movie (half-resolution H.264, rendered by EffectCraft on its own engine process so editing is never blocked) plays in the app. Player: play and pause, frame step (arrow keys), second step (Shift), scrub bar, frame number, timecode in IBM Plex Mono, ruler with beat marks, beat-section marks and notes. Space, Home and End work. Checked in tests; **playback inside the packaged WebView was not watched by a person** |
| 2 | Build only had text and a camera | **Built.** Shapes (5), solid background, your own pictures, video and audio as layers; a motion library of 10 tested primitives (fade in and out, slide, rise, pop, pulse, drift, spin, per-letter reveal and rise) that write ordinary keyframes at the playhead. Each primitive is rendered on the real engine and its frames must differ over time (10 of 10 pass on both the installed release and the pinned build). Camera moves are not included: a camera only affects 3D layers |
| 3 | No audio | **Built, scoped.** WAV waveform, tempo and beat grid (estimates; on click tracks tempo is within 1 BPM and beats within 20 ms), silences, beat markers written into the composition, audio added to the composition. Other formats need ffmpeg. Not Pulseframe's analysis: no sections, word timings or stems (P3-01) |
| 4 | No AI direction proposals | **Built.** Three contrasting editable starting points, one confirmation, three stills from the image provider you chose, and Use this direction sets the style families and adds the still to the moodboard. Tested against a fake provider only; no live provider call was made |
| 5 | No final render, no frame-accurate review | **Built.** Render final (H.264 or ProRes 4444 with alpha) goes through a single-use confirmation, runs on its own engine process, and is recorded in the project; verified through Rust, helper and the real engine (180 frames at 30 fps, correct size by ffprobe). Collected editable project exports the package to a folder you pick. Review plays the draft and pins notes to exact frames |

Still open: the compare view, the tier-1 QA checks, a language-model router (Assisted and Agent-led), camera moves and 3D, sections
and word timings from audio, an animatic over audio, and a proper timeline with layers and keyframes (EffectCraft remains the editor).
The renders include audio only if the audio file was added to the composition; that was not verified by listening.

## QA run (what was executed and the result)

| Check | Result |
| --- | --- |
| Frontend tests (Vitest) | 45 passed |
| axe, all seven pages, Projects, New project sheet, Settings, command palette (no contrast) | 0 violations |
| Colour contrast, computed from the tokens | All text and accent colours 4.5:1 or better on every surface; control border 3.31:1 or better (needs 3:1) |
| No raw hex colours outside `tokens.css` | Pass (test) |
| 1100x660 at 100%, all pages | No horizontal scroll, main action in view |
| 1536 px wide at 250%, all pages | No horizontal overflow |
| Keyboard: stage-bar arrows wrap; Escape closes a sheet and returns focus | Pass (tests) |
| Python engine tests | 74 passed on the mock; 33 passed on the real engine, on both the pinned build and the installed release |
| Rust tests | 11 passed (+2 that need a real machine, run locally and passed) |
| `npm audit` | 0 vulnerabilities |
| Production build | Passes |

**Not checked:** a real screen reader; contrast measured in the rendered app (computed from tokens only); touch; the macOS
app; every menu item clicked in the packaged app; importing a real file through the system dialog in the packaged app (the
Rust byte check and the page flow are tested separately); large media walls (hundreds of pictures) and very large pictures.
