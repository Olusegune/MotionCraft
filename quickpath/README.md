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
Ocean, Pop) and six shapes, each drawn to scale on its button:

| Shape | Ratio | Size | Good for |
|---|---|---|---|
| Wide | 16:9 | 1920 x 1080 | YouTube, presentations, screens |
| Tall | 9:16 | 1080 x 1920 | Phone stories, Reels, Shorts, TikTok |
| Square | 1:1 | 1080 x 1080 | Feeds |
| Portrait | 4:5 | 1080 x 1350 | Instagram and Facebook feed posts |
| Cinema | 21:9 | 2560 x 1080 | Ultrawide screens, a film look |
| Classic | 4:3 | 1440 x 1080 | Older screens, slides |

(21:9 is the usual 2560 x 1080 ultrawide frame, a hair wider than an exact 21:9. Drafts are half size; all sizes are even numbers, as video needs.)
For AI pictures: Imagen offers 1:1, 16:9, 9:16, 3:4 and 4:3, so Cinema asks for a 16:9 picture and Portrait a 3:4 one and the edges are trimmed to fill the frame; the
request tells the model to keep the subject in the middle.

## Tests

```powershell
npm test
```

110 tests (see `docs/QA.md` for what each group proves): planning, layout, picture, MP4 and sound reading, the spend gate, a fake provider for every failure,
the server's refusals, awkward text and extremes on the real EffectCraft, and fuzzing of every file reader. The tests that need EffectCraft, ffmpeg or Windows
voices report as skipped (never passed) when those are missing.

Other checks: `node scripts/drive.cjs <QuickPath.exe>` drives the installed app end to end; `node scripts/a11y.cjs <QuickPath.exe>` runs an accessibility audit (axe-core); `node scripts/keyboard.cjs <QuickPath.exe>` checks keyboard-only use.

Documents: `docs/USER_GUIDE.md` (how to use it), `docs/SETUP_KEYS.md` (AI and keys), `docs/ROADMAP.md` (what is next) and `docs/QA.md` (test strategy, results, bugs found, security review, manual test script, release checklist).

## How it looks

A calm, slightly futuristic style: a deep canvas with slow aurora light, glass panels with fine glowing edges, Space Grotesk headings and Inter text (both bundled, so
the look does not depend on what is installed), and one warm accent, the amber of the icon, for the thing to press next. Under the video, a timeline shows each scene
as wide as it is long, with a line that moves as the video plays and the current scene lit up; click a scene to jump there. Everything respects the system setting for
reduced motion. The accessibility audit (WCAG 2.1 AA, axe-core) finds no violations.

## Your videos

The start screen lists the videos you have made (newest first). Click one to reopen it: its draft is rebuilt so it is always current. Hover a card and press
the cross to remove it; on Windows it goes to the Recycle Bin, so you can put it back. Only folders that QuickPath made (they hold a `plan.json`) can be removed,
and a saved plan is re-checked when it is opened, in case the folder was edited by hand.

While you edit, the preview and the buttons stay in view as the scene list scrolls, and Ctrl+Enter updates the video.

## The desktop app

QuickPath also comes as an ordinary Windows program, so you do not need a terminal.

- **Install:** run `QuickPath_0.2.0_x64-setup.exe`. It installs for you only (no administrator needed), adds a Start menu entry and an uninstaller.
  Or unzip `QuickPath_0.2.0_x64.zip` anywhere and run `QuickPath.exe`.
- **What it is:** the same page, in its own window, with a built-in copy of the server. It still needs EffectCraft 0.24.1 installed. Only one window opens, even if you
  start it twice. Videos go to the same `Documents\QuickPath` folder.
- **Safety:** the window can only show QuickPath's own page on 127.0.0.1, cannot open other windows, has no access to Node or your files, and is refused every
  permission a web page can ask for (camera, microphone, location). The Host and Origin checks, upload limits and spend confirmation work exactly as above.
- **Unsigned for now:** Windows will say "unknown publisher" the first time. Choose More info, then Run anyway.
- **Size:** about 120 MB to download, because the program carries its own copy of the Chromium browser engine. The code itself is under 100 KB.

To build it yourself: `npm ci`, then `npm run dist` (installer and zip land in `release/`), or `npm run desktop` to run it without installing.
A GitHub Actions workflow (`.github/workflows/quickpath.yml`) builds both on every push to this branch. The macOS build is made by CI but has never been run on a Mac.

Build tools note: `npm audit` reports a moderate issue in a file-matching helper that `electron-builder` uses while packaging. It is a development tool and is not part of
the installed app.

## Safety

The server listens on 127.0.0.1 only and refuses any request whose Host or Origin is not that address (so a web page you visit cannot talk
to it). Request bodies are capped at 64 KB. A plan from the page is re-checked on the server: scene count, text length, durations, look name.
Folder names are random 12-character hex strings and media paths must match that exact shape, so nothing outside the projects folder is
served. An uploaded picture is accepted only as PNG or JPEG judged by its own first bytes (never its name or header), capped at 12 MB and 12000 pixels
a side, and stored under a name the server makes. EffectCraft is started with `shell: false` and confined to the one project folder.

## Sound

**Voiceover.** Pick a voice under Sound and each scene's words are read aloud, starting a moment after the scene does. A scene that is too short for its
line grows to fit it (never shrinks). Under each scene a "Voice says" box lets you write different words for the voice than the ones on screen.

- **Windows voices** (David and Zira on a standard install) are free, work offline and need no key.
- **OpenAI voices** (nova, onyx, alloy, shimmer) sound more natural and cost about $0.002 for a 15 second video (OpenAI lists $15 per million characters).
  They use the same confirmation window as pictures: it shows the price and the exact words, and nothing is sent until you press Confirm. Lines are
  saved under a name made from the voice and the words, so the same line is never made, or paid for, twice. The key is found the same way as the Kie.ai key
  (`OPENAI_API_KEY`, Credential Manager `QuickPath/openai`, or the key saved in MotionCraft).

**Music.** Choose Calm, Warm, Upbeat or Cinematic, or your own WAV or MP3 file (up to 40 MB). The four moods are made here from nothing, in under a
second, so there is no licence to worry about and no key: soft pads, plucked chords, a light beat or a low drone, as long as the video needs. Music fades
in and out and dips under each voice line. Volume is Soft, Medium or Loud.

Voice and music are ordinary audio layers in `video.ecproj`, so they stay editable in EffectCraft. With no voice and no music chosen, the movie has no audio track.

## Settings: where keys go

Press the sliders button at the top right. Paste a Kie.ai or OpenAI key, press Save key, then Check it works (a free question to the provider: your credit balance, or the model list).
Keys go to Windows Credential Manager under `QuickPath/kie` and `QuickPath/openai`, are handed over on standard input (never the command line), and are never shown or returned again:
the window only says whether a key is set and where it comes from. Remove deletes QuickPath's own entry and never touches MotionCraft's. The same window shows whether Ollama was found
and sets the spending limit. Step by step: `docs/SETUP_KEYS.md`. What is planned next: `docs/ROADMAP.md`.

## Money and keys

AI pictures use your Kie.ai account. The key is found, in this order: the `KIE_API_KEY` environment variable; the key saved from Settings (Windows Credential Manager entry
`QuickPath/kie`); or, on Windows, the key you already saved in MotionCraft. It is never shown to the page, never written to disk or a log, and sent
only to Kie.ai. Every picture is counted in `spend.jsonl` in your QuickPath folder, and new pictures stop at a limit of $5 (change it with
`QUICKPATH_SPEND_CAP_USD`). The price is an estimate (about $0.02), because Kie.ai does not publish one through its API. Results are only fetched
from https addresses, and only accepted if the bytes really are a picture.

## Not done yet

- AI video clips, and AI-composed music (the main app rules out AI music from Suno and similar; the built-in moods are simple background music, not compositions).
- Setting a voice for one scene only, speed and pitch, and loudness-matching OpenAI and Windows voices (OpenAI lines come out quieter).
- Checking an AI picture for stray lettering and trying again (the prompt asks for none and sends a negative prompt, and the first real picture had none).
- Music, voiceover, and the editor hand-offs (After Effects, Resolve) beyond opening `video.ecproj` in EffectCraft.
- Code signing (Windows shows "unknown publisher") and a Mac run.
- Automatic updates for the desktop app.
- Mac and Linux: the code is not Windows-specific (Windows voices and the Credential Manager key lookup are skipped elsewhere), but only Windows has been run.
