# QuickPath: user guide

QuickPath turns an idea into a finished video in about ten seconds. You change the words, add pictures, a voice and music, and save it.

## Before you start

You need **EffectCraft 0.24.1** installed. QuickPath asks it to build and render the video. Nothing else is required.

## Make your first video

1. Open QuickPath.
2. Write what your video is about. One sentence is enough; the words you write become the words on screen. The three small buttons (Product teaser, Event invite,
   Explain an idea) fill in an example.
3. Pick a **length** (10, 15, 30 or 60 seconds) and a **shape**. Each shape is drawn to scale on its button:
   **Wide** 16:9 (YouTube, screens), **Tall** 9:16 (phone stories, Reels, Shorts, TikTok), **Square** 1:1 (feeds), **Portrait** 4:5 (Instagram and Facebook feed posts),
   **Cinema** 21:9 (ultrawide, a film look) and **Classic** 4:3 (older screens, slides). Pick it before you press Make; to change it later, start the video over.
4. Press **Make my video**. In about ten seconds it plays.

If you have Ollama running on your computer, a model there writes the scenes from your idea. If not, your own sentences are cut into scenes.

## Change it

On the right, every scene has its own box.

- **Headline** and **small line**: the words on screen.
- **Seconds**: how long the scene lasts.
- The cross removes a scene. **Add a scene** adds one at the end.
- **Look**: six colour styles. Click one.

After any change, press **Update video** (or Ctrl+Enter). It takes a few seconds.

Under the video, the **timeline** shows your scenes, each as wide as it is long. A line moves along it as the video plays and the scene being played lights up (in the list too).
Click a scene on the timeline to jump to it.

## Pictures and clips

Each scene can have something behind its words.

- **Add picture or clip**: your own PNG or JPEG (up to 12 MB) or MP4 clip (up to 150 MB). A clip plays from the start of its scene. If it is shorter than the
  scene, it holds on its last frame; if longer, it is cut.
- **Make a picture**: an AI picture for that scene. A window first shows the model, the price (about two cents), how much you have spent so far, and the exact
  words that will be sent. You can change the words. Nothing is sent until you press **Confirm**.

Pictures are dimmed a little so the words stay easy to read.

## Voiceover

Under **Sound**, pick a voice.

- **Windows voices** are free and stay on your computer.
- **OpenAI voices** sound more natural and cost a fraction of a cent for a short video. A window shows the price and the words before anything is sent.

Each scene then gets a "Voice says" box. Leave it empty to read the words on screen, or write something different for the voice.
A scene that is too short for its line grows to fit it.

## Music

Pick Calm, Warm, Upbeat or Cinematic, or **My own sound file** (WAV or MP3, up to 40 MB). Choose Soft, Medium or Loud.
Music fades in and out and gets quieter while the voice speaks.

## Save it

**Save final video** makes the full-size MP4 and puts it in `Documents\QuickPath`. **Show in folder** takes you to it.

## Your videos

The start screen lists the videos you have made. Click one to carry on. Hover and press the cross to remove it (on Windows it goes to the Recycle Bin).

Each video also has an EffectCraft project (`video.ecproj`) in its folder. Open it in EffectCraft to keep editing; the text stays editable.

## What it costs

Almost everything is free: scenes, Windows voices, music, and your own pictures, clips and sounds. Only AI pictures (about $0.02 each) and OpenAI voices
(about $0.002 for a 15 second video) cost anything, and always after you press Confirm. QuickPath stops at **$5** in total (the number is kept in the file
`spend.jsonl` in your QuickPath folder).

## Where do I put my API keys?

Press the **sliders button** at the top right (the same Settings window opens from the link under the idea box). Paste a key into the box for Pictures (Kie.ai) or Voices (OpenAI),
press **Save key**, then **Check it works**. QuickPath keeps it in Windows Credential Manager and never shows it again, only "Key set". You never need a command line.
The full walk-through, where to get each key, and troubleshooting are in `SETUP_KEYS.md`. The same window shows whether a model on your computer (Ollama) was found, and lets
you change the **spending limit**.

## If something goes wrong

| You see | What to do |
|---|---|
| "EffectCraft not found" at the top | Install EffectCraft 0.24.1, then restart QuickPath |
| "No Kie.ai key was found" | Add a Kie.ai key as above, or skip AI pictures |
| "Make the voiceover first" | You picked an OpenAI voice; press Update video and confirm |
| "That does not look like a PNG or JPEG..." | The file is not really that type. Export it again from its program |
| Windows says "unknown publisher" | QuickPath is not signed yet. Choose More info, then Run anyway |
