"""Walks the Civilization I-VII project through the BUILT app, the way a person would, taking the screenshots for docs/walkthrough.

    python scripts/walkthrough_civilization.py <phase> [<phase> ...]
    phases: project, brief, media, makeit, build, treatment, qa, review, deliver

Start the app first with the debug port (see drive_app.py). Needs the owner's ten images (folder below) and the script in docs/stress-test.
Native file dialogs cannot be driven, so media is added by sending the app the same drop event the operating system sends (see docs/walkthrough/README.md).
"""
from __future__ import annotations

import glob
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from drive_app import App  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "walkthrough"
SCRIPT = (ROOT / "docs" / "stress-test" / "civilization-script.md").read_text(encoding="utf-8")
IMAGES = sorted(glob.glob(r"C:\Users\eduni\code\_mocraft_test\MocRaftTest\*.png"))
NAME = "Civilization I-VII"


def shot(app: App, n: str):
    p = app.shot(SHOTS / f"{n}.jpg")
    print("  shot", p.name)


def phase_project(app: App):
    app.click_text("New project", "button")
    app.wait_text("Aspect and size")
    app.fill_label("Name", NAME)
    app.select_label("Aspect", "21:9")
    app.select_label("Resolution", "Full HD")
    app.select_label("Frame rate", "24 fps")
    app.fill_label("Duration", "90")
    shot(app, "03-new-project")
    app.click_text("Create project", "button", exact=True)
    app.wait_text("What would you like to bring to life")
    shot(app, "04-brief-empty")


def phase_brief(app: App):
    app.fill_label("Describe the piece", SCRIPT)
    time.sleep(1.5)
    app.wait_text("Found in your brief")
    shot(app, "05-brief-pasted")
    app.scroll_to_text("Found in your brief")
    shot(app, "06-found-in-brief")
    app.click_text("Use these", "button", exact=True)
    time.sleep(1)


def drop(app: App, paths: list[str]):
    ev = lambda kind: f"""(async () => {{ await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{event:'tauri://drag-{kind}', payload:{{paths:{json.dumps(paths)}, position:{{x:10,y:10}}}}}}); return 'ok'; }})()"""
    app.eval(ev("enter"), True)
    time.sleep(0.8)


def phase_media(app: App):
    drop(app, IMAGES[:1])
    shot(app, "07-drop-target")
    app.eval(f"""(async () => {{ await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{event:'tauri://drag-drop', payload:{{paths:{json.dumps(IMAGES)}, position:{{x:10,y:10}}}}}}); return 'ok'; }})()""", True)
    app.wait_text("10_Closing_Two_Places_at_the_Table", 60)
    time.sleep(1.5)
    app.scroll_to_text("Media wall")
    shot(app, "08-media-wall")


def phase_makeit(app: App):
    app.click_text("Make it", "button", exact=True)
    t0 = time.time()
    while time.time() - t0 < 300 and not app.has_text("Here is the plan"):
        if int(time.time() - t0) == 2:
            shot(app, "09-make-it-working")
        time.sleep(3)
    app.wait_text("Here is the plan", 5)
    print("  Make it took", round(time.time() - t0), "s")
    shot(app, "10-make-it-plan")


def stage(app: App, name: str, wait: float = 1.8):
    app.eval(f"(() => {{ const b = Array.from(document.querySelectorAll('nav[aria-label=Stages] button')).find(x => x.innerText.trim() === {name!r}); b.click(); return true; }})()")
    time.sleep(wait)


def phase_intent(app: App):
    app.click_text("Edit first", "button", exact=True)
    time.sleep(0.8)
    stage(app, "Intent")
    shot(app, "11-intent")
    app.select_label("Purpose", "Inform")
    app.click_text("Playful", "button", exact=True)
    app.click_text("Restrained", "button", exact=True)
    time.sleep(0.5)
    shot(app, "12-intent-edited")
    app.click_text("Approve intent", "button", exact=True)
    time.sleep(2)
    shot(app, "13-after-approving-intent")          # the app moves on to the next step by itself


def phase_direction(app: App):
    stage(app, "Direction")
    for i in (0, 2, 7):
        app.click_selector("button.wall-item", i, pause=0.3)
    shot(app, "14-direction-moodboard")
    app.select_label("Typography", "Swiss")
    app.scroll_to_text("Style system")
    shot(app, "15-direction-style-system")
    app.scroll_to_text("Style presets")
    app.click_text("Techniques and genres", "button")
    shot(app, "16-direction-presets")
    app.click_text("All (", "button")
    app.click_text("Approve direction", "button", exact=True)
    time.sleep(2)


def phase_treatment(app: App):
    stage(app, "Treatment")
    shot(app, "17-treatment")
    app.click_text("Approve treatment", "button", exact=True)
    time.sleep(2)


WAV = r"C:\Users\eduni\code\_mocraft_test\Civilization-score.wav"


def drop_now(app: App, paths: list[str]):
    app.eval(f"""(async () => {{ await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{event:'tauri://drag-drop', payload:{{paths:{json.dumps(paths)}, position:{{x:10,y:10}}}}}}); return 'ok'; }})()""", True)


def phase_audio(app: App):
    stage(app, "Brief")
    app.click_text("Start with audio", "button, [role=tab]")
    time.sleep(0.8)
    shot(app, "18-audio-tab")
    drop_now(app, [WAV])
    app.wait_text("Civilization-score", 60)
    time.sleep(1)
    shot(app, "19-audio-added")


def wait_while(app: App, text: str, timeout: float = 300, first: float = 3):
    t0 = time.time()
    time.sleep(first)
    while time.time() - t0 < timeout and text in app.text():
        time.sleep(3)
    return round(time.time() - t0)


def phase_build(app: App):
    stage(app, "Build", 3)
    shot(app, "20-build-empty")
    app.click_text("Plan with Builder", "button", exact=True)
    print("  planned in", wait_while(app, "Planning"), "s")
    time.sleep(1.5)
    app.scroll_to_text("Include")
    shot(app, "21-builder-plan")
    n = int(app.eval("window.__mc.all('button').map(b => b.innerText.trim()).find(t => /^Build \\d+ layer/.test(t)).match(/\\d+/)[0]"))
    app.click_text(f"Build {n} layer", "button")
    app.wait_text("Built ", 240)
    time.sleep(2)
    app.scroll_to_text("Built ")
    shot(app, "22-built")
    app.click_text("Build preview", "button")
    print("  preview in", wait_while(app, "Rendering", 400), "s")
    time.sleep(2)
    shot(app, "23-preview-ready")


def phase_qa(app: App):
    stage(app, "Review", 3)
    shot(app, "24-review")
    app.click_text("Run checks", "button", exact=True)
    wait_while(app, "Checking")
    time.sleep(1.5)
    app.scroll_to_text("Technical findings")
    shot(app, "25-qa-first-run")
    # rights: say the pictures and the score are the owner's (the owner supplied them)
    for _ in range(14):
        ok = app.eval("""(() => { const s = window.__mc.all('select').find(x => Array.from(x.options).some(o => o.text.startsWith('Say what you may do'))); if (!s) return false; const o = Array.from(s.options).find(x => x.text.startsWith('I made it')); window.__mc.setValue(s, o.value); return true; })()""")
        if not ok:
            break
        time.sleep(wait_while(app, "Checking", 60) and 1.0)
        time.sleep(1.0)
    app.scroll_to_text("Technical findings")
    time.sleep(1)
    shot(app, "26-qa-after-rights")
    # the pictures are 1911 px wide and the film is 2560 px wide: a known, accepted softness
    try:
        app.click_text("Accept all", "button")
    except LookupError:
        pass
    time.sleep(1)
    shot(app, "27-qa-accepted")


def set_remaining_rights(app: App):
    for _ in range(20):
        ok = app.eval("""(() => { const s = window.__mc.all('select').find(x => Array.from(x.options).some(o => o.text.startsWith('Say what you may do'))); if (!s) return false; const o = Array.from(s.options).find(x => x.text.startsWith('I made it')); window.__mc.setValue(s, o.value); return true; })()""")
        if not ok:
            return
        time.sleep(4)


def accept_the_rest(app: App):
    """Accept what is left after the rights are answered: warnings the owner has looked at and keeps (enlarged pictures, a small tag on a bright picture)."""
    for _ in range(3):
        try:
            app.click_text("Accept all", "button")
            time.sleep(0.6)
        except LookupError:
            break
    for _ in range(12):
        try:
            app.click_text("Accept", "button", exact=True)
            time.sleep(0.4)
        except LookupError:
            break


def phase_review(app: App):
    stage(app, "Review", 3)
    app.click_text("Run checks", "button")
    time.sleep(8)
    set_remaining_rights(app)
    accept_the_rest(app)
    app.scroll_to_text("Technical findings")
    time.sleep(1)
    shot(app, "28-qa-clean")
    app.scroll_to_text("Notes at the playhead")
    app.fill_label("Note at", "Opening: the kitchen light should read warm, and the second place at the table should be easy to see.")
    app.click_text("Add note", "button", exact=True)
    time.sleep(1)
    shot(app, "29-review-notes")
    app.scroll_to_text("History and versions")
    app.fill_label("Save a version now", "Before sign-off")
    app.click_text("Save version", "button", exact=True)
    time.sleep(2)
    shot(app, "30-versions")
    app.click_text("Approve for final render", "button", exact=True)
    time.sleep(2)
    shot(app, "31-after-signoff")


def phase_deliver(app: App):
    stage(app, "Deliver", 2.5)
    shot(app, "32-deliver")
    app.click_selector("button[aria-label='Render H.264']", 0)
    time.sleep(1.5)
    shot(app, "33-render-confirm")
    app.click_text("Confirm and render", ".sheet button", exact=True)
    t0 = time.time()
    time.sleep(5)
    while time.time() - t0 < 900 and "Rendering" in app.text():
        time.sleep(8)
    time.sleep(3)
    print("  render took", round(time.time() - t0), "s")
    app.scroll_to_text("Rendered video")
    shot(app, "34-render-done")


PHASES = {k[6:]: v for k, v in globals().items() if k.startswith("phase_")}

if __name__ == "__main__":
    app = App.attach()
    for name in sys.argv[1:]:
        print("phase", name)
        PHASES[name](app)
    print("done")
