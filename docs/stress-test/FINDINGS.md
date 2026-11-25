# Stress test findings: TYPE V — BEYOND THE UNIVERSE (2026-11-23)

Run in the real app (dev build) against EffectCraft 0.24.1, Ollama `gemma3:12b` as the language model, Kie.ai for images. Stopped early (usage limit).

## Done in the test
Project created (16:9, 24 fps, 10 s), brief and timed script entered, budget 5 USD, tones, soundtrack imported (own tones), Director drafted the intent (4 beats), Gate A approved,
Kie Imagen 4 Fast stills made (3 images, price unknown on Kie; real cost not read), Direction chosen with a style conflict and overrides, Gate B approved, Treatment written, Gate C approved,
Builder planned and built 9 layers (0 USD, local), draft movie rendered, timeline Film strip and Edit views opened.

## Not done
Layer timing against the script, audio analysis and markers, QA run and fixes, saved versions and compare, Review notes and sign-off, final render, package export, fonts check, the narration.

## Fixed during the test
- Image generation sent no aspect ratio; Kie refused every request (free). Now the project aspect is sent.
- Model picker defaulted to "Age Modify (fal)" after refreshing the lists. Curated models first, provider with a key and curated models first, Provider choice added to Direction proposals.
- Style conflict overrides were lost after reopening (pair order changed with the project file's A to Z order).
- The whole page scrolled when a panel hit its end.
- Selected tone chips were unreadable (solid cyan, invisible text).

## Open (not fixed)
1. New project offers no 4K size (brief asks for 4K); add 3840x2160.
2. Enter in the Duration field does not submit the New project dialog.
3. "Interpret brief" only opens Intent; drafting needs "Draft with Director".
4. Intent shows developer text ("The adapter is wired in ticket P1-11") and a large empty viewer; Treatment also has a large empty viewer.
5. The bottom story strip says "No audio imported ... (Phase 3)" although audio is imported; "(Phase 3)" jargon shows in several places.
6. Direction proposal prompts include the summary text, so two of three stills drew words ("Type V vizyzion"), against the brief. Prompts should demand no lettering first.
7. The Builder gives every layer the full 0-10 s, so all text overlaps; it should place layers from the beats (and use only 2 spheres where the brief says several).
8. Build switches itself to Agent-led once a language model is configured.
9. Disabled intensity options are shown struck through.
10. Space Grotesk and Inter are not installed system-wide, so EffectCraft cannot use them (QA font check not reached).
11. Kie prices are always "Unknown"; the 5 USD budget cannot be tracked from the app. Treat generation as capped by count.
12. The Treatment frame (a chosen still) is not used as the scene card picture on Build.

---

# Run 2 (2026-11-24): fresh project "TYPE V stress run 2", portable build of 0.1.5 "make-it", Ollama `gemma3:12b`, no paid calls made

## What worked
- New project dialog now offers Resolution and Enter submits. The brief typed in: "Found in your brief" read 10 s, 16:9, 24 fps, 3840 x 2160, 4 scenes and 4 sound cues; "Use these" applied them.
- Make it: the Director drafted the intent, a look was proposed, one review sheet, one approval; Build opened and the Builder planned 9 layers (3 spheres) on its own. Mode stayed "Together".
- Builder built 9 layers; QA ran (9 of 15 checks ran) and caught 3 text collisions, which were real; Review showed the 4 script sound cues as notes.
- Audio: imported through the file chooser, Analyse found 149.7 BPM, 25 beats.

## Bugs this run revealed
1. FIXED: "Write markers to composition" blanked the whole window (the engine answers with `{markers, replaced}`, the UI treated it as a composition). Guarded; the test mock now uses the real reply shape (it failed before the fix). An error boundary now shows a message and a Reload button instead of an empty window.
2. FIXED: the duration field kept showing the old length after "Use these" (the project had the right value).
3. FIXED: QA findings were squeezed into a one-word-per-line column.
4. FIXED (fallback): gemma3:12b gave no timing, so every text layer spanned the whole piece. The engine now spreads untimed text lines over the scenes and says so. A model that gives timing is unaffected.
5. OPEN: the audio analysis is not restored when a project is reopened (Build says "No audio analysed yet" until Analyse is pressed again, although the result is cached).
6. OPEN: the Director replaced the scene names read from the script (curiosity / awe / quiet mastery) with its own (curiosity / awe / serenity / acceptance), and chose "Clean broadcast" for a sci-fi piece.
7. OPEN: Missing fonts and Font licence checks are "Not checked" because EffectCraft does not report each text layer's font.
8. OPEN: the Builder omitted the "CIVILIZATION" title line from the script.

## Run 2 and 3, later in the session (new engine helper, rebuilt with PyInstaller)
The first helper in the "make-it" package was stale: PyInstaller was not installed and the build step hid the failure, so the 23 November helper shipped. Rebuilt and checked by exit code.

Verified in the app on the corrected build:
- Write markers: 25 markers written, no crash. Audio analysis is cached in the project (`analysis/`), analysis shows on Build again after the composition opens.
- Audio added to the composition; draft render includes the sound.
- Versions: saved a named version, Compare showed before and after frames. Review: a note at the playhead added next to the 4 script sound cues. Sign-off ("Approve for final render") recorded.
- Deliver: final H.264 render, 3840 x 2160, 24 fps, 10.0 s, with AAC audio (ffprobe), 1.2 MB, 21 s to render; project package exported to a folder. The page shows the saved path with a raw `\?\` prefix (cosmetic, open).
- Paid stills (Kie, Google imagen4-fast, 3 images): one confirmation sheet, stills arrived and joined the moodboard. The spend line now reads "3 paid calls so far, no known prices, 3 with no published price". Kie publishes no price, so the real cost could not be read from the app; at the usual rate for this model it is a few cents, far under the 5 USD limit.
- One of the three stills still drew lettering ("TypeVV") although the prompt begins with the no-lettering rule: the instruction is not enough on its own. Open: a check that flags text in a generated picture.

New bug found by the run and fixed: the Builder lost its layer timing. The page shows the checked plan (with `in`/`out`) and sends it back to build; building checked it again, read only `start`/`end`, and dropped the timing, so every layer spanned the whole piece even when the model had timed them. Fixed, with a unit test and a real-engine test (both failed before). The text-spreading fallback and this fix together mean titles no longer pile up.

## Round 3 (later on 2026-11-24): what was fixed and what is still open
Fixed since the earlier rounds: lettering in pictures is flagged by a local model; each scene card has Make picture / Try another (Kie preferred, a quick light model for single pictures, the brief's colours in the prompt); sound is analysed on its own; the look follows what the piece is about; the fonts a brief names are checked against the installed fonts (Space Grotesk is not installed on the test machine, and the check says so); locked looks are explained; projects without a picture get a title card; a first-time hint on an empty Brief.

Still open:
1. macOS builds exist in CI (Apple silicon and Intel) but have not been run on a Mac.
2. Picture quality depends on the model; "Try another" is the remedy.
3. The first run is a hint and three steps, not an interactive walkthrough.
4. A project made before a rule changed keeps its old look and plans (nothing is rewritten without being asked).

---

# Run 3 (2026-11-25): Civilization I–VII, 90 s, 21:9, the owner's ten pictures

Built portable app, Windows, EffectCraft 0.24.1, Ollama `qwen3:8b` as the language model (local, free), no paid calls (budget untouched). Script and on-screen text pasted exactly as written
([civilization-script.md](civilization-script.md)). Walkthrough with screenshots: [docs/walkthrough](../walkthrough/README.md).
Result: 2560 × 1080, 24 fps H.264, 90.0 s, with stereo AAC sound; QA 0 errors, 0 warnings (14 accepted by the person); the project opens in EffectCraft.

## Found and fixed (each has a test)
1. **A script in two tables was misread.** Unlabelled columns put "what we see" in the on-screen-text slot, and the second table (single times) was dropped. Tables are now read by their headings and single-time rows give each scene's on-screen text. `civilization.test.ts`
2. **The Director dropped the last scene** (nine scenes for ten rows, the last 7 seconds uncovered). Scenes are lined up with the script's rows; a missing row is filled from the script. `reconcileArc`
3. **Non-ASCII text arrived garbled in the engine helper** ("I–VII" became "Iâ€“VII") because Windows decoded the helper's input with the old code page. The helper now reads and writes UTF-8. `test_sidecar_utf8.py` (fails without the fix)
4. **Every motion lost its start time** when the page sent the checked plan back to build: all fades began at time zero. Fixed in `validate`. `test_a_motions_start_survives_the_second_check_before_building`
5. **A fade out after a fade in never showed** (the second motion read the layer's value at time zero, 0, as its own). The Builder reads each layer's own values once. Real-engine test.
6. **The Builder's text was timed by a guess.** It is now timed to the script's rows, fades in and out, sits in the lower third, is sized from the frame and shrunk to the safe area, and the SPECULATIVE tag is its own small layer under Types IV–VII. Markdown marks the model copied (`*italic*`) are removed.
7. **Motion names and parameters a small model gets slightly wrong** ("fade-in", "easing") dropped the whole motion and filled the plan with warnings. They are understood, extras ignored, and thirteen empty-layer warnings are one.
8. **A video clip placed after the start never played** (its own start stayed at zero, so only its last frame showed). Clips are slid into place; looping and holding are real-engine tested.
9. **The final video was silent.** The score was imported and analysed but never put into the composition; nothing said so. The Builder now adds the project's sound with the layers, and a new QA check, "Sound in the composition", warns when it is missing.
10. **Dialogs opened scrolled to their buttons**, hiding the plan. Focus no longer scrolls.
11. **The header wrapped, then ran off the edge, on pages with two actions** at 1440 px. Fixed.
12. **QA could only be read, not answered.** Warnings can be accepted (and the accepted ones survive the layers being renumbered); eleven imported files can be given their rights in one step; errors cannot be accepted.
13. **Approving on a page did not move on.** Approving now takes you to the next step's page and says what it is; the Next line no longer says "Press Make it" after Make it has run.
14. **Make it needed an AI model.** Without one it now drafts from the brief's own words and says so.

## Found, not fixed
- **Contrast**: the small SPECULATIVE tag measured 2.6 to 2.9 : 1 on two bright pictures (needs 4.5 : 1). Accepted for this film; a text shadow or a darker band behind the lower third would fix it.
- **Fonts**: "Missing fonts" and "Font licence" stay *Not checked*, because EffectCraft does not report which font a text layer uses. There is no way to choose a font per project yet.
- Settings, Language model: the model is a free-text box; it does not list what Ollama has installed.
- The Intent page's "Source evidence" shows the brief's raw markdown marks.
- Treatment shows "Try another" (a paid picture) on pictures the person supplied; it should say so only for pictures made in the app.
- The voiceover lines in the script become markers only; nothing speaks them. No music is made; the score is imported.
- The H.264 file is 172 MB for 90 s (about 15 Mbit/s). Fine for a master, large for the web: no bitrate choice yet.

## Found while building image to video (same day)
15. **Dialogs opened inside a card were squeezed into it.** The Animate dialog appeared clipped inside the scene card. Every dialog is now drawn into the page's body.
16. **A project copy, an exported package or the shipped example lost its media.** EffectCraft keeps the full path of every file, so a copy still pointed at the folder it was made in; the sound went silent and pictures went missing once the original was gone (or on another computer). When a composition is opened, missing files are looked for by exact name in the project's own assets and pointed there. Real-engine test (fails without the fix).
17. **A guessed model name answers 404.** The built-in Veo names (`veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`) were rejected by the Gemini API for this key. The app now asks Google which models a key can start, and hides built-in names it does not list. This Google key listed no Veo model at all.
18. **fal listed 847 models, many of them not video generators** (avatars, lip-sync, first and last frame tools). They are filtered, and the Animate dialog has a search box.
19. Generated clips keep their own settings (camera, acting, emotion, dialogue, sound, model) in the project so a shot can be reopened and changed.
20. **Kie.ai's file upload is not where its documentation says.** The page names api.kie.ai; that answers 404. Uploads go to kieai.redpandaai.co (found by a real test, now in a test).
21. **Kie.ai reports a real cost** (credits). A 4 second 480p Seedance 2.0 Fast clip cost 46.8 credits; it is recorded in the clip's provenance instead of "Unknown".
22. **What a video model can do is read, not guessed.** Kie.ai pages and fal endpoints publish an OpenAPI schema; the dialog is built from it (aspect ratios, lengths, sizes, sound, last frame, reference pictures, clip and sound to follow). Recorded copies of a Kie.ai page and a fal schema are test fixtures.
23. **Providers are offered Kie.ai, fal, Google in that order**; the lists refresh once per run; a model not yet listed can be added by its id.
24. **Newest models, as the providers list them today**: Seedream 5.0 Pro (BytePlus) and 5.0 Flash and Lite (fal) are the newest Seedream; there is no Seedream 5.5 in any provider's list yet. MAGI-2 (text, image and reference to video) is on Kie.ai. Wan 3.0 and Wan 3.0 Prime are on Kie.ai and fal. Seedance 2.0 and 2.5, and Kling 3 and 4, are on Kie.ai; Seedance is on fal too. They appear in the app as soon as the providers list them.
