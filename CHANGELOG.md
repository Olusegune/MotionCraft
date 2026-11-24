# Changelog

What people see, newest first. Version numbers are the app's; the work below is on branch `feat/macos-native` and is still labelled 0.1.5.

## Unreleased (after 0.1.5)

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
