"""Checks that need no engine: policy against the committed command snapshot, schemas, hashing, GUI write rule, pin."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from motioncraft_engine.adapter import (Actor, Command, GuiWriteConflict, MockAdapter, CompSettings)  # noqa: E402
from motioncraft_engine.adapter import policy  # noqa: E402
from motioncraft_engine.adapter.pin import PINNED_COMMIT, PINNED_VERSION  # noqa: E402

SNAPSHOT = ROOT / "tests" / "fixtures" / "effectcraft_commands.7e2d025.json"


def test_every_command_the_policy_knows_exists_in_the_pinned_snapshot():
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    have = {c["id"] for c in snap["commands"]}
    missing = sorted(policy.ALLOWED_FOR_AGENTS - have)
    assert not missing, f"commands used by the adapter disappeared or were renamed: {missing}"


def test_layer_params_in_the_policy_match_the_snapshot_schemas():
    snap = {c["id"]: c for c in json.loads(SNAPSHOT.read_text(encoding="utf-8"))["commands"]}
    for cid in policy.SINGLE:
        assert "layer" in snap[cid]["schema"]["properties"], cid
    for cid in policy.LISTED:
        assert "layers" in snap[cid]["schema"]["properties"], cid


def test_pin_matches_the_snapshot_and_lock_file():
    assert (ROOT / "effectcraft.lock").read_text(encoding="utf-8").split()[0] == PINNED_COMMIT
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert snap["pin"] == PINNED_COMMIT
    assert snap["engineVersion"].endswith(PINNED_VERSION)


def test_committed_schemas_are_up_to_date():
    import gen_schemas
    for name, text in gen_schemas.schemas().items():
        f = gen_schemas.OUT / f"{name}.schema.json"
        assert f.read_text(encoding="utf-8") == text, f"{f.name} is stale: run python scripts/gen_schemas.py"


def test_actor_validation():
    assert Actor(name="agent:qa").is_agent and not Actor(name="user").is_agent
    with pytest.raises(ValueError):
        Actor(name="agent:root")


def test_hash_ignores_selection_ui_lock_and_uids_and_rounds_floats():
    a = {"p": {"value": 1.00000049, "uid": 5, "selected": True, "expanded": False, "locked": True}}
    b = {"p": {"value": 1.0, "uid": 99}}
    c = {"p": {"value": 1.001}}
    assert policy.hash_props(a) == policy.hash_props(b) != policy.hash_props(c)
    assert policy.hash_props({"a": 1, "b": 2}) == policy.hash_props({"b": 2, "a": 1})


def test_direct_file_writes_are_refused_while_a_gui_is_attached(tmp_path):
    a = MockAdapter()
    a.create(tmp_path / "p", CompSettings())
    a.attach_gui(49152)
    with pytest.raises(GuiWriteConflict):
        a.create(tmp_path / "q", CompSettings())
    with pytest.raises(GuiWriteConflict):
        a.open(tmp_path / "p" / "comp.ecproj")
    a.detach_gui()
    a.open(tmp_path / "p" / "comp.ecproj")


def test_privileged_or_bad_control_ports_are_refused(tmp_path):
    a = MockAdapter()
    with pytest.raises(ValueError):
        a.attach_gui(0)


def test_mock_rejects_unknown_params_like_the_engine(tmp_path):
    a = MockAdapter()
    a.create(tmp_path / "p", CompSettings())
    from motioncraft_engine.adapter import AdapterContractError, USER
    with pytest.raises(AdapterContractError):
        a.execute([Command(id="layer.newText", params={"nope": 1})], actor=USER)
