"""Sidecar protocol tests (mock engine; the real engine is covered by the adapter contract suite and a manual smoke run)."""
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from motioncraft_engine.adapter import MockAdapter
from motioncraft_engine.sidecar import Service, serve


def run(lines: list[dict]) -> list[dict]:
    rin = io.StringIO("".join(json.dumps(l) + "\n" for l in lines))
    rout = io.StringIO()
    serve(Service(lambda pkg: MockAdapter()), rin, rout)
    return [json.loads(x) for x in rout.getvalue().splitlines()]


@pytest.fixture
def pkg(tmp_path):
    p = tmp_path / "Demo.motioncraft"
    p.mkdir()
    return str(p)


def test_open_creates_the_composition_and_lists_no_layers(pkg):
    r = run([{"id": 1, "method": "open", "params": {"package": pkg, "settings": {"name": "Main", "width": 1280, "height": 720, "frame_rate": 30, "duration": 5}}}])
    assert r[0]["ok"] and r[0]["result"]["layers"] == []
    assert (Path(pkg) / "comp.ecproj").exists()


def test_add_text_change_text_and_reopen_keeps_layers(pkg):
    r = run([
        {"id": 1, "method": "open", "params": {"package": pkg}},
        {"id": 2, "method": "add_text", "params": {"text": "Hello"}},
        {"id": 3, "method": "close", "params": {}},
        {"id": 4, "method": "open", "params": {"package": pkg}},
    ])
    assert all(x["ok"] for x in r), r
    assert [l["name"] for l in r[3]["result"]["layers"]] == ["Hello"]


def test_lock_marks_layer_and_hash_is_reported(pkg):
    r = run([
        {"id": 1, "method": "open", "params": {"package": pkg}},
        {"id": 2, "method": "add_text", "params": {"text": "T"}},
    ])
    lid = r[1]["result"]["layer"]
    r2 = run([
        {"id": 1, "method": "open", "params": {"package": pkg}},
        {"id": 2, "method": "lock", "params": {"layers": [lid]}},
        {"id": 3, "method": "unlock", "params": {"layers": [lid]}},
    ])
    assert r2[1]["result"]["layers"][0]["approvedHere"] is True
    assert r2[1]["result"]["layers"][0]["hash"]
    assert r2[2]["result"]["layers"][0]["approvedHere"] is False


def test_preview_returns_png_base64(pkg):
    import base64
    r = run([{"id": 1, "method": "open", "params": {"package": pkg}}, {"id": 2, "method": "preview", "params": {"times": [0, 1], "max_side": 480}}])
    assert base64.b64decode(r[1]["result"]["png"])[:4] == b"\x89PNG"


def test_errors_are_replies_and_the_loop_keeps_serving(pkg):
    r = run([{"id": 1, "method": "inspect", "params": {}}, {"id": 2, "method": "nope", "params": {}},
             {"id": 3, "method": "_factory", "params": {}}, {"id": 4, "method": "open", "params": {"package": pkg}}])
    assert [x["ok"] for x in r] == [False, False, False, True]


def test_open_refuses_a_folder_that_is_not_a_package(tmp_path):
    r = run([{"id": 1, "method": "open", "params": {"package": str(tmp_path)}}])
    assert not r[0]["ok"]


def test_bad_json_line_does_not_kill_the_process():
    out = subprocess.run([sys.executable, "-m", "motioncraft_engine.sidecar", "--mock"], input="not json\n{\"id\":9,\"method\":\"inspect\"}\n",
                         capture_output=True, text=True, cwd=Path(__file__).resolve().parents[1], timeout=30)
    lines = [json.loads(x) for x in out.stdout.splitlines()]
    assert len(lines) == 2 and not lines[0]["ok"] and lines[1]["id"] == 9
