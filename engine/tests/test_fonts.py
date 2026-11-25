"""Fonts: the helper lists what EffectCraft can use, records the font of each text layer it makes, and writes the licence it knows into the font manifest, so QA's
font checks can finally say something true (they were 'Not checked' because EffectCraft does not report a layer's font)."""
from __future__ import annotations

import json

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


@pytest.fixture()
def svc(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"width": 1920, "height": 1080, "frame_rate": 30, "duration": 10}})
    s.pkg_path = pkg  # type: ignore[attr-defined]
    return s


def test_the_installed_fonts_are_listed_with_where_they_come_from(svc):
    r = svc.handle("fonts_available", {})
    fams = {f["family"]: f["origin"] for f in r["families"]}
    assert fams["Inter"] == "bundled" and fams["Bahnschrift"] == "system"
    assert [f["family"] for f in svc.handle("fonts_available", {"query": "orbit"})["families"]] == ["Orbitron"]


def plan(font):
    return {"layers": [{"key": "t", "kind": "text", "name": "Title", "role": "title", "text": "HELLO", "size": 80, "font": font, "animations": []}]}


def test_building_records_the_font_and_its_licence_and_qa_can_use_both(svc):
    res = svc.handle("builder_execute", {"plan": plan("Orbitron")})
    assert not [w for w in res["warnings"] if "not installed" in w]
    manifest = json.loads((svc.pkg_path / "fonts" / "manifest.json").read_text())
    assert manifest == [{"family": "Orbitron", "style": "Regular", "source": "system", "licence": "SIL Open Font License 1.1: free to use, including in video", "videoUse": "yes", "sha256": ""}]
    meta = json.loads((svc.pkg_path / "logs" / "text-layers.json").read_text())
    assert list(meta.values()) == [{"size": 80, "font": "Orbitron"}]
    facts = {"deliverable": {"aspect": "16:9", "width": 1920, "height": 1080, "fps": 30, "durationSec": 10, "alpha": False}, "renders": [], "assets": []}
    by = {r["check"]: r for r in svc.handle("qa_run", {"facts": facts})["results"]}
    assert by["missing-fonts"]["state"] == "passed" and by["font-licence"]["state"] == "passed"


def test_a_font_that_is_not_installed_is_said_so_and_qa_finds_it(svc):
    res = svc.handle("builder_execute", {"plan": plan("Eurostile Extended")})
    assert any("Eurostile Extended is not installed" in w for w in res["warnings"])
    facts = {"deliverable": {"aspect": "16:9", "width": 1920, "height": 1080, "fps": 30, "durationSec": 10, "alpha": False}, "renders": [], "assets": []}
    by = {r["check"]: r for r in svc.handle("qa_run", {"facts": facts})["results"]}
    assert by["missing-fonts"]["state"] == "findings" and "Eurostile Extended is not installed" in by["missing-fonts"]["findings"][0]["evidence"]["detail"]
    assert by["font-licence"]["findings"][0]["severity"] == "info"                      # a font whose licence is not known is said plainly, not guessed


def test_a_font_licence_already_in_the_manifest_is_not_overwritten(svc):
    (svc.pkg_path / "fonts" / "manifest.json").write_text(json.dumps([{"family": "Orbitron", "style": "Bold", "source": "user", "licence": "mine", "videoUse": "yes", "sha256": "x"}]))
    svc.handle("builder_execute", {"plan": plan("Orbitron")})
    assert json.loads((svc.pkg_path / "fonts" / "manifest.json").read_text())[0]["licence"] == "mine"
