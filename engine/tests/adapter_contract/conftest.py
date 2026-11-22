"""Contract fixtures. Every test in this folder runs against the MockAdapter in CI and, with `-m real_engine` and
EFFECTCRAFT_CLI set, against the real engine. A skipped real-engine test is "not checked", never "passed"."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from motioncraft_engine.adapter import BUILDER, Command, CompSettings, MockAdapter
from motioncraft_engine.adapter.real import EffectCraftAdapter


def pytest_collection_modifyitems(config, items):
    pass


@pytest.fixture(params=["mock", pytest.param("real", marks=pytest.mark.real_engine)])
def adapter(request, tmp_path: Path):
    verifier = lambda token: token == "token-from-a-user-click"  # noqa: E731
    if request.param == "mock":
        a = MockAdapter(spend_verifier=verifier)
    else:
        cli = os.environ.get("EFFECTCRAFT_CLI")
        if not cli or not Path(cli).exists():
            pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
        a = EffectCraftAdapter(Path(cli), read_roots=[tmp_path], write_roots=[tmp_path], spend_verifier=verifier)
    a.create(tmp_path / "pkg", CompSettings(name="Main", width=1280, height=720, frame_rate=30, duration=4))
    a.tmp = tmp_path  # type: ignore[attr-defined]
    yield a
    a.close()


def make_layers(a) -> tuple[int, int]:
    """A text layer and a shape layer with keyframes, made by the builder agent. Returns (text_id, shape_id)."""
    r = a.execute([Command(id="layer.newText", params={"text": "Title"}), Command(id="layer.newShape", params={"kind": "rect"})],
                  actor=BUILDER)
    t, s = r.results[0].result["layer"], r.results[1].result["layer"]
    a.execute([Command(id="prop.addKey", params={"layer": t, "path": "transform/opacity", "time": 0, "value": 0}),
               Command(id="prop.addKey", params={"layer": t, "path": "transform/opacity", "time": 1, "value": 100}),
               Command(id="prop.addKey", params={"layer": t, "path": "transform/opacity", "time": 2, "value": 50})], actor=BUILDER)
    return t, s
