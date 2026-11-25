# Walkthrough: Civilization I–VII, from script to video

This is a real run of the built MotionCraft app (Windows, EffectCraft 0.24.1, a local language model, no paid calls), from an empty project
to a 90-second, 21:9 film with sound. Every picture below is a screenshot of the app taken by `scripts/walkthrough_civilization.py`.
You can open the finished project in the app (Projects, **Open the example**) and look at every page for yourself.

**What went in:** the script and the on-screen text table exactly as written ([docs/stress-test/civilization-script.md](../stress-test/civilization-script.md)),
ten pictures (one per shot, 1911 × 819), and a placeholder score made from plain tones (`scripts/make_civilization_score.py`).
**What came out:** a 2560 × 1080, 24 fps H.264 file with stereo AAC sound, and a project you can reopen and edit in MotionCraft or EffectCraft.

A note on honesty: native file dialogs cannot be driven by a script, so the pictures and the score were added by sending the app the same
"files dropped on the window" event the operating system sends. Everything else was clicked and typed in the app.

## 0. First run

![The tour, first step](01-tour-welcome.jpg)

A short tour opens the first time. It can be skipped, and replayed from the command palette (Ctrl+K, "Take the tour").

![The last step of the tour](02-tour-ready.jpg)

## 1. Start a project

![New project](03-new-project.jpg)

Name, aspect (21:9 here), resolution, frame rate and length. The size follows from the aspect and the resolution.

![The empty brief](04-brief-empty.jpg)

## 2. Paste the script

![The brief page with the script pasted](05-brief-pasted.jpg)

The script is pasted as written: two tables, one for the shots and one for the on-screen text and its timing. MotionCraft reads the tables by
their headings, joins the shot's name and what we see, takes the voiceover as the sound, and uses the second table for the text.

![What MotionCraft found in the brief](06-found-in-brief.jpg)

"Found in your brief" lists what it understood: ten scenes with their names, and the voiceover lines as markers. Nothing is applied until you press **Use these**.

## 3. Add the pictures (and the sound)

![Dropping files on the window](07-drop-target.jpg)

Drag pictures, video or audio onto the window. A drop target appears, the files are checked by their real type, and they are copied into the project.

![The media wall](08-media-wall.jpg)

Each imported file has a rights note ("I made it or own it", "Licensed to me", "Stock or free licence"), because MotionCraft cannot know a file's licence. QA asks about any that are blank.

![The Start with audio tab](18-audio-tab.jpg)

![Adding the score](19-audio-added.jpg)

The score is added the same way. MotionCraft analyses it (beats, sections) and draws it under the timeline.

## 4. Make it

![The plan](10-make-it-plan.jpg)

One button. The local model drafts the intent (what the piece is for, its tone, one scene per row of the script), a look is chosen, each scene's plan comes
from the script, and the ten pictures are given to the ten scenes in order. You review it once. This screenshot is the plan; we chose **Edit first** to show every page.

## 5. Intent, direction, treatment: three approvals

![Intent](11-intent.jpg)

The Intent page is the interpretation everything else follows. Here we changed the purpose to *Inform* and swapped *Playful* for *Restrained*.

![The intent after editing](12-intent-edited.jpg)

![After approving the intent](13-after-approving-intent.jpg)

Approving takes you to the next page and says what to do there. Approval is always your click.

![Direction: the moodboard](14-direction-moodboard.jpg)

![Direction: the style system](15-direction-style-system.jpg)

Direction sets seven dimensions (typography, motion, colour, texture, camera, transitions, composition). We kept *Cinematic title* and made the typography *Swiss / International*.

![Direction: the style presets](16-direction-presets.jpg)

There are 42 style presets in four groups, with filters.

![Treatment](17-treatment.jpg)

Treatment is a storyboard: one picture and one plan per scene. Each picture can be replaced, or made with an image provider (always after a confirmation that shows the price).

## 6. Build

![Build, before anything is built](20-build-empty.jpg)

![The Builder's plan](21-builder-plan.jpg)

The Builder plans the layers. The on-screen text is **timed to the script's rows**, whatever the model guessed: each line appears on its row, fades in and out, sits in the lower
third so the picture stays clean, and the SPECULATIVE tag sits under Types IV–VII as its own small layer. Every layer has a tick box: leave out what you do not want.

![Built](22-built.jpg)

One click builds the layers, puts the pictures behind their scenes (fitted to fill the frame, dimmed a little), and adds the score so the render is not silent.

![The draft preview](23-preview-ready.jpg)

**Build preview** renders a draft you can play and scrub.

## 7. Review: checks, notes, versions, sign-off

![Review](24-review.jpg)

![The first quality check](25-qa-first-run.jpg)

Eighteen checks run. This first run found real things: ten pictures enlarged to 134% (they are 1911 px wide in a 2560 px film), and eleven imported files with no rights note.
Checks that cannot run say so and give the reason; they are never counted as passes.

![After the rights were answered](26-qa-after-rights.jpg)

![The checks clean, with what was accepted](28-qa-clean.jpg)

![The enlarged pictures accepted](27-qa-accepted.jpg)

A warning can be **accepted** (you looked, you keep it); it stays listed and stops counting. Errors cannot be accepted.

![A note at the playhead](29-review-notes.jpg)

![Versions](30-versions.jpg)

Notes are pinned to a frame. Every automatic change keeps a version before and after it, so it can be compared or undone.

![After sign-off](31-after-signoff.jpg)

## 8. Deliver

![Deliver](32-deliver.jpg)

![The render confirmation](33-render-confirm.jpg)

![The finished render](34-render-done.jpg)

The final render asks first, even when it costs nothing, and shows what it will make. The result is a 2560 × 1080 H.264 file with the score as stereo AAC.

## 9. Open it in EffectCraft

Everything MotionCraft builds is a normal EffectCraft composition (`comp.ecproj` in the project folder): **Open in EffectCraft** on the Build page. Layers, keyframes and text
are editable there, and **Refresh from file** brings your changes back.

![EffectCraft with the project open](35-effectcraft.jpg)

The text labels step across the timeline in their rows, the ten pictures sit under them in the same steps, the score runs the full length, and the background is at the back.
While EffectCraft has the project open MotionCraft is read-only; close EffectCraft and MotionCraft reloads the project and logs what you changed.

## The example inside the app

A copy of this finished project (without its final render) ships with MotionCraft. On the Projects page press **Open the example**: it is copied into your projects folder, so you can change it freely.

![The example, opened, with its draft preview](35-example-opened-preview.jpg)

## What this run found and fixed

The run is also the stress test. See [docs/stress-test/FINDINGS.md](../stress-test/FINDINGS.md) for the list, with the tests that now guard each fix.
