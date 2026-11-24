"""Looking for lettering in a picture: only a model on this computer may see it (mock LLM; no network)."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


def make(tmp_path):
    s = Service(lambda pkg: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "assets" / "images").mkdir(parents=True)
    PIL = pytest.importorskip("PIL.Image")
    PIL.new("RGB", (64, 64), (200, 30, 30)).save(pkg / "assets" / "images" / "a.png")
    s.handle("open", {"package": str(pkg), "settings": {"width": 1920, "height": 1080, "frame_rate": 30, "duration": 10}})
    return s


def test_a_local_model_is_shown_the_picture_and_its_answer_is_returned(tmp_path):
    s = make(tmp_path)
    seen = {}

    def fake_complete(**kw):
        seen.update(kw)
        return {"json": {"has_text": True, "text": "TYPE"}}
    s.llm.complete = fake_complete
    r = s.handle("picture_check", {"rel": "assets/images/a.png", "provider": "ollama", "model": "gemma3:12b"})
    assert r == {"has_text": True, "text": "TYPE"}
    assert seen["images"] and len(seen["images"]) == 1


def test_a_cloud_model_is_never_shown_a_picture(tmp_path):
    s = make(tmp_path)
    with pytest.raises(Exception, match="only shown to a language model that runs on this computer"):
        s.llm.complete(provider="openai", model="x", messages=[{"role": "user", "content": "hi"}], images=["AAAA"], spend_token="t", api_key="k")


def test_only_pictures_inside_the_project_can_be_checked(tmp_path):
    s = make(tmp_path)
    with pytest.raises(Exception):
        s.handle("picture_check", {"rel": "../../outside.png", "provider": "ollama", "model": "m"})
