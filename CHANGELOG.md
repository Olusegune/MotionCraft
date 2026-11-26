# Changelog

What people see, newest first. Version numbers are the app's.

## 0.2.0 (release candidate)

The first version meant for people who are not the builder. Everything below 0.2.0 in this file is what it grew from.

### New since 0.1.5
- **Green screen**: make or import a subject on a flat green or blue screen, key it out in EffectCraft, and put any colour, picture or video behind it.
- **Voiceover** for any scene (OpenAI or Google, official APIs, confirmed before any spend), placed at the start of the scene.
- **Image to video** from a scene's picture, and more image and video models (Kie.ai and fal as opt-in providers next to the official ones).
- **Hand-off** to After Effects (.aep), DaVinci Resolve and Final Cut (FCPXML), Premiere (XML), OpenTimelineIO and EDL. The DaVinci Resolve import was checked in Resolve Studio 21.
- **Fonts**: the brief's fonts are found, checked for video licensing and used.
- **First-run tour, automatic updates, art-style presets, your own images and video** as picture sources.
- **Polish**: dark thin scrollbars, a header that never wraps, friendly dates, plain wording in Review, a clearer New project dialog, one control to set rights for all imported files, a pinned and brighter Unlock bar on approved stages, square previews with no glow, and a clearer empty Build screen.

### Fixed from the first test on a real PC
- **Make it** no longer hangs with a local reasoning model (Ollama qwen3, deepseek-r1): thinking is switched off for the draft, and after 90 seconds the draft is made from the brief's own words.
- **Scene plans** follow the scenes your brief lists, so a picture model no longer draws the word "Calm".
- **Generated pictures** are saved as PNG, not WebP, so After Effects and other editors can carry them.
- Keyed clips stay keyed after Build.

### Known limits
- Not signed: Windows shows an unknown-publisher warning, and Macs need right-click, Open until the app is notarised.
- The installer has been run on one Windows PC; the Mac builds have not been run on a Mac; the After Effects file has not been opened in After Effects.
- Picture models sometimes draw the brand name; the spend sheet can try again when it sees lettering.

## Between 0.1.5 and 0.2.0

### New (this round)
- **Make it**: one button on Brief. The Director drafts the intent, a look and a plan for every scene are proposed, you review once, and Build starts planning.
- **The brief is read**: length, shape, frame rate and 4K, a timed script (as scenes) and its sound notes (as markers) are found in the text and offered before anything is used.
- **Scene pictures**: the picture chosen for each scene goes behind that scene in the composition, fills the frame, is dimmed so text stays readable and pushes in slowly. Building does it with the layers.
- **Shapes with art direction**: spheres are translucent rimmed circles spread across the frame, connections are hairlines, a point is a small bright dot.
- **Layers are timed**: a plan keeps its in and out points when built (they were being lost), and text lines a model did not time are spread over the scenes.
- **Project cards show the piece**; Treatment is a grid of picture cards; plain-language modes (You do it, Together, It does it); a spend ledger with a dollar cap for known prices and a call cap for unpriced ones; Fix all safe QA issues.
- **Fixes**: Write markers no longer blanks the window (and a safety net shows a Reload button if a screen ever fails); the duration field follows the brief card; QA findings are readable.
- **A little magic**: ambient light, glass panels, soft glow, gentle motion (off for reduced motion).

### Earlier
- **A timeline on Build** under the picture: audio waveform and sections, the emotional-arc curve with a dot at the playhead, QA findings and saved
  versions on the ruler, and every layer as a bar. Click to move the playhead.
- **Move and trim layers on the timeline**: drag a bar to move it, drag an edge to trim it, or use Alt and the arrow keys. Approved layers and
  locked layers stay put; nothing happens while EffectCraft has the project open. Each change is one revision with a saved version before and after.
- **Scene cards** under the picture: one per intent beat, with a still from the composition, and an Approved or Needs review badge.
- **Studio layout** on Build, Review and Deliver: a large picture that fills the page, a one-row transport with a slim scrubber and volume,
  full screen (F), a draggable divider to the timeline (remembered per project), and Ctrl+J to hide the timeline.
- **Brief page** rebuilt: one question, three ways in (write, import a script, start with audio), starting points, and a preferences panel.
- **Style presets**: drawn pictures for the 12 style families; one click uses a family for all seven dimensions. Three quick picks on Brief.
- **Deliver**: the final video is the stage and comes back after reopening; each output card has its own Render or Export button; the collected
  project leaves out draft movies and logs.
- **Header**: Manual / Assisted / Agent-led centred, a command search field, and on Build the Review changes and Build preview buttons. A slim
  left rail with Project, Media, Direction, Versions and Settings.
- **Audio analysis is kept with the project** and comes back when you reopen it.
- Pulseframe SongMap import, song sections and lyric markers (P3-01).

### Fixed
- Collapsed panels now really hide their contents (they never did).
- The budget field no longer turns "30" into "030".
- A move that EffectCraft's own timing would have allowed outside the composition is clamped.
- Dependency: `cookie` updated for RUSTSEC-2026-0594.

### Known gaps
- Duration and aspect ratio are read-only after a project is created.
- Style pictures are illustrations drawn in code; the Builder does not yet use the families to make layers.
- No macOS build has been run on a Mac.
