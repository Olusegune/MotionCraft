# QuickPath 0.2.0: QA document

Quality assurance for QuickPath (branch `claude/quick-path`). It says what was tested, how, what was found, and what has not been checked.
Read it with `README.md` (what the app does) and `docs/USER_GUIDE.md` (how to use it).

Status in one line: **126 automated tests pass, CI passes on Windows, macOS and Linux, an accessibility audit found no violations, and a manual
script (section 6) is ready for a person to run on a clean PC and a Mac. Not signed. The Mac build has never been run.**

## 1. Scope

In scope: the local server and its HTTP API, planning (scenes from an idea), the layout and the EffectCraft build, rendering, pictures and clips
(your own and AI-made), voiceover, music, the spend gate, saving and reopening videos, the page, and the Windows desktop app and its installer.

Out of scope here: EffectCraft itself (a separate product, pinned to 0.24.1), Ollama, Kie.ai and OpenAI as services, and the main MotionCraft app.

## 2. Environments tested

| Where | What |
|---|---|
| The owner's PC | Windows 11 Home, Node 24.14, EffectCraft 0.24.1, Ollama with `qwen3:8b`, ffmpeg 8.1, Electron 45.5 (installed with the NSIS installer, upgrade-over-install checked) |
| GitHub Actions, Linux | Node 24: all tests that do not need EffectCraft (the real-engine tests report as skipped) |
| GitHub Actions, Windows and macOS | `npm ci` and the installer build (Windows: setup EXE and zip; macOS: Apple Silicon `.dmg`) |
| **Not tested** | A clean Windows PC with no development tools; any Mac (the `.dmg` is built, never opened); Intel Mac; Windows 10; Linux desktop; other EffectCraft versions; a machine without Ollama was only covered by the fallback tests, not by hand |

## 3. How it was tested

| Layer | Method | Count |
|---|---|---|
| Unit | Pure functions: planning, text wrapping and fitting, layout, music levels, name and voice-choice checks, file readers (`plan`, `images`, `mp4`, `sound`) | 27 |
| Fake provider | A fake Kie.ai, OpenAI and Ollama answer every case: success, bad key, no credit, refused prompt, slow, never answers, not JSON, wrong shape, one scene, connection reset, only picture models installed, non-https address (`ai`, `planner`, plus the voice cases in `sound` and `server`) | 14 |
| Server | A real server on a random port: Host/Origin refusal, size limits, bad uploads of every kind, one-time confirmations, saved-plan re-checking, removal, the strict page policy, Settings (keys, checks, spending limit), shapes | 33 |
| Real engine | The real EffectCraft builds and renders; pixels, sizes and audio of the result are checked | 6 + 19 |
| Fuzz | Seeded random and corrupted bytes at every file reader, random JSON at the plan checker, random text at the layout and planner | 6 |
| Real credential store | The real Windows Credential Manager: write, read back, remove, restore what was there; refuses any entry that is not QuickPath's | 2 |
| Page | Driven through the real desktop window (Chromium debug port): end to end (`drive.cjs`), accessibility with axe-core in four states (`a11y.cjs`), keyboard-only use (`keyboard.cjs`), screenshots at 1280, 1000 and 760 px wide with a check for sideways scrolling | scripts, not in `npm test` |
| Manual | Section 6 | 31 steps |

Run the automated tests with `npm test` (about 40 s on the owner's PC). Tests that need EffectCraft, ffmpeg or Windows voices say "skipped: NOT CHECKED" when
they are missing. A skip is never reported as a pass.

Per file: `plan` 12, `ai` 9, `images` 5, `mp4` 3, `sound` 9, `planner` 6, `server` 33, `creds.real` 2, `engine.real` 6, `edge.real` 19, `fuzz` 6, `kie` 11, `script` 5 = 126.

## 4. What the tests prove, by feature

| Feature | Checked by | Result |
|---|---|---|
| Scenes from an idea (own words, local model, fallback) | `plan`, `fuzz` (3000 random ideas and model answers) | pass |
| Text fits the frame in every shape; no orphan words; minimum size | `plan`, `fuzz` (1500 random texts x 6 shapes), `edge.real` | pass |
| Odd text: quotes, backslashes, newlines, emoji, Chinese/Japanese/Korean, Arabic, symbols, one huge word, 40-word sentence, one character, text that looks like a file path | `edge.real` against the real engine, each must render and show the words | pass |
| Six shapes (16:9, 9:16, 1:1, 4:5, 21:9, 4:3): each has a real size; the headline, the small line and the accent line fit inside the frame with clear space between them (checked against EffectCraft's measured line spacing, 1.2 x the text size); each renders at its own size (half-size drafts, rounded to even); each remembers its shape when saved and reopened; the AI picture request uses a ratio the model offers; the page and the server list the same shapes | `plan`, `ai`, `server`, `edge.real` | pass |
| Extremes: 12 scenes of 1.5 s; 8 scenes over 120 s; every look in every shape; two videos built at once | `edge.real` | pass |
| Own picture shows (pixel check) and a missing picture file does not break the build | `engine.real` | pass |
| Clips: shorter than the scene holds its last frame, longer is trimmed, both start with the scene (pixel checks) | `engine.real` | pass |
| MP4, PNG, JPEG, WebP, WAV, MP3 recognised by their bytes, not names; garbage, truncated and flipped-byte files never throw | `images`, `mp4`, `sound`, `fuzz` (over 10,000 files) | pass |
| Voice: scenes grow to fit the voice, audio track in the movie, no sound means no audio track | `engine.real` | pass |
| Music: four moods, never clip, deterministic; levels fade in, dip under each voice, fade out | `sound` | pass |
| Spend gate: one-time, expires after 5 minutes, bound to the exact words and project, $5 cap counted from the ledger on disk | `ai`, `server` | pass |
| Paid AI picture and OpenAI voice end to end against a fake provider | `server` | pass |
| One real AI picture and one real OpenAI voice through the real confirmation windows | manual, live | worked ($0.02 and $0.002, recorded in the ledger) |
| Reopen and remove saved videos; hand-edited and corrupt plans are re-checked or left out | `server` | pass |
| Desktop app: opens, makes a video, one window only, quits cleanly, page has no Node access | scripted drive of the installed app | pass |
| Accessibility (WCAG 2 A/AA, 2.1 A/AA, best practice) | axe-core: start screen, studio, confirmation window, settings window | 0 violations in each |
| Settings: a key is saved trimmed, never echoed back, never logged or written to a file; bad keys refused; removal touches only QuickPath's entry; MotionCraft's key is never changed; "Check it works" asks the provider a free question; the spending limit applies to the next quote and rejects silly numbers | `server`, `creds.real` | pass |
| Live: both saved keys checked against the real providers (Kie.ai credit balance, OpenAI model list), nothing made or charged | manual, through Settings | worked |
| Keyboard only: every control reachable with Tab (30 on the start screen, 40 in the studio), a visible focus ring on each, the confirmation window keeps focus inside and closes with Escape | `keyboard.cjs` against the installed app | pass |
| Narrow windows: no sideways scrolling at 1000 and 760 px | `drive.cjs` | pass |
| A local model that never answers, errors, or talks around its JSON: planning finishes with the idea's own words | `planner` | pass |
| Two renders requested at once are queued and both finish | `server` against the real engine | pass |

## 5. Bugs found by this QA

Found by testing, fixed, and now covered by a test.

| # | Bug | Found by | Fix |
|---|---|---|---|
| 1b | The small line touched or overlapped the headline in narrow shapes: the layout assumed a line spacing of 1.12; EffectCraft uses 1.2 (measured) | looking at all six shapes side by side | the layout uses the measured numbers; a test checks the gap in every shape |
| 1 | Square video with a long headline wrapped into seven huge lines and ran off the frame | layout unit test | text shrinks until the whole block fits |
| 2 | Music fade-in jumped back to full volume in the middle of the first voice line | music-levels test | every level key respects ducking |
| 3 | A paid voice not yet made was reported as "EffectCraft not found" on a machine without EffectCraft | CI (Linux) | cheap checks run before looking for the engine |
| 4 | Words that start like a file path (`/slow start`, `~/notes`, `C:\x`, `\\server`) failed to build: EffectCraft treats them as files to open | edge test | an invisible zero-width space in front (measured: draws nothing). EffectCraft refuses paths outside the project, and does not copy the file's contents into the text, so there was no leak, only a failure |
| 5 | Text size could step down to 34, below the stated minimum 36, in tall videos | fuzz test | clamped |
| 6 | The preview began on an empty frame because the words fade in | live use | preview starts 1.2 s in |
| 7 | Hidden items (spinner, "Show in folder") still showed because a style overrode `hidden` | live use | one rule for `[hidden]` |
| 8 | Accent line missing: EffectCraft's solid layer does not take a size | real engine | uses a rectangle shape |
| 9 | Headlines wrapped leaving single words alone on a line | live use | even line breaks |
| 10 | The "Your videos" list stayed visible above the studio after making a new video | live use, after the redesign | hidden whenever the studio opens, with a test that checks both ways in |
| 11 | The sticky action buttons were see-through, so scene text showed behind them | screenshot of the real window | solid bar |
| 12 | The words sent to the AI had a doubled full stop ("Wake up slowly..") | the confirmation window screenshot | punctuation tidied; test added |
| 13 | The text box and the video had no focus ring of their own; Tab showed nothing clear there | keyboard script | outline on the composer and the video |
| 14 | A local model that hangs made people wait 45 seconds | planner test | 25 seconds, and a hint on the page after 7 |
| 15 | There was no screen for entering API keys: they could only be set with a computer setting or a command line | the owner, in review | a Settings window (keys, check, remove, spending limit), with its own tests and audits |
| 16 | The first fuzz run failed on impossible input (my test built objects JSON cannot make) | fuzz test | the fuzzer now produces real JSON; not a product bug |

Open, known, not fixed:

| # | Issue | Severity | Note |
|---|---|---|---|
| 0 | Cost estimates for Kie.ai voices were first per character (quoted $0.007, real $0.12); now per line, with the measurement cited in a test | fixed | found by the first live call |
| A | OpenAI voice lines are quieter than Windows voice lines | low | not loudness-matched |
| B | AI pictures may contain stray words despite the instruction and a negative prompt | low | the one real picture made had none; no automatic check and retry |
| C | The built-in music moods were measured (length, loudness, clipping) but not listened to by a person | medium for taste | please listen |
| D | The desktop download is about 120 MB (it carries the Chromium engine) | low | |
| E | `npm audit`: moderate issue in a file-matching helper inside `electron-builder` | low | packaging tool only, not in the installed app |

## 6. Security review

Rafter's remote scan was out of quota for the billing period, so the review below was done by hand, against the code and with tests. The local
secret scan (`rafter secrets`) found nothing.

| Entry point | Threat | Mitigation | Test |
|---|---|---|---|
| Local HTTP server | A web page you visit talks to it (cross-site, DNS rebinding) | listens on 127.0.0.1 only; refuses any Host or Origin that is not that address and port | `server` |
| JSON bodies | Memory exhaustion; broken input | 64 KB cap; a plain message for broken JSON | `server`, `fuzz` |
| Plan from the page | Hostile fields: path walking, shell text, huge values, prototype pollution | re-checked on the server: scene count, text lengths, seconds, look name, voice choice, music, file names must match exact shapes | `server`, `fuzz` (4000 random JSON documents) |
| Saved `plan.json` | A hand-edited file | goes through the same checker when opened | `server` |
| Uploads (pictures, clips, sounds) | Wrong type, disguised file, oversized file, path walking | type judged from the file's own bytes (never the name or header); size caps (12 MB, 150 MB, 40 MB); names made by the server (12 hex characters); stored only inside the project folder | `images`, `mp4`, `sound`, `server`, `fuzz` |
| Media URLs | Reading other files | exact patterns for project id and file name; nothing else is served | `server` |
| Spend | Paid calls without consent, repeated charges | one-time confirmation tied to the exact words; $5 cap from an on-disk ledger; saved voice lines are never paid for twice | `ai`, `server` |
| Keys | Leaking | read only from fixed places; entered through Settings over the local channel, handed to Windows on standard input (never the command line), stored in Credential Manager under QuickPath's own names; never returned by the server (it reports only "set" and where from); the page empties the box before sending and keeps nothing in the browser; only QuickPath's own entries can be written or removed | `server`, `creds.real` |
| Provider answers | A hostile or odd answer | only https addresses followed; size checks; the bytes must really be a picture or sound | `ai`, `sound` |
| Windows voices | Command injection through the voice name or words | the voice name must be one of the installed voices; words travel in a file, never in a command; `shell: false` | `sound`, `server` |
| EffectCraft | Reading or writing elsewhere | started with `shell: false`, confined to the one project folder; text that looks like a path is neutralised | `edge.real` |
| The page itself | Script or style injected into it, or a request to another site | a strict Content-Security-Policy on every response (own files only; no inline script or style, no outside addresses, no framing, no plugins); the page has no inline script, style or handlers, and the tests check that | `server` |
| Desktop window | The page reaching the system | only QuickPath's own page can load; no new windows; no Node access in the page; every browser permission refused | scripted drive |
| Removing a video | Deleting the wrong folder | only folders with a `plan.json`, only by exact id; Recycle Bin on Windows | `server` |

Residual risks: anyone who can already run programs as you could read the spend file or the saved videos (they are ordinary files); the app is not
signed, so a tampered download would not be flagged by Windows (check `CHECKSUMS.txt`).

## 7. Manual test script

Run on a **clean Windows PC** (no Node, no EffectCraft first), then on a **Mac**. Tick each step; write what you saw if it differs.

| # | Step | Expected |
|---|---|---|
| 1 | Run `QuickPath_0.2.0_x64-setup.exe` (More info, Run anyway) | installs; Start menu entry; no administrator prompt |
| 2 | Open QuickPath **without** EffectCraft installed | window opens; top right says "EffectCraft not found"; pressing Make shows a plain message, not a crash |
| 3 | Install EffectCraft 0.24.1, restart QuickPath | top right says "EffectCraft ready" |
| 4 | Type "A 15 second teaser for a coffee brand" and press Make my video | in about 10 s a video plays; 4 or so scenes; words fade in |
| 5 | Press play | words fade in and out; no flicker; no empty frames |
| 6 | Change a headline, press Update video | the video updates in a few seconds; the change shows |
| 7 | Change the length of a scene to 8 s | the video gets longer |
| 8 | Remove a scene; add a scene | scene list and video follow |
| 9 | Pick each look in turn | colours change; text stays readable |
| 10 | Start over with each other shape (Tall, Square, Portrait, Cinema, Classic) | the picture is the right shape and nothing is cut off; the small line never touches the headline |
| 11 | Add your own PNG to a scene | thumbnail shows; after Update the picture is behind the words, dimmed |
| 12 | Try to add a text file renamed `.png` | refused with a plain message |
| 13 | Add an MP4 clip shorter than the scene, then one longer | short holds its last frame; long is trimmed; both start with the scene |
| 14 | Voiceover: pick a Windows voice, press Update | scenes grow if needed; voice is heard; words match |
| 15 | Type different words in "Voice says" | the voice says those words |
| 16 | Music: try each mood, then Soft, Medium, Loud | music fades in and out, dips under the voice; levels differ |
| 17 | Music: My own sound file (WAV, then MP3) | plays; a text file renamed `.mp3` is refused |
| 18 | With no voice and no music, play the video | silent |
| 19 | Press the sliders button. Paste a Kie.ai key, Save key, then Check it works | the box empties; badge says Key set; "The key works. Credits left: ..."; the key is never shown again |
| 20 | (Needs a Kie.ai key) Make a picture on a scene | window shows model, price, limit and the words; Cancel sends nothing |
| 21 | Confirm, then Update video | a picture appears behind the words; "Used so far" went up by about $0.02 |
| 22 | Edit the words in the window before confirming | the edited words are the ones used |
| 23 | (Needs an OpenAI key) Pick an OpenAI voice, press Update | confirmation shows characters and price; after Confirm the voice plays |
| 24 | Update again without changing words | no second confirmation (lines were saved) |
| 25 | Save final video | a full-size MP4 appears in `Documents\QuickPath`; "Show in folder" opens it; it plays in another player with sound |
| 26 | Close and reopen QuickPath | "Your videos" lists the video; opening it brings back the scenes, look, voice, music and pictures |
| 27 | Remove a video from the list | asks first; goes to the Recycle Bin; can be restored |
| 28 | Open `video.ecproj` in EffectCraft | text is editable; audio layers are there |
| 29 | Start QuickPath twice | only one window |
| 30 | Keyboard only: Tab through the start screen and the studio; Ctrl+Enter | every control reachable and visible; Update runs |
| 31 | Uninstall from Windows Settings | removed; `Documents\QuickPath` is left alone |

## 8. Release checklist and sign-off

| Item | State |
|---|---|
| Automated tests (126) pass | done |
| CI green on Windows, macOS, Linux | done |
| Accessibility audit | done, 0 violations |
| Fuzz and edge-case tests | done |
| Installed and driven end to end on the development PC | done |
| Manual script on a clean Windows PC | **not done** |
| Manual script on a Mac | **not done** |
| Code signing and notarisation | **not done** (no certificate or Apple account) |
| Intel Mac build | **not done** |
| Listen to the music moods; compare voices | **not done** (needs a person) |
| Rafter remote scan | **not done** (quota); local secret scan done |

Recommendation: fine for friends-and-family testing on Windows now. Before wider release: run section 7 on a clean PC and a Mac, sign the builds, and have
a person listen to the music and voices.

## Live paid checks with Kie.ai (2026-11-26, through the real confirmation windows)

| Feature | Estimate shown | Real cost (ledger) | Result |
|---|---|---|---|
| Voice, ElevenLabs, 4 lines | now $0.12 (was $0.007) | $0.12 | scenes stretched to fit, voice audible (-15.7 dB mean) |
| Music, Suno, 23.6 s | $0.06 | $0.06 | ducks under the voice (-17.4 dB mean) |
| AI picture, Imagen 4 Fast | $0.02 | $0.02 | saved on the scene |
| Animate picture, Wan 2.2 Turbo 720p | $0.40 | $0.40 | 5 s, 1280x720 H.264 clip saved in the project |

Total spent on live tests to date: about $0.62 of the $5 limit. Bugs these found: voice price off by 17 times; "make the voiceover first" did not cover Kie voices; a missing import that only failed at run time (picture names). Not yet checked: the animated clip inside a rendered video by eye, and a long run on a real script.

## The film run (2026-11-26): a real 90 second script

The sample script was imported, given your three reference sheets, voiced (narrator plus one character), animated (seven clips, then two redone), scored and rendered at 2560x1080. Cost $4.49 of the $5 limit. What it found:

| # | Finding | Status |
|---|---|---|
| F1 | An AI clip invented a person in the closing scene | redone with a no-people prompt; the model can still add people, so look at every clip |
| F2 | A reference picture had a sign with words baked in | cropped out before animating; the app cannot see words in pictures |
| F3 | The cut sheet kept a thin pale border; clips froze for the rest of a long scene | fixed: panels are inset 1.2%, pictures and clips keep a slow push-in |
| F4 | If the page stops, picture choices made since the last render are lost | open: needs autosave |
| F5 | The page can look idle while a paid request is running (throttled hidden window) | open: show the busy state more clearly |
| F6 | The clips are 5 s, scenes are 10-16 s | open: chain or loop clips |

## Clips that fill a scene (2026-11-26)

Tests added: a batch quote (price shown first, refused for another project or without the batch flag, works exactly N times, each real cost counted, film cost per project), a chained-clip render on the real engine (red, green, blue clips play in order and the last holds), autosave. Bug found by a test: the first version of the batch quote ignored the spending limit; fixed and covered. Not checked: the continuation clips themselves on real Kie (the limit was reached first), and whether continuation frames join smoothly by eye.

Live check of continuation (2026-11-26, $0.40): the clip made from the last frame of the one before joined with no visible seam (first frame matches the previous last frame). Finding: the model added people walking into an empty chamber in both clips although the words said no people, so "no people" in a prompt cannot be relied on; check the frames. Total spend of the film run: $4.90 of the $5.00 limit (the limit was kept).

## ElevenLabs and Voicekiller voices

Built from the providers' documentation and tested against fake servers that answer like the documented API (request headers and body, saved MP3, ledger, bad key, no credit, too fast, a missing voice, a reply that is not sound, key checks, voice lists with bad entries dropped). **Live check done (2026-11-26, real accounts, price window confirmed each time):** both keys accepted; ElevenLabs line made (21 characters, ledger $0.0031, 1.2 s MP3); Voicekiller line made (2.3 s mono MP3, nothing in the ledger because its price is on the plan); the page measured both (-12.6 dB and -22.6 dB, so the loudness matching has a 10 dB gap to close). Bugs the live check found: Voicekiller answers its voice list as plain text, not JSON, so its voices were not listed; fal keys contain a colon and were refused; Voicekiller's key needed its own User ID box. Voicekiller's documentation is thin (the voice field is named two ways on its page, so both are sent; the reply format of its voice list is not documented, so the parser accepts the common shapes).

## Delivery notes and progress

Tests added: a note reaches Voicekiller as `instructions` and never as spoken words, a changed note is a new line, no note sends none, other providers ignore the note, a refused voice gives Voicekiller's own reason plus what to do and records nothing, and the activity list shows a running job and is empty when idle. Checked by hand: a render was started, the page reloaded, and the bar showed the job with its title and time. Not checked: whether Voicekiller's instructions change how a line sounds (needs a listener).

## PDF, Word and scene scripts

Tests added for the scene reader (headings, the where-line, stopping at END and at the notes, lengths that favour longer scenes and stay within the plan's limits, awkward and huge input, a timed table still winning). Checked live: a real 8-scene PDF script opened in the real desktop app through its file button (`scripts/check-script-import.cjs`), read by the bundled PDF.js with no page errors, made into 8 scenes of 120 seconds in total, and rendered. Bug found by a test: the new file button used inline styles, which the page's strict policy forbids. Not checked: a Word file (the reader is written and its zip handling is simple, but no real .docx has been opened yet), a scanned PDF (it is a picture, not text, so the app says so), and Fit scenes to the music with a real song.
