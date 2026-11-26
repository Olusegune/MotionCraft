"""Keying a flat screen out: bad requests are refused, and a keyed clip's placement asks for it (mock adapter; the real pixels are in test_key_out_real.py)."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service


@pytest.fixture()
def svc(tmp_path):
    s = Service(lambda p: MockAdapter(), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    s.handle("open", {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 24, "duration": 10}})
    return s


@pytest.mark.parametrize("bad", [{"layers": [1], "colour": "red"}, {"layers": [], "colour": "green"}, {"layers": list(range(30)), "colour": "green"}, {"layers": "x", "colour": "blue"}])
def test_bad_key_requests_are_refused(svc, bad):
    with pytest.raises(Exception):
        svc.handle("key_out", bad)


def test_the_two_screens_are_the_ones_a_model_is_asked_for():
    assert Service.KEY_COLOURS["green"][1] > Service.KEY_COLOURS["green"][0] and Service.KEY_COLOURS["green"][1] > Service.KEY_COLOURS["green"][2]
    assert Service.KEY_COLOURS["blue"][2] > Service.KEY_COLOURS["blue"][0] and Service.KEY_COLOURS["blue"][2] > Service.KEY_COLOURS["blue"][1]
