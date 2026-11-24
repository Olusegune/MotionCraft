# MotionCraft user guide and walkthrough

MotionCraft turns a brief, a script or a piece of music into an editable motion-graphics project, shows you its reasoning, and asks you before
anything final or paid happens. This guide takes **one brief from an empty project to a finished 4K video**. Every picture below is a real screen
from the app.

- [1. Before you start](#1-before-you-start)
- [2. The walkthrough](#2-the-walkthrough)
- [3. Spending, privacy and approvals](#3-spending-privacy-and-approvals)
- [4. Keyboard shortcuts](#4-keyboard-shortcuts)
- [5. Troubleshooting](#5-troubleshooting)
- [6. Words used in the app](#6-words-used-in-the-app)

## 1. Before you start

**What you need**

| | Needed? | What it is for |
|---|---|---|
| Windows 10 or 11 | yes | macOS builds are produced by CI; they have not been run on a Mac yet |
| EffectCraft 0.24.1 | yes | the compositor and renderer MotionCraft drives. MotionCraft finds it, or you point to `effectcraft-cli` in Settings |
| A language model | optional | the Director and Builder. A local one (Ollama, LM Studio) is free and keeps everything on your computer |
| An image provider key | optional | pictures for scenes (Kie, Google, OpenAI, fal, BytePlus). Every paid call asks you first |

**Install.** Run `MotionCraft_0.1.5_x64-setup.exe` (or the `.msi`), or unzip the portable build and start `MotionCraft.exe`. Projects are kept in
`Documents\MotionCraft`. Nothing is sent anywhere until you add a provider and confirm a call.

**Three ways to work.** The switch at the top of a project sets how much the app does for you:

| Mode | What happens |
|---|---|
| **You do it** | Everything is manual. No AI account is needed. |
| **Together** | The Director and Builder propose; you decide. The default once a language model is set up. |
| **It does it** | The agents do more per click. You still approve the gates and every spend. |

## 2. The walkthrough

The path through a project is always the same seven stops, shown along the bottom: **Brief, Intent, Direction, Treatment, Build, Review, Deliver**.
The diamonds between them are **gates**: points where you approve the work so far. Approved work is locked until you unlock it, and unlocking
creates a revision, so nothing is lost.

### Step 1. Projects

![The project list: each project shows a picture of the piece, its length and shape](guide/01-projects.png)

The first screen lists your projects. A card shows a picture from the piece (or a title card when it has none yet), its length and shape, and when
it was last edited. Press **New project**.

### Step 2. New project

![The New project dialog with name, aspect and size, resolution, frame rate and duration](guide/02-new-project.png)

Choose a name, the aspect ratio, the resolution (720p, Full HD or **UHD 4K**), the frame rate and the length. You can change size, length and frame
rate on the Brief page until the first layer exists. Press **Enter** to create the project.

### Step 3. Brief: say what you want

![The Brief page with a typed brief and the "Found in your brief" card](guide/03-brief-found.png)

Write the brief, paste a script, or start with audio. If your text says "10 seconds, 16:9, 4K, 24 fps", or contains a **timed script table**, the
**Found in your brief** card offers to use it: the length and shape, one scene per row, and the sound notes as markers on the timeline. Nothing is
applied until you press **Use these**.

Other things on this page:

- **Style looks** on the right (a drawn picture for each style family). The look in use is shown first. After you approve the direction the looks
  lock, and the page says so.
- **Add files / Add media** for pictures, video and music. They appear on the media wall.
- **Budget limit**: the most you will approve for paid pictures. It counts known prices in dollars and every paid call by number, because some
  providers publish no price.

### Step 4. Make it

![The plan sheet: the intent, the scenes, the look, and one approval](guide/04-make-it-plan.png)

Press **Make it**. The Director reads your brief and drafts the intent. A look that fits what the piece is about is chosen, and every scene gets a
plan taken from your script. You then see **one review sheet**. **Looks right, continue to Build** approves the intent, direction and treatment
together; **Edit first** takes you to the Intent page instead. A local model costs nothing. A cloud model asks for a confirmation first.

*Prefer to do it by hand?* The Intent, Direction and Treatment pages each hold the same decisions, one at a time.

### Step 5. Treatment: a picture for every scene

![The Treatment page: a card for each scene with its picture, time and plan](guide/05-treatment.png)

Each scene is a card: a picture, its name and time range, and one line saying what happens. Three ways to fill a picture:

- **Make picture** creates one from that scene's own plan, your look and the colours in your brief. One confirmation sheet, one picture. Kie is
  offered first when you have its key, with a quick, light model.
- **Try another** replaces a picture you do not like.
- **Add pictures** or **Fill empty scenes with my pictures** uses pictures you already have.

A picture with lettering drawn into it is tagged **Has lettering** (a model on your computer looks at each new picture) and is not handed out
automatically. Words belong on text layers, where they stay editable.

### Step 6. Build: the composition

![The Build page: a large preview, the scene strip and the timeline](guide/06-build.png)

Build is the studio. The large picture is the composition; under it, the **scene strip** and the **timeline**.

1. **Plan with Builder** (it starts by itself after Make it). The Builder proposes layers: native, editable text; spheres, lines and points as
   shapes; each with start and end times. You see the plan and its cost ($0, it runs locally) and press **Build N layers**. Building also places
   each scene's picture behind its scene, scaled to fill the frame, dimmed so text stays readable, with a slow push-in.
2. **Build preview** renders a draft you can play and scrub.
3. **Click a scene** to move the playhead there. **Film strip** shows the scenes; **Edit** shows every layer as a bar you can drag to move or trim.
   Alt and the arrow keys nudge a layer. Approved layers stay put.

![Edit view: every layer is a bar on the timeline, under the scene strip](guide/07-timeline-edit.png)

**Sound.** Add music or narration on the Brief page or in the Audio panel. It is analysed by itself: you get the waveform, tempo and beats, and
**Write markers to composition** puts the beats on the timeline. **Add audio to composition** makes renders include the sound.

### Step 7. Review: checks, notes, versions

![Review: the technical findings, history and versions, and notes at the playhead](guide/08-review.png)

- **Run checks** runs the technical checks. Each ends as *Passed*, *Findings* or *Not checked, with the reason*; nothing unchecked is ever called
  a pass. Examples: text overlapping, text outside the safe area, low contrast, missing media, and **fonts the brief asks for that are not
  installed**. **Fix all safe issues** applies every safe fix in turn, one revision each, never on approved layers.
- **Notes at the playhead**: write what should change at an exact frame. The sound notes from your script are already here.
- **Save version** keeps a named copy. **Compare** shows then and now, and **Restore this version** goes back. Every automatic change keeps a
  version before and after, so it can be undone.
- **Approve for final render** is the last gate.

### Step 8. Deliver: the finished piece

![Deliver: the output cards, the render queue and the finished video](guide/09-deliver.png)

Choose an output: **H.264 video**, **ProRes 4444 with alpha**, or the **collected editable project** (the `.ecproj`, assets, renders and font
manifest, with relative paths). **Render** shows what will happen and what it costs (nothing from a provider; it renders on your computer) and waits
for your confirmation. When it finishes the video plays on the page and you get **Show the projects folder** and **Open in EffectCraft**.

### Settings

![Settings: working mode, offline mode, engine, image and video providers, language model](guide/10-settings.png)

- **Offline mode** blocks every cloud call.
- **Engine** shows the EffectCraft that was found; **Browse** points to another.
- **Image and video providers**: off until you turn them on, then add a key per provider. Keys are kept in your operating system's credential store,
  never in a project.
- **Language model**: choose Ollama, LM Studio or a cloud provider. Cloud models ask before every call.

### Command search

![Command search: type to find any page or action](guide/11-command-palette.png)

Press **Ctrl+K** to find any page or action.

## 3. Spending, privacy and approvals

- **Every paid call has its own confirmation sheet** showing the model, the provider, the price (or "Unknown") and who is charged. Nothing is sent
  before you confirm, and one confirmation covers only the call it names.
- **Limits.** Known prices count against the dollar limit; paid calls with no published price count against a call limit (25 by default). When
  either would be passed, the buttons turn off and say why. **Brief, Budget limit** shows what has been spent.
- **Your pictures never go to a cloud model.** The lettering check uses a model on your computer only.
- **Gates.** Intent, Direction, Treatment and the final sign-off lock what you approved. Unlocking creates a revision and says what needs approving
  again.
- **Keys** are stored in the operating system's credential store and are never written to a project file.

## 4. Keyboard shortcuts

| Keys | Does |
|---|---|
| **Ctrl+K** (**Cmd+K** on a Mac) | Command search |
| **Ctrl+,** | Settings |
| **Ctrl+\** | Collapse or expand the right-hand panel |
| **Ctrl+Shift+V** | Viewer-only mode (just the picture) |
| **Esc** | Close a sheet, or leave viewer-only |
| **Ctrl+J** | Hide or show the timeline (Build) |
| **Space** | Play or pause (when the preview has focus) |
| **Left / Right** | Step one frame; **Shift** with them steps one second |
| **Home / End** | Go to the start or the end |
| **F** | Full screen preview |
| **Alt + Left / Right** | Nudge the selected layer on the timeline |
| **Arrow keys** on the stage bar | Move between stages |

## 5. Troubleshooting

| You see | Why and what to do |
|---|---|
| **"MotionCraft closed unexpectedly"** | The last session did not end cleanly. Work is saved a second after each change; choose **Open** to continue. |
| **Make it is greyed out** | It names the reason: no language model chosen, no brief yet, or the intent is approved (unlock it on the Intent page to start over). |
| **Build buttons are greyed out** | The engine is not connected, or an EffectCraft window has the project open. Close that window. |
| **"Draft ... Out of date"** on the preview | The composition changed since the draft. Press **Build preview**. |
| **A picture has "Has lettering"** | The model drew words. Press **Try another**, or choose another picture. |
| **Fonts the brief asks for are not installed** | EffectCraft would draw a substitute. Install the font (many are free, for example from fonts.google.com) and restart EffectCraft. |
| **Image providers off** | Turn them on in Settings, add a key, and the Make picture buttons light up. |
| **Spending stopped** | The limit was reached. Raise it in Brief, Budget limit. |
| **The window went blank** | A safety net now shows a message and a **Reload MotionCraft** button. Your project is saved. |

## 6. Words used in the app

| Word | Meaning |
|---|---|
| **Brief** | Your words about what to make |
| **Intent** | The Director's reading of the brief: purpose, tone, scenes |
| **Direction** | The look: type, motion, colour, texture, camera, transitions, composition |
| **Treatment** | What happens in each scene, with its picture |
| **Gate** | A point where you approve the work so far |
| **Revision** | A recorded change, with saved versions before and after |
| **Scene** | One beat of the intent: a name and a time range |
| **Layer** | A normal EffectCraft layer: text, shape, picture, sound |
| **Preview / Draft** | A quick render to play and scrub |
| **Final render** | The finished file, made after sign-off |
