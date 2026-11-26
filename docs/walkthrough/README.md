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

## 10. Bring a scene to life: a real video from a picture

![The Animate dialog](37-animate-choices.jpg)

On Treatment every scene that has a picture has **Animate…**. The dialog shows the picture and the choices a director would make: the **video model** (only models that can start
from a picture, and whose key you have set), the **camera** (locked off, push in, pull back, pan, tilt, orbit, crane, handheld, dolly zoom), the **performance** (what the people do,
and how, taken from the scene's plan), the **emotion** (taken from the scene's beat), an optional **line of dialogue**, the **sound** of the scene, the **length** and **size**, and what to
**keep out** of the picture. The prompt sent to the model is built from these, shown in full, and can be replaced by hand. The price is shown, or "Unknown" when the provider does not publish one.
Nothing is sent until you confirm, and a confirmation covers one clip.

![Making the clip](39-clip-running.jpg)

This test used fal's Veo 3 Fast, 4 seconds, 720p, on scene 2 (an adult, since some models refuse pictures of children). It took 53 seconds. The result is a real clip, 1280 × 720,
24 fps, with stereo sound the model made: the technician looks up from her tablet with a small smile, then turns to look out over the sea while the camera pushes in. The picture is kept, and the
clip becomes the scene's frame. **Put pictures behind the scenes** places it, and a clip shorter than its scene holds its last frame or loops (your choice, per scene).

![The clip in the composition](41-clip-in-build.jpg)

### One dialog, every model: what it can do is read from the provider

Kie.ai is offered first, then fal, then Google. When you choose a model, MotionCraft reads that model's own published page (Kie.ai and fal both publish a schema for every model) and the dialog
shows only what the model can really do: its **aspect ratios** (Seedance 2.0 does 21:9, so a 21:9 film is not cropped), **lengths** (4 to 15 seconds for Seedance 2.0), **sizes** (up to 4K),
whether it makes **sound**, and whether it takes a **last frame**, up to nine **reference pictures**, a **clip to follow** (video to video) or **sound to follow**. The files you choose are your
project's own; MotionCraft sends them to the provider you chose and no one else (Kie.ai keeps uploaded files for 24 hours).

![Seedance 2.0 Fast on Kie.ai](42-animate-kie-seedance.jpg)

A real test: Seedance 2.0 Fast on Kie.ai, 4 seconds, 480p, from the scene 3 picture, in the film's own 21:9. It took two minutes; the clip is 992 × 432 with sound, and Kie.ai reported what it cost
(46.8 Kie credits), which MotionCraft records in the clip's provenance. The model lists (about a thousand models) are refreshed from Kie.ai, fal and Google once each time the app runs, and a
model that is not listed yet can be added by its id (Image and video models, "A model that is not listed?").

What to know:
- Video models make 16:9 or 9:16. In a 21:9 film the clip is cropped to fit, as the pictures are.
- Veo needs a Google account with billing turned on. The Google key used here listed no Veo model, so it could not start a clip; the dialog asks Google which models a key can use before it offers any.
- Music is not generated: import it, then set its level under Build, Audio. Spoken lines said by someone in the scene come from the video model; a narrator's voiceover is made in the next section.

## 11. Give a scene a voice: voiceover

Each scene in Treatment has a **Voiceover...** button. It opens a sheet already filled in:

- **The line to speak** is taken from the script's voiceover column for that scene's time.
- **How to say it** is written from the scene's feeling, strength and energy ("Narrate with wonder and awe (strong), at a slow, unhurried pace...") and can be changed.
- **Voice model and Voice**: OpenAI GPT-4o mini TTS (steerable by the delivery text), OpenAI TTS HD, and Google Gemini TTS. Only official providers make voices; a model appears only when its key is set.

![The voiceover sheet](43-voiceover-sheet.jpg)

Pressing **Confirm and make the voice** is the spend confirmation. The file is saved in the project (assets/audio) with where it came from, and a small player appears under the button so you can listen before it goes in the film.

![A voiceover made for a scene](44-voiceover-made.jpg)

In Build, **Put pictures and voiceovers in place** starts each voiceover at its scene's start (it never goes in at zero like a score). The score goes in at zero and its level can be set (full, -6, -10 under a voice, -16 quiet bed). Real test: a 7.3 second voiceover made in 3 seconds, placed at 8 s, heard in the rendered preview.

What to know: a voiceover costs money (no price is reported by the provider, so the ledger says unknown); music is still imported, not made.

## 12. Green screen clips, for compositing

**A video model keeps the background of the picture it starts from.** A real test showed it: asked, in words, to replace a Lagos kitchen with a green screen, Seedance 2.0 Fast made a clip with the kitchen and only a green edge. So the screen has to be in the picture:

1. **Make the picture on a screen.** On a scene, **Try another** (or Make picture) has **Background**: Green screen or Blue screen. The picture is made of the scene's subject alone, whole and sharp, on one flat, evenly lit screen (green: RGB 0, 177, 64; blue: RGB 0, 71, 255), with no room or scenery. It is marked as a screen picture.
2. **Animate it.** The Animate dialog starts with Background set to the picture's screen and asks the model to keep it exactly, with none of that colour on the subject. If you choose a screen for a picture that has its own background, the dialog says plainly that the model will keep it.
3. **Build takes the screen out.** "Put pictures and voiceovers in place" keys the clip with EffectCraft's Screen Color Key, so what is behind it shows through. For footage you brought yourself, **Add layers**, "Take out a flat screen" removes green or blue as the file is added. The key stays an ordinary effect in EffectCraft, where softness and spill can be tuned.

![Making the picture on a green screen: Background in the confirmation](45-green-screen-picture.jpg)

![A green screen picture made by an image model](46-green-screen-picture.jpg)

Real run (Kie.ai: Imagen 4 Fast for the picture, Seedance 2.0 Fast for a 4 second 480p clip), checked on the pixels:

![A generated clip before the key](48-green-clip-before-key.jpg)
![The same clip keyed in EffectCraft over a magenta background](49-green-clip-keyed-over-magenta.jpg)

The screen (RGB 23, 157, 41) becomes the background behind it (RGB 244, 4, 221) and the subject is unchanged. What the model drew **besides** the screen is not removed: this clip kept a faded block of flats at the top
(the image model put scenery behind the subject although it was told not to), and the key tints it. A generated screen is good, not studio perfect: look at the picture before animating, and use Try another if it has scenery.

What to know: use blue when the subject is green. Pictures made with an image model can have an uneven screen; the key copes with small variations, not with a patterned background.

### Choosing what shows behind a green screen clip

Build has **Background behind green screen clips**: a flat colour (white, black, grey, warm paper, sky, navy, or magenta to check the key), a picture or video from the media wall, or nothing. It is one layer called **Backdrop**, replaced each time, kept above a Background solid and below the scene pictures, so placing scene pictures again never buries it. Real-engine test: a keyed green screen picture shows white, then a blue picture, then the dark solid again, with the subject staying red. Also fixed: **Build** now keys green screen clips when it places the scene pictures (the key was only applied by the Scene pictures button).

## 13. Work on it in After Effects, DaVinci Resolve or Premiere

Deliver has **Work on it in another editor**. Choose the editor and press **Prepare files**. Everything is written into the project's `exports` folder, one new folder per hand-off (nothing is sent anywhere, nothing costs money):

| Editor | What you get | How it was checked |
| --- | --- | --- |
| After Effects | An `.aep` with the layers, text, keyframes and markers EffectCraft can write | EffectCraft writes it and reads it back. **Not opened in After Effects** (only the plug-in folders of AE 2025 are on this PC) |
| DaVinci Resolve or Final Cut Pro | An FCPXML timeline plus the clips it points at, rendered by EffectCraft with their effects | Files written and read for clip count; **not imported into Resolve** |
| Premiere Pro | The same timeline as XML | As above, not imported into Premiere |
| OpenTimelineIO, EDL | The timeline in those formats (an EDL holds one video track) | As above |

![Work on it in another editor, After Effects](50-hand-off-after-effects.jpg)

On the real Civilization project, After Effects listed 35 footage items and 3 layer timings it cannot carry, wrote nothing, and wrote `Main.aep` after Send it anyway.

A keyed green screen clip arrives in Resolve, Final Cut and Premiere **already keyed**: the clips written next to the timeline are rendered with the key and carry an alpha channel (real-engine test: the screen's alpha is near 0, the subject's is solid).
After Effects is different: its file cannot carry EffectCraft's key effect. MotionCraft says so before writing anything ("Nothing was written yet"), lists what would be lost, and writes only after **Send it anyway**; in After Effects, apply Keylight to the clip.

Full chain tested on the real engine: a green screen clip is placed, keyed, composited over a magenta background in EffectCraft (the screen shows the magenta, the red subject stays), then handed to each editor.

## What this run found and fixed

The run is also the stress test. See [docs/stress-test/FINDINGS.md](../stress-test/FINDINGS.md) for the list, with the tests that now guard each fix.
