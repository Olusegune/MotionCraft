"""Green screen clip, keyed and composited in EffectCraft, then handed to After Effects, Resolve and Premiere (run with -m real_engine and EFFECTCRAFT_CLI set, ffmpeg on PATH).
What is checked: the files are written and EffectCraft reads the .aep back; the timelines name every clip; the keyed clip that goes to the editors really has a see-through background.
NOT checked: opening the files inside After Effects or Resolve themselves. A skip is "not checked", never "passed"."""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

from motioncraft_engine.adapter import USER, Command
from motioncraft_engine.adapter.real import EffectCraftAdapter
from motioncraft_engine.sidecar import Service

pytestmark = pytest.mark.real_engine


def cli_or_skip() -> Path:
    cli = os.environ.get("EFFECTCRAFT_CLI")
    if not cli or not Path(cli).exists():
        pytest.skip("EFFECTCRAFT_CLI not set: real engine NOT CHECKED")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed: NOT CHECKED")
    return Path(cli)


@pytest.fixture()
def keyed(tmp_path):
    cli = cli_or_skip()
    s = Service(lambda p: EffectCraftAdapter(cli, read_roots=[p], write_roots=[p]), data_dir=tmp_path / "d")
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    (pkg / "assets" / "video").mkdir(parents=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x00B140:s=320x180:d=2:r=24", "-vf", "drawbox=x=120:y=60:w=80:h=60:color=red:t=fill",
                    "-pix_fmt", "yuv420p", str(pkg / "assets" / "video" / "s.mp4")], check=True)
    s.handle("open", {"package": str(pkg), "settings": {"name": "Main", "width": 320, "height": 180, "frame_rate": 24, "duration": 2}})
    s.handle("add_solid", {"name": "Behind", "color": [1.0, 0.0, 1.0]})
    lid = s.handle("add_media", {"rel": "assets/video/s.mp4"})["layer"]
    s.handle("key_out", {"layers": [lid], "colour": "green"})
    s.pkg_path, s.lid = pkg, lid  # type: ignore[attr-defined]
    yield s
    s.handle("close", {})


def test_composited_in_effectcraft_the_screen_shows_what_is_behind_it(keyed):
    p = keyed.handle("preview", {"times": [0.5], "max_side": 320})
    im = Image.open(io.BytesIO(base64.b64decode(p["png"]))).convert("RGB")
    r, g, b = im.getpixel((10, 10))
    assert r > 200 and b > 200 and g < 60, f"magenta behind the keyed screen expected, got {(r, g, b)}"
    sr, sg, sb = im.getpixel((160, 90))
    assert sr > 200 and sg < 60 and sb < 60, f"the red subject should stay, got {(sr, sg, sb)}"


def test_after_effects_is_told_what_it_will_not_carry_and_the_file_reads_back(keyed):
    first = keyed.handle("export_bridge", {"kind": "aep"})
    assert first["ok"] is False and first["needs_ok"] is True                                  # the key effect cannot be written: nothing is written until the person agrees
    assert any(l["category"] == "effects" and "Screen Color Key" in " ".join(l["details"]) for l in first["losses"])
    assert not (keyed.pkg_path / "exports").exists() or not list((keyed.pkg_path / "exports").rglob("*.aep"))
    done = keyed.handle("export_bridge", {"kind": "aep", "allow_losses": True})
    f = keyed.pkg_path / done["path"]
    assert done["ok"] and f.suffix == ".aep" and f.stat().st_size > 1000
    a = keyed._need()
    back = a.execute([Command(id="file.importAep", params={"path": str(f), "dryRun": True})], actor=USER).results[0].result
    assert back, "EffectCraft reads its own export back"


@pytest.mark.parametrize("kind", ["fcpxml", "xml", "otio", "edl"])
def test_resolve_final_cut_and_premiere_get_a_timeline_and_the_clips(keyed, kind):
    r = keyed.handle("export_bridge", {"kind": kind})
    assert r["ok"] and r["clips"] == 2
    out = (keyed.pkg_path / r["path"]).parent
    assert (keyed.pkg_path / r["path"]).stat().st_size > 50
    movs = sorted(out.glob("*.mov"))
    assert len(movs) >= 1, "the clips the timeline points at are written next to it"


def test_the_keyed_clip_that_goes_to_the_editors_has_a_see_through_background(keyed):
    r = keyed.handle("export_bridge", {"kind": "fcpxml"})
    out = (keyed.pkg_path / r["path"]).parent
    clip = next(m for m in out.glob("*.mov") if "mp4" in m.name or "_s_" in m.name)
    pix = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", str(clip)], capture_output=True, text=True).stdout.strip()
    assert "a" in pix.replace("yuv", "").replace("ayuv", "a") or pix.startswith(("yuva", "argb", "rgba", "bgra")), f"expected an alpha channel, got {pix}"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-frames:v", "1", "-vf", "format=rgba", "-f", "rawvideo", "-"], capture_output=True).stdout
    w = 320
    corner_alpha, centre_alpha = raw[3], raw[(90 * w + 160) * 4 + 3]
    assert corner_alpha < 30 and centre_alpha > 225, f"the screen should be see-through and the subject solid: {corner_alpha}, {centre_alpha}"


def test_a_bad_kind_is_refused(keyed):
    with pytest.raises(Exception, match="Choose one of"):
        keyed.handle("export_bridge", {"kind": "../../evil"})
    time.sleep(0)
