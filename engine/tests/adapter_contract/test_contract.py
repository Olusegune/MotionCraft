"""Adapter contract suite (P0-12). Runs on the mock in CI; `-m real_engine` runs the same tests on EffectCraft."""
from __future__ import annotations

import pytest

from motioncraft_engine.adapter import (BUILDER, USER, Command, CommandFailed, FinalRenderJob, LockedLayerError, SpendTokenRequired,
                                        UnsafeCommandError, UserAction)

from .conftest import make_layers


def ids(a):
    return [l.id for l in a.inspect().comp(None).layers]


# ---------------------------------------------------------------- lifecycle and round trip
def test_create_and_inspect(adapter):
    snap = adapter.inspect()
    c = snap.comp("Main")
    assert (c.width, c.height) == (1280, 720)
    assert c.layers == []


def test_layer_ids_survive_save_and_reopen(adapter):
    make_layers(adapter)
    before = ids(adapter)
    path = adapter.inspect().path
    for _ in range(3):
        adapter.save()
        adapter.open(__import__("pathlib").Path(path))
    assert ids(adapter) == before


def test_hash_is_stable_across_reopen_and_changes_on_edit(adapter):
    t, s = make_layers(adapter)
    h0 = adapter.hash_layers(None)
    adapter.save()
    adapter.open(__import__("pathlib").Path(adapter.inspect().path))
    assert adapter.hash_layers(None) == h0
    adapter.execute([Command(id="prop.set", params={"layer": s, "path": "transform/opacity", "value": 33})], actor=BUILDER)
    h1 = adapter.hash_layers(None)
    assert h1[s] != h0[s] and h1[t] == h0[t]


def test_layer_props_show_keyframes(adapter):
    t, _ = make_layers(adapter)
    p = adapter.layer_props(None, t)
    assert len(p["props"]["transform/opacity"]["keys"]) == 3


# ---------------------------------------------------------------- the lock check
LAYER_CMDS = [
    ("prop.set", lambda l: {"layer": l, "path": "transform/opacity", "value": 10}),
    ("prop.addKey", lambda l: {"layer": l, "path": "transform/opacity", "time": 3, "value": 20}),
    ("layer.setText", lambda l: {"layer": l, "text": "changed"}),
    ("layer.rename", lambda l: {"layer": l, "name": "renamed"}),
    ("layer.setTransform", lambda l: {"layers": [l], "prop": "opacity", "value": 5}),
    ("layer.setBlendMode", lambda l: {"layers": [l], "mode": "Multiply"}),
    ("layer.setComment", lambda l: {"layers": [l], "comment": "x"}),
    ("layer.addMarker", lambda l: {"layers": [l], "time": 1, "comment": "m"}),
    ("layer.arrange", lambda l: {"layers": [l], "to": "back"}),
    ("edit.clear", lambda l: {"layers": [l]}),
    ("edit.duplicate", lambda l: {"layers": [l]}),
    ("layer.style.dropShadow", lambda l: {"layers": [l]}),
    ("layer.setSwitch", lambda l: {"layers": [l], "switch": "video", "value": False}),
]


@pytest.mark.parametrize("cmd_id,params", LAYER_CMDS, ids=[c[0] for c in LAYER_CMDS])
def test_agent_cannot_touch_a_locked_layer(adapter, cmd_id, params):
    t, s = make_layers(adapter)
    adapter.lock_layers(None, [t])
    before = adapter.hash_layers(None)
    with pytest.raises(LockedLayerError) as e:
        adapter.execute([Command(id=cmd_id, params=params(t))], actor=BUILDER)
    assert e.value.layer_ids == [t]
    assert adapter.hash_layers(None) == before          # nothing was sent
    assert len(ids(adapter)) == 2


def test_agent_can_still_edit_an_unlocked_layer(adapter):
    t, s = make_layers(adapter)
    adapter.lock_layers(None, [t])
    adapter.execute([Command(id="prop.set", params={"layer": s, "path": "transform/opacity", "value": 40})], actor=BUILDER)


def test_a_locked_layer_in_a_batch_refuses_the_whole_batch(adapter):
    t, s = make_layers(adapter)
    adapter.lock_layers(None, [t])
    before = adapter.hash_layers(None)
    with pytest.raises(LockedLayerError):
        adapter.execute([Command(id="prop.set", params={"layer": s, "path": "transform/opacity", "value": 1}),
                         Command(id="layer.rename", params={"layer": t, "name": "nope"})], actor=BUILDER)
    assert adapter.hash_layers(None) == before          # the first, legal step was not sent either


@pytest.mark.parametrize("cmd_id", ["edit.clear", "layer.setTransform", "layer.arrange", "layer.setBlendMode"])
def test_selection_based_commands_are_refused_for_agents(adapter, cmd_id):
    make_layers(adapter)
    with pytest.raises(UnsafeCommandError):
        adapter.execute([Command(id=cmd_id, params={})], actor=BUILDER)


def test_unknown_commands_are_refused_for_agents(adapter):
    with pytest.raises(UnsafeCommandError):
        adapter.execute([Command(id="made.up.command", params={})], actor=BUILDER)


def test_layer_references_by_index_and_name_are_resolved_for_the_lock_check(adapter):
    t, s = make_layers(adapter)
    adapter.lock_layers(None, [t])
    with pytest.raises(LockedLayerError):
        adapter.execute([Command(id="layer.rename", params={"layer": "Title", "name": "x"})], actor=BUILDER)
    idx = next(l.index for l in adapter.inspect().comp(None).layers if l.id == t)
    with pytest.raises(LockedLayerError):
        adapter.execute([Command(id="prop.set", params={"layer": f"#{idx}", "path": "transform/opacity", "value": 1})], actor=BUILDER)


def test_unlock_needs_a_person_and_then_agents_can_edit(adapter):
    t, _ = make_layers(adapter)
    adapter.lock_layers(None, [t])
    with pytest.raises(PermissionError):
        adapter.unlock_layers(None, [t], by_user="agent")  # type: ignore[arg-type]
    adapter.unlock_layers(None, [t], by_user=UserAction(kind="unlock_layer"))
    adapter.execute([Command(id="prop.set", params={"layer": t, "path": "transform/opacity", "value": 9})], actor=BUILDER)


def test_native_lock_switch_is_set_and_cleared(adapter):
    t, _ = make_layers(adapter)
    adapter.lock_layers(None, [t], native=True)
    assert next(l for l in adapter.inspect().comp(None).layers if l.id == t).native_locked
    adapter.unlock_layers(None, [t], by_user=UserAction(kind="unlock_layer"))
    assert not next(l for l in adapter.inspect().comp(None).layers if l.id == t).native_locked


# ---------------------------------------------------------------- drift
def test_a_hand_edit_is_detected_as_drift_and_never_reverted(adapter):
    t, s = make_layers(adapter)
    approved = adapter.hash_layers(None, [t, s])
    adapter.lock_layers(None, [t])
    adapter.execute([Command(id="prop.set", params={"layer": t, "path": "transform/opacity", "value": 77})], actor=USER)  # the person
    assert adapter.detect_drift(None, approved) == [t]
    assert adapter.layer_props(None, t)["props"]["transform/opacity"]["value"] == 77.0  # still the user's value


# ---------------------------------------------------------------- batch semantics
def test_batch_stops_at_the_first_failure_and_reports_each_step(adapter):
    t, _ = make_layers(adapter)
    steps = [Command(id="prop.set", params={"layer": t, "path": "transform/opacity", "value": 11}),
             Command(id="prop.set", params={"layer": t, "path": "transform/opacity", "value": 1, "bogus": True}),
             Command(id="prop.set", params={"layer": t, "path": "transform/opacity", "value": 22})]
    with pytest.raises(Exception) as e:
        adapter.execute(steps, actor=BUILDER)
    assert isinstance(e.value, (CommandFailed, __import__("motioncraft_engine.adapter", fromlist=["x"]).AdapterContractError))
    assert adapter.layer_props(None, t)["props"]["transform/opacity"]["value"] == 11.0  # step 1 applied, step 3 never ran


# ---------------------------------------------------------------- output
def test_preview_returns_a_png(adapter):
    make_layers(adapter)
    p = adapter.preview(None, [0.0, 1.0], max_side=480)
    assert p.png[:8] == b"\x89PNG\r\n\x1a\n" and p.contact_sheet


def test_final_render_needs_a_spend_token(adapter):
    make_layers(adapter)
    job = FinalRenderJob(comp=adapter.inspect().active_comp, preset="h264", output=adapter.tmp / "out.mp4")
    for bad in ("", "guess"):
        with pytest.raises(SpendTokenRequired):
            adapter.render_final(job, bad)
    assert not job.output.exists()
    r = adapter.render_final(job, "token-from-a-user-click")
    assert job.output.exists() and r.bytes > 0


def test_export_lottie_lists_warnings_and_ecproj_copy_is_written(adapter):
    adapter.execute([Command(id="layer.newText", params={"text": "T"}), Command(id="layer.newCamera", params={})], actor=BUILDER)
    r = adapter.export("lottie", None, adapter.tmp / "x.json")
    assert r.path.exists() and any("amera" in w for w in r.warnings)
    c = adapter.export("ecproj_copy", None, adapter.tmp / "copy.ecproj")
    assert c.bytes > 0


# ---------------------------------------------------------------- events
def test_events_report_commands_locks_and_refusals(adapter):
    seen = []
    off = adapter.subscribe(seen.append)
    t, _ = make_layers(adapter)
    adapter.lock_layers(None, [t])
    with pytest.raises(LockedLayerError):
        adapter.execute([Command(id="layer.rename", params={"layer": t, "name": "x"})], actor=BUILDER)
    off()
    kinds = {e.kind for e in seen}
    assert {"command", "lock", "refused"} <= kinds
