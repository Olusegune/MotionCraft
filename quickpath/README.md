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

Each scene can also have a picture or a clip behind the words, from three places:

- **Your own PNG or JPEG** (up to 12 MB).
- **Your own MP4 clip** (up to 150 MB, under ten minutes). It plays from the start of its scene; a clip longer than the scene is trimmed, a shorter one holds its last frame.
- **A picture made by AI** (Google Imagen 4 Fast through Kie.ai). Press **Make a picture** and a window shows the model, an estimated price, how much you have already spent, and the exact words that will be sent (you can change them). Nothing is sent until you press Confirm, and one confirmation pays for one picture.

A picture or clip fills the frame and sits under a dark veil so the words stay readable.

Every scene is a background colour, a short accent line, a headline and an optional small line, each fading and sliding in and out.
The text is native EffectCraft text, so it stays editable when you open `video.ecproj`. Six looks (Midnight, Sunrise, Paper, Forest,
Ocean, Pop) and three shapes (wide, tall, square).

## Tests

```powershell
npm test
```

41 tests: the planning, the layout (text must fit the frame in all three shapes), picture and MP4 reading, the spend gate, a fake provider for every failure
(no credit, bad key, refused prompt, slow, not a picture, non-https address), the server's refusals (every kind of bad upload), and five that build and render real
videos in EffectCraft and check pixels: your picture shows, a short clip holds its last frame, a long clip is trimmed (skipped, and reported as skipped, if
EffectCraft or ffmpeg is not installed).

## Safety

The server listens on 127.0.0.1 only and refuses any request whose Host or Origin is not that address (so a web page you visit cannot talk
to it). Request bodies are capped at 64 KB. A plan from the page is re-checked on the server: scene count, text length, durations, look name.
Folder names are random 12-character hex strings and media paths must match that exact shape, so nothing outside the projects folder is
served. An uploaded picture is accepted only as PNG or JPEG judged by its own first bytes (never its name or header), capped at 12 MB and 12000 pixels
a side, and stored under a name the server makes. EffectCraft is started with `shell: false` and confined to the one project folder.

## Money and keys

AI pictures use your Kie.ai account. The key is found, in this order: the `KIE_API_KEY` environment variable; Windows Credential Manager entry
`QuickPath/kie`; or, on Windows, the key you already saved in MotionCraft. It is never shown to the page, never written to disk or a log, and sent
only to Kie.ai. Every picture is counted in `spend.jsonl` in your QuickPath folder, and new pictures stop at a limit of $5 (change it with
`QUICKPATH_SPEND_CAP_USD`). The price is an estimate (about $0.02), because Kie.ai does not publish one through its API. Results are only fetched
from https addresses, and only accepted if the bytes really are a picture.

## Not done yet

- AI video clips, voiceover and music (the main app has them).
- Checking an AI picture for stray lettering and trying again (the prompt asks for none and sends a negative prompt, and the first real picture had none).
- Music, voiceover, and the editor hand-offs (After Effects, Resolve) beyond opening `video.ecproj` in EffectCraft.
- A desktop installer. Today it is a command and a browser tab; wrapping it in a window is a later step.
- Mac and Linux: the code is not Windows-specific, but only Windows has been run.
