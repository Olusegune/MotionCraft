"""Shapes get art direction: named spheres become rimmed translucent circles spread across the frame; connections become hairlines."""
from __future__ import annotations

from motioncraft_engine.agents.builder import shape_params, shape_role


def L(name, shape="rect"):
    return {"name": name, "shape": shape}


def test_roles_come_from_the_name_and_the_chosen_shape():
    assert shape_role("universe_sphere_2", "rect") == "round"
    assert shape_role("Point_Genesis", "rect") == "point"
    assert shape_role("connection_path_1", "rect") == "link"
    assert shape_role("badge", "ellipse") == "round"
    assert shape_role("panel", "rect") == "plain"


def test_several_spheres_spread_across_the_frame_and_differ_in_size():
    ps = [shape_params(L(f"sphere_{i}"), 3840, 2160, i, 3) for i in range(3)]
    xs = [p["position"][0] for p in ps]
    assert xs == sorted(xs) and xs[0] < 3840 * 0.3 and xs[-1] > 3840 * 0.7
    assert len({p["size"][0] for p in ps}) == 3
    assert all(p["kind"] == "ellipse" and p["fillOpacity"] < 60 and "stroke" in p for p in ps)


def test_one_sphere_is_centred_a_point_is_small_and_a_link_is_a_hairline():
    one = shape_params(L("universe_sphere_1"), 1920, 1080, 0, 1)
    assert one["position"] == [960, 540]
    pt = shape_params(L("point_genesis"), 1920, 1080)
    assert pt["size"][0] <= 40 and pt["fillOpacity"] == 100
    ln = shape_params(L("connection_path_1"), 1920, 1080)
    assert ln["size"][1] <= 4 and ln["size"][0] > 500
