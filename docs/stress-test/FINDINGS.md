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
