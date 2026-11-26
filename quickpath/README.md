# QuickPath

Type an idea. Get a finished video draft in about ten seconds. Change the words, press Update, save the full-size video.

This is the "build it my way" branch of MotionCraft: the quick path first, as one screen, with none of the gates and approvals that
the main app starts with. It lives beside the main app and does not change it.

## Run it

You need Node 22.18 or newer and EffectCraft 0.24.1 (the same version MotionCraft pins).

```powershell
cd quickpath
node src/server.ts
```

Open http://127.0.0.1:4177. Videos are saved in `Documents\QuickPath\projects\<id>\`. Each folder holds `plan.json` (the words and
look), `video.ecproj` (the EffectCraft project, open it in EffectCraft to keep editing), and the movies.

Set `EFFECTCRAFT_CLI` if EffectCraft is somewhere unusual, `PORT` to use another port, `QUICKPATH_HOME` to save elsewhere.

If Ollama is running on this computer, a local model writes the scenes from your idea. If not, your own words are cut into scenes.
Nothing is sent anywhere else, and no key is needed.

## Why it is built this way

| Main app | QuickPath |
|---|---|
| Tauri shell (Rust) + React + Python engine, three layers and an allow-list between them | One Node and TypeScript process talking to EffectCraft directly. No build step. |
| Seven stages with approval gates | One screen. The result comes first, editing second. |
| AI calls assumed to be fast | Every model call has a time limit and a plain fallback (your own words) |
| Mock engine in most tests | Real EffectCraft in the tests from the start |

It builds a 15 second video in about 12 ms and renders the half-size draft in about 2 seconds, because EffectCraft does all the work.

## What it makes

Each scene can also have your own PNG or JPEG picture behind the words (up to 12 MB). It fills the frame, pushes in slowly, and sits under a dark veil so the words stay readable.

Every scene is a background colour, a short accent line, a headline and an optional small line, each fading and sliding in and out.
The text is native EffectCraft text, so it stays editable when you open `video.ecproj`. Six looks (Midnight, Sunrise, Paper, Forest,
Ocean, Pop) and three shapes (wide, tall, square).

## Tests

```powershell
npm test
```

26 tests: the planning, the layout (text must fit the frame in all three shapes), picture detection, the server's refusals (including every kind of
bad upload), and four that build and render real videos in EffectCraft, one of them checking a pixel of the person's own picture (skipped, and reported
as skipped, if EffectCraft is not installed).

## Safety

The server listens on 127.0.0.1 only and refuses any request whose Host or Origin is not that address (so a web page you visit cannot talk
to it). Request bodies are capped at 64 KB. A plan from the page is re-checked on the server: scene count, text length, durations, look name.
Folder names are random 12-character hex strings and media paths must match that exact shape, so nothing outside the projects folder is
served. An uploaded picture is accepted only as PNG or JPEG judged by its own first bytes (never its name or header), capped at 12 MB and 12000 pixels
a side, and stored under a name the server makes. EffectCraft is started with `shell: false` and confined to the one project folder.

## Not done yet

- Video clips in scenes, and AI-made pictures (the main app has both).
- Music, voiceover, and the editor hand-offs (After Effects, Resolve) beyond opening `video.ecproj` in EffectCraft.
- A desktop installer. Today it is a command and a browser tab; wrapping it in a window is a later step.
- Mac and Linux: the code is not Windows-specific, but only Windows has been run.
