"""What a video model can do is read from the provider's own published schema (recorded copies of a Kie.ai page and a fal OpenAPI document are in tests/fixtures)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from motioncraft_engine.providers.schema import SLOT_ROLES, google_veo, parse_fal, parse_kie

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def seedance():
    return parse_kie((FIX / "kie_seedance2.md").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def veo3_fal():
    return parse_fal(json.loads((FIX / "fal_veo3_fast_i2v_openapi.json").read_text(encoding="utf-8")))


def field(schema, name):
    return next(f for f in schema["fields"] if f["name"] == name)


def test_seedance_2_on_kie_exposes_first_and_last_frame_references_audio_and_21_9(seedance):
    c = seedance["caps"]
    assert c["text"] and c["imageFirst"] and c["imageLast"]
    assert c["imageRefs"] == 9 and c["videoRefs"] == 3 and c["audioRefs"] == 3            # video to video and audio in, as the page says
    assert c["soundOut"] is True
    assert c["aspects"] == ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"]
    assert c["resolutions"] == ["480p", "720p", "1080p", "4k"]
    assert c["durations"]["min"] == 4 and c["durations"]["max"] == 15
    assert field(seedance, "first_frame_url")["role"] == "image_first" and field(seedance, "reference_video_urls")["list"] is True


def test_provider_housekeeping_fields_are_not_offered(seedance):
    names = {f["name"] for f in seedance["fields"]}
    assert "callBackUrl" not in names and "nsfw_checker" not in names and "return_last_frame" not in names


def test_fal_veo3_fast_exposes_its_enums_and_defaults(veo3_fal):
    c = veo3_fal["caps"]
    assert c["imageFirst"] and not c["imageLast"] and c["soundOut"] and c["negativePrompt"] and c["seed"]
    assert c["aspects"] == ["auto", "16:9", "9:16"] and c["resolutions"] == ["720p", "1080p"]
    assert c["durations"]["values"] == ["4s", "6s", "8s"] and c["durations"]["default"] == "8s"
    assert field(veo3_fal, "image_url")["required"] and field(veo3_fal, "prompt")["required"]
    assert field(veo3_fal, "generate_audio")["default"] is True


def test_google_veo_is_a_small_fixed_set():
    c = google_veo()["caps"]
    assert c["imageFirst"] and c["soundOut"] and c["aspects"] == ["16:9", "9:16"] and c["durations"]["values"] == [4, 6, 8]


def test_roles_are_recognised_from_field_names():
    from motioncraft_engine.providers.schema import _role
    assert _role("first_frame_url") == "image_first" and _role("tail_image_url") == "image_last" and _role("reference_image_urls") == "image_refs"
    assert _role("reference_video_urls") == "video_refs" and _role("reference_audio_urls") == "audio_refs" and _role("generate_audio") == "sound"
    assert _role("aspect_ratio") == "aspect_ratio" and _role("camera_fixed") == "other"
    assert set(SLOT_ROLES) == {"image_first", "image_last", "image_refs", "video_refs", "audio_refs"}


def test_a_page_with_no_schema_is_an_error_not_a_guess():
    with pytest.raises(ValueError, match="no OpenAPI block"):
        parse_kie("# A page\n\nNo spec here.")
    with pytest.raises(ValueError):
        parse_fal({"components": {"schemas": {"Other": {}}}})
