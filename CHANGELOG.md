# Changelog

What people see, newest first. Version numbers are the app's; the work below is on branch `feat/macos-native` and is still labelled 0.1.5.

## Unreleased (after 0.1.5)

### New
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
