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
