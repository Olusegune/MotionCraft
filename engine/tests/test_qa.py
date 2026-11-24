"""Tier-1 QA checks (P4-02): one test per check, plus the sidecar run on the mock engine. No real EffectCraft was used."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.qa import checks as C
from motioncraft_engine.qa import images
from motioncraft_engine.sidecar import Service

DELIV = {"aspect": "16:9", "width": 1920, "height": 1080, "fps": 30, "durationSec": 10, "alpha": False}


def scene(layers=None, **kw) -> C.Scene:
    base = dict(width=1920, height=1080, fps=30.0, duration=10.0, layers=layers or [], deliverable=dict(DELIV))
    base.update(kw)
    return C.Scene(**base)


def text(id_, t="Hello", pos=(960, 540), size=120, **kw) -> C.Layer:
    return C.Layer(id=id_, name=f"T{id_}", kind="Text", text=t, position=pos, size=size, **kw)


def png(w, h, pixel) -> bytes:
    """An 8-bit RGB PNG; pixel(x, y) -> (r, g, b)."""
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def sev(res): return [f["severity"] for f in res.findings]


# ---------------------------------------------------------------------------------------------------------- framework
def test_every_check_is_registered_and_a_missing_input_is_never_a_pass():
    res = C.run_all(scene())
    assert [r.check for r in res] == ["missing-assets", "missing-fonts", "requested-fonts", "font-licence", "frame-rate", "aspect-ratio", "low-resolution", "safe-title",
                                      "text-collisions", "contrast", "audio-drift", "beat-misalignment", "alpha", "colour-space", "unsupported-effects", "orphan-layers"]
    assert {r.check for r in res if r.state == "not-checked"} >= {"missing-assets", "audio-drift", "beat-misalignment", "colour-space", "unsupported-effects"}
    assert all(r.reason for r in res if r.state == "not-checked")


def test_a_crashing_check_reads_as_not_checked_never_as_passed(monkeypatch):
    def boom(s): raise RuntimeError("x")
    monkeypatch.setattr(C, "CHECKS", [boom])
    r = C.run_all(scene())[0]
    assert r.state == "not-checked" and "failed to run" in r.reason


def test_finding_shape_matches_the_schema():
    f = C.finding("c", "warn", "d", "cause", layer=3, time=1.23456, measured=1.5, threshold=2.0, fix={"label": "x", "safe": True, "commands": []}, estimated=True)
    assert f["tier"] == 1 and f["at"] == {"layerId": 3, "timeSec": 1.235} and f["evidence"] == {"detail": "d", "estimated": True, "measured": 1.5, "threshold": 2.0}
    assert f["fix"]["safe"] is True and len(f["id"]) == 8


# ---------------------------------------------------------------------------------------------------------- 1 missing assets (AT-11)
def test_at11_missing_asset_is_found_and_relinking_is_offered_when_unambiguous(tmp_path):
    (tmp_path / "assets" / "images").mkdir(parents=True)
    (tmp_path / "assets" / "brand").mkdir(parents=True)
    (tmp_path / "assets" / "images" / "ok.png").write_bytes(b"x")
    (tmp_path / "assets" / "brand" / "logo.png").write_bytes(b"x")          # moved here from images/
    s = scene(package=tmp_path, assets=[{"id": "a1", "kind": "image", "path": "assets/images/ok.png"},
                                        {"id": "a2", "kind": "image", "path": "assets/images/logo.png"},
                                        {"id": "a3", "kind": "image", "path": "assets/images/gone.png"},
                                        {"id": "a4", "kind": "image", "path": "../../outside.png"}])
    r = C.missing_assets(s)
    assert r.state == "findings" and len(r.findings) == 3 and set(sev(r)) == {"error"}
    by = {f["evidence"]["assetId"]: f for f in r.findings}
    assert by["a2"]["fix"]["relink"] == {"assetId": "a2", "to": "assets/brand/logo.png"} and by["a2"]["fix"]["safe"] is True
    assert "fix" not in by["a3"] and "fix" not in by["a4"]
    assert C.missing_assets(scene(package=tmp_path, assets=[{"id": "a1", "kind": "image", "path": "assets/images/ok.png"}])).state == "passed"
    assert C.missing_assets(scene()).state == "not-checked"


# ---------------------------------------------------------------------------------------------------------- 2 missing fonts (AT-12)
def test_at12_missing_font_is_detected_per_layer():
    s = scene([text(1, font="Bahnschrift"), text(2, font="Zapfino"), text(3, font="bahnschrift")], installed_fonts={"Bahnschrift", "Arial"})
    r = C.missing_fonts(s)
    assert r.state == "findings" and [f["at"]["layerId"] for f in r.findings] == [2] and "Zapfino" in r.findings[0]["evidence"]["detail"]
    assert C.missing_fonts(scene([text(1, font="Arial")], installed_fonts={"Arial"})).state == "passed"


def test_missing_font_check_says_why_when_it_cannot_run():
    assert "did not report which font" in C.missing_fonts(scene([text(1)], installed_fonts={"Arial"})).reason
    assert "installed fonts" in C.missing_fonts(scene([text(1, font="Arial")], installed_fonts=None)).reason
    assert C.missing_fonts(scene([], installed_fonts=set())).state == "passed"          # no text, nothing to check


# ---------------------------------------------------------------------------------------------------------- 3 font licence
def test_font_licence_uses_the_manifest():
    man = [{"family": "Open Sans", "licence": "OFL", "videoUse": "yes"}, {"family": "Gotham", "licence": "Desktop only", "videoUse": "no"}, {"family": "Odd", "licence": "?"}]
    s = scene([text(1, font="Open Sans"), text(2, font="Gotham"), text(3, font="Unlisted"), text(4, font="Odd")], font_manifest=man)
    r = C.font_licence(s)
    assert {f["at"]["layerId"]: f["severity"] for f in r.findings} == {2: "error", 3: "info", 4: "info"}
    assert C.font_licence(scene([text(1, font="Open Sans")], font_manifest=man)).state == "passed"
    assert C.font_licence(scene([text(1, font="Open Sans")], font_manifest=None)).state == "not-checked"
    assert C.font_licence(scene([text(1)], font_manifest=man)).state == "not-checked"


# ---------------------------------------------------------------------------------------------------------- 4 frame rate, 5 aspect
def test_frame_rate():
    assert C.frame_rate(scene()).state == "passed"
    r = C.frame_rate(scene(fps=24.0))
    assert r.state == "findings" and r.findings[0]["evidence"]["measured"] == 24.0 and r.findings[0]["evidence"]["threshold"] == 30.0
    assert C.frame_rate(scene(deliverable={})).state == "not-checked"
    assert C.frame_rate(scene(fps=29.97, deliverable={**DELIV, "fps": 29.97})).state == "passed"


def test_aspect_ratio_size_and_label():
    assert C.aspect_ratio(scene()).state == "passed"
    assert C.aspect_ratio(scene(width=1080, height=1920)).findings[0]["severity"] == "error"
    r = C.aspect_ratio(scene(width=2560, height=1080, deliverable={**DELIV, "aspect": "21:9", "width": 2560, "height": 1080}))
    assert r.state == "passed", "21:9 against 2560x1080 is within the label tolerance"
    lab = C.aspect_ratio(scene(deliverable={**DELIV, "aspect": "4:5"}))
    assert [f["severity"] for f in lab.findings] == ["warn"]
    assert C.aspect_ratio(scene(deliverable={})).state == "not-checked"


# ---------------------------------------------------------------------------------------------------------- 6 low resolution
def test_low_resolution_reads_picture_sizes(tmp_path):
    (tmp_path / "assets" / "images").mkdir(parents=True)
    (tmp_path / "assets" / "images" / "small.png").write_bytes(png(320, 180, lambda x, y: (9, 9, 9)))
    (tmp_path / "assets" / "images" / "big.png").write_bytes(png(2000, 4, lambda x, y: (9, 9, 9)))
    assets = [{"id": "s", "kind": "image", "path": "assets/images/small.png"}, {"id": "b", "kind": "image", "path": "assets/images/big.png"}]
    layers = [C.Layer(id=5, name="small.png", kind="Footage", scale=(300.0, 300.0))]
    r = C.low_resolution(scene(layers, package=tmp_path, assets=assets))
    assert r.state == "findings" and r.findings[0]["at"] == {"layerId": 5} and r.findings[0]["evidence"]["measured"] == 300.0 and r.findings[0]["severity"] == "warn"
    unused = C.low_resolution(scene([], package=tmp_path, assets=assets))
    assert [f["severity"] for f in unused.findings] == ["info"] and "small.png" in unused.findings[0]["evidence"]["detail"]
    ok = C.low_resolution(scene([C.Layer(id=5, name="small.png", kind="Footage", scale=(100.0, 100.0))], package=tmp_path, assets=assets[1:]))
    assert ok.state == "passed"
    assert C.low_resolution(scene(package=tmp_path, assets=[{"id": "v", "kind": "video", "path": "assets/video/x.mp4"}])).state == "not-checked"
    assert images.size_of(tmp_path / "assets" / "images" / "small.png") == (320, 180)


def test_image_sizes_for_jpeg_and_garbage(tmp_path):
    jpg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\xff\xc0\x00\x11\x08\x02\x58\x03\x20\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    (tmp_path / "a.jpg").write_bytes(jpg)
    (tmp_path / "b.png").write_bytes(b"not an image")
    assert images.size_of(tmp_path / "a.jpg") == (800, 600) and images.size_of(tmp_path / "b.png") is None and images.size_of(tmp_path / "nope.png") is None


# ---------------------------------------------------------------------------------------------------------- 7 safe title
def test_safe_title_uses_estimated_boxes_and_says_so():
    s = scene([text(1, "Centre"), text(2, "Far left edge", pos=(40, 540)), text(3, "Low", pos=(960, 1060))])
    r = C.safe_title(s)
    assert [f["at"]["layerId"] for f in r.findings] == [2, 3] and all(f["evidence"]["estimated"] for f in r.findings)
    assert C.safe_title(scene([text(1)])).state == "passed" and C.safe_title(scene([])).state == "passed"
    assert C.safe_title(scene([C.Layer(id=1, name="x", kind="Text", text="Hi")])).state == "not-checked"


# ---------------------------------------------------------------------------------------------------------- 8 text collisions
def test_text_collisions_need_overlap_in_space_and_time():
    a, b = text(1, "First line", pos=(960, 540)), text(2, "Second line", pos=(980, 560))
    assert C.text_collisions(scene([a, b])).findings[0]["evidence"]["otherLayer"] == 2
    b.t_in, a.t_out = 6.0, 5.0
    assert C.text_collisions(scene([a, b])).state == "passed", "never on screen together"
    far = text(3, "Elsewhere", pos=(960, 100))
    assert C.text_collisions(scene([text(1, "First line"), far])).state == "passed"
    assert C.text_collisions(scene([text(1), C.Layer(id=2, name="n", kind="Text", text="Hi")])).state == "not-checked"


# ---------------------------------------------------------------------------------------------------------- 9 contrast
def test_contrast_is_measured_on_the_rendered_frame():
    l = text(1, "Readable", pos=(480, 270), size=100)
    b = C.box(l)
    def white_on_black(x, y): return (255, 255, 255) if (x * 3 + y * 3) % 2 == 0 and b[0] / 3 < x < b[2] / 3 and b[1] / 3 < y < b[3] / 3 else (0, 0, 0)
    good = C.contrast(scene([l], frames={1: (2.0, png(640, 360, white_on_black))}, width=1920, height=1080))
    assert good.state == "passed"
    flat = C.contrast(scene([l], frames={1: (2.0, png(640, 360, lambda x, y: (120, 120, 120)))}))
    assert flat.state == "findings" and flat.findings[0]["evidence"]["measured"] < 1.1 and flat.findings[0]["evidence"]["threshold"] == 3.0 and flat.findings[0]["at"]["timeSec"] == 2.0
    small = text(2, "Small print here", pos=(480, 270), size=20)
    grey = C.contrast(scene([small], frames={2: (1.0, png(640, 360, lambda x, y: (200, 200, 200) if x % 2 else (120, 120, 120)))}))
    assert grey.findings[0]["evidence"]["threshold"] == 4.5
    assert C.contrast(scene([l])).state == "not-checked" and C.contrast(scene([l], frames={1: (1.0, b"junk")})).state == "not-checked" and C.contrast(scene([])).state == "passed"


def test_png_decoder_and_contrast_maths():
    w, h, lum = images.png_luminance(png(2, 1, lambda x, y: (255, 255, 255) if x == 0 else (0, 0, 0)))
    assert (w, h) == (2, 1) and lum[0] == pytest.approx(1.0, abs=1e-3) and lum[1] == 0.0
    assert images.contrast_ratio(1.0, 0.0) == pytest.approx(21.0)
    assert images.png_luminance(b"nope") is None


# ---------------------------------------------------------------------------------------------------------- 10 audio drift
def test_audio_length_against_the_composition():
    a = lambda d: [{"path": "assets/audio/s.wav", "duration": d, "beats": []}]
    assert C.audio_drift(scene(audio=a(10.2))).state == "passed"
    assert C.audio_drift(scene(audio=a(14.0))).findings[0]["severity"] == "info"
    assert C.audio_drift(scene(audio=a(6.0))).findings[0]["severity"] == "warn"
    r = C.audio_drift(scene(audio_skipped=["assets/audio/x.mp3: needs ffmpeg"]))
    assert r.state == "not-checked" and "needs ffmpeg" in r.reason and C.audio_drift(scene()).reason == "There is no audio in the project."


# ---------------------------------------------------------------------------------------------------------- 11 beat misalignment
def test_beat_markers_must_sit_within_one_frame_of_a_beat():
    audio = [{"path": "s.wav", "duration": 10, "beats": [1.0, 2.0, 3.0]}]
    mk = lambda *ts: [{"time": t, "comment": "motioncraft:beat"} for t in ts]
    assert C.beat_misalignment(scene(audio=audio, markers=mk(1.0, 2.02, 3.0))).state == "passed"       # 0.6 frame
    r = C.beat_misalignment(scene(audio=audio, markers=mk(1.0, 2.2)))
    assert r.state == "findings" and r.findings[0]["evidence"]["measured"] == pytest.approx(6.0, abs=0.01) and r.findings[0]["at"]["timeSec"] == 2.2
    assert C.beat_misalignment(scene(audio=audio, markers=None)).state == "not-checked"
    assert C.beat_misalignment(scene(audio=audio, markers=[])).state == "not-checked"
    assert C.beat_misalignment(scene(audio=[], markers=mk(1.0))).state == "not-checked"
    other = [{"time": 5.0, "comment": "user note"}]
    assert C.beat_misalignment(scene(audio=audio, markers=other)).state == "not-checked", "only beat markers are compared"


# ---------------------------------------------------------------------------------------------------------- 12 alpha
def test_alpha_deliverable_against_renders_and_opaque_backgrounds():
    alpha = {**DELIV, "alpha": True}
    assert C.alpha_errors(scene()).state == "passed"
    s = scene([C.Layer(id=1, name="Background", kind="Solid"), C.Layer(id=2, name="Dim", kind="Solid", opacity=0.0)], deliverable=alpha, renders=[{"preset": "h264"}, {"preset": "prores4444"}])
    r = C.alpha_errors(s)
    assert sorted((f["severity"], f.get("at", {}).get("layerId", 0)) for f in r.findings) == [("error", 0), ("warn", 1)]
    assert C.alpha_errors(scene([], deliverable=alpha, renders=[{"preset": "prores4444"}])).state == "passed"


# ---------------------------------------------------------------------------------------------------------- 13, 14 stated limits
def test_colour_space_and_unsupported_effects_say_why_they_do_not_run():
    for fn in (C.colour_space, C.unsupported_effects):
        r = fn(scene())
        assert r.state == "not-checked" and len(r.reason) > 30


# ---------------------------------------------------------------------------------------------------------- 15 orphans
def test_orphan_layers():
    s = scene([C.Layer(id=1, name="Kid", kind="Shape", parent=99), C.Layer(id=2, name="Blank", kind="Text", text="  "),
               C.Layer(id=3, name="Late", kind="Shape", t_in=12.0, t_out=14.0), C.Layer(id=4, name="Fine", kind="Shape", t_in=0.0, t_out=5.0)])
    r = C.orphan_layers(s)
    assert sorted(f["at"]["layerId"] for f in r.findings) == [1, 2, 3]
    assert C.orphan_layers(scene([C.Layer(id=4, name="Fine", kind="Shape")])).state == "passed"


# ---------------------------------------------------------------------------------------------------------- sidecar on the mock engine
@pytest.fixture
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "data")
    pkg = tmp_path / "P.motioncraft"
    for d in ("images", "audio", "video"):
        (pkg / "assets" / d).mkdir(parents=True)
    (pkg / "fonts").mkdir()
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"width": 1920, "height": 1080, "frame_rate": 30, "duration": 10}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


def test_qa_run_on_the_mock_reports_every_check_and_changes_nothing(svc):
    svc.handle("add_text", {"text": "Hello world"})
    svc.handle("add_text", {"text": "Hello world"})
    before = svc.a.hash_layers(None)
    facts = {"deliverable": DELIV, "assets": [{"id": "x", "kind": "image", "path": "assets/images/missing.png"}], "renders": []}
    out = svc.handle("qa_run", {"facts": facts})
    assert out["total"] == 16 and {r["check"] for r in out["results"]} >= {"missing-assets", "contrast", "orphan-layers"}
    by = {r["check"]: r for r in out["results"]}
    assert by["missing-assets"]["state"] == "findings" and by["frame-rate"]["state"] == "passed" and by["aspect-ratio"]["state"] == "passed"
    assert by["text-collisions"]["state"] == "findings", "two identical texts at the same place and time; their size was recorded when they were made"
    assert by["colour-space"]["state"] == "not-checked" and by["missing-fonts"]["state"] == "not-checked"
    assert out["counts"]["error"] >= 1 and out["checked"] == sum(1 for r in out["results"] if r["state"] != "not-checked")
    assert svc.a.hash_layers(None) == before, "QA is read-only"
    assert svc.handle("qa_run", {"facts": {**facts, "deliverable": {**DELIV, "fps": 24}}})["results"][3]["state"] == "findings"


def test_qa_run_reads_wav_audio_and_checks_the_beat_markers(svc, tmp_path):
    import wave
    f = svc.pkg_path / "assets" / "audio" / "click.wav"
    with wave.open(str(f), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        frames = bytearray(22050 * 6 * 2)
        for beat in range(12):                        # a click every 0.5 s = 120 bpm
            for i in range(200):
                frames[(int(beat * 0.5 * 22050) + i) * 2:(int(beat * 0.5 * 22050) + i) * 2 + 2] = struct.pack("<h", 28000)
        w.writeframes(bytes(frames))
    facts = {"deliverable": DELIV, "assets": [{"id": "a", "kind": "audio", "path": "assets/audio/click.wav"}]}
    by = {r["check"]: r for r in svc.handle("qa_run", {"facts": facts})["results"]}
    assert by["audio-drift"]["state"] == "findings" and "silent" in by["audio-drift"]["findings"][0]["evidence"]["detail"]   # 6 s of audio in a 10 s comp
    assert by["beat-misalignment"]["state"] == "not-checked" and "No beat markers" in by["beat-misalignment"]["reason"]
    beats = svc.handle("audio_analyze", {"rel": "assets/audio/click.wav"})["beats"]
    svc.handle("sync_markers", {"times": beats[:4], "comment": "a user note"})
    by = {r["check"]: r for r in svc.handle("qa_run", {"facts": facts})["results"]}
    assert by["beat-misalignment"]["state"] == "not-checked"                      # markers exist but none is a beat marker
    svc.handle("sync_markers", {"times": beats[:4], "replace": True})             # the default comment tags them as beat markers
    assert {r["check"]: r for r in svc.handle("qa_run", {"facts": facts})["results"]}["beat-misalignment"]["state"] == "passed"
    svc.handle("sync_markers", {"times": [t + 0.2 for t in beats[:2]], "comment": "motioncraft:beat", "replace": True})
    assert {r["check"]: r for r in svc.handle("qa_run", {"facts": facts})["results"]}["beat-misalignment"]["state"] == "findings"


# ---------------------------------------------------------------------------------------------------------- safe fixes (P4-04)
from motioncraft_engine.adapter import Command, USER  # noqa: E402
from motioncraft_engine.adapter.errors import AdapterError, LockedLayerError  # noqa: E402


def test_the_move_fix_brings_the_text_inside_and_is_offered_only_when_it_can_work():
    mx, my = 1920 * 0.05, 1080 * 0.05
    left = C.safe_title(scene([text(1, "Far left edge", pos=(40, 540))])).findings[0]["fix"]
    assert left["safe"] and left["kind"] == "move" and left["label"].startswith("Move it ") and "right" in left["label"]
    cmd = left["commands"][0]
    assert cmd["id"] == "prop.set" and cmd["params"]["layer"] == 1 and cmd["params"]["path"] == "transform/position"
    x, y, z = cmd["params"]["value"]
    moved = text(1, "Far left edge", pos=(x, y))
    assert C.box(moved)[0] == pytest.approx(mx, abs=0.2) and y == 540 and z == 0.0
    assert C.safe_title(scene([moved])).state == "passed", "after the fix the check passes"
    low = C.safe_title(scene([text(1, "Low", pos=(960, 1060))])).findings[0]["fix"]
    assert "up" in low["label"] and low["commands"][0]["params"]["value"][0] == 960
    assert "fix" not in C.safe_title(scene([text(1, "x" * 60, pos=(960, 540), size=200)])).findings[0], "wider than the safe area: moving cannot help"
    keyed = text(1, "Far left edge", pos=(40, 540), position_keyed=True)
    assert "fix" not in C.safe_title(scene([keyed])).findings[0], "an animated position would fight a fixed value"


@pytest.fixture
def fixable(svc):
    """Two text layers on the mock: one hanging off the left edge, one fine. The mock reports no text size on its own, so it is set."""
    ids = []
    for t, pos in (("Far left edge", [40.0, 540.0, 0.0]), ("Centre", [960.0, 540.0, 0.0])):
        lid = svc.handle("add_text", {"text": t})["layer"]
        svc.a.execute([Command(id="prop.set", params={"layer": lid, "path": "text/fontSize", "value": 120}),
                       Command(id="prop.set", params={"layer": lid, "path": "transform/position", "value": pos})], actor=USER)
        ids.append(lid)
    svc.facts = {"deliverable": DELIV}  # type: ignore[attr-defined]
    return svc, ids


def safe_title_result(svc):
    return next(r for r in svc.handle("qa_run", {"facts": svc.facts, "contrast": False})["results"] if r["check"] == "safe-title")


def test_qa_fix_moves_only_the_named_layer_and_the_check_then_passes(fixable):
    svc, (edge, centre) = fixable
    before = svc.a.hash_layers(None)
    res = safe_title_result(svc)
    assert res["state"] == "findings" and res["findings"][0]["at"]["layerId"] == edge and res["findings"][0]["fix"]["safe"]
    out = svc.handle("qa_fix", {"check": "safe-title", "layer": edge, "facts": svc.facts})
    assert out["applied"] == 1 and out["fixed"] == [edge]
    after = svc.a.hash_layers(None)
    assert after[edge] != before[edge] and after[centre] == before[centre], "only the fixed layer changed"
    assert svc.a.layer_props(None, edge)["props"]["transform/position"]["value"][0] > 40
    assert safe_title_result(svc)["state"] == "passed"
    with pytest.raises(AdapterError, match="nothing to fix"):
        svc.handle("qa_fix", {"check": "safe-title", "layer": edge, "facts": svc.facts})


def test_qa_fix_never_touches_an_approved_layer(fixable):
    svc, (edge, _) = fixable
    svc.handle("lock", {"layers": [edge]})
    before = svc.a.hash_layers(None)[edge]
    with pytest.raises(LockedLayerError):
        svc.handle("qa_fix", {"check": "safe-title", "layer": edge, "facts": svc.facts})
    assert svc.a.hash_layers(None)[edge] == before and svc.a.layer_props(None, edge)["props"]["transform/position"]["value"][0] == 40.0


def test_qa_fix_runs_only_known_fixes_and_never_takes_commands_from_the_page(fixable):
    svc, (edge, _) = fixable
    for check in ("frame-rate", "missing-assets", "contrast", "../etc"):
        with pytest.raises(AdapterError, match="no automatic fix"):
            svc.handle("qa_fix", {"check": check, "facts": svc.facts})
    with pytest.raises(TypeError):     # there is no parameter for commands: a page cannot supply its own
        svc.handle("qa_fix", {"check": "safe-title", "layer": edge, "facts": svc.facts, "commands": [{"id": "edit.clear", "params": {}}]})
    assert len(svc.handle("inspect", {})["layers"]) == 2
