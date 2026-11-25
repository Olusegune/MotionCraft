"""Text with an en dash, curly quotes or an emoji must go through the helper unchanged, whatever the Windows code page is."""
from __future__ import annotations

import json
import os
import subprocess
import sys

TEXT = "CIVILIZATION I–VII · “It starts with a light coming on.” 🙂"


def test_helper_reads_utf8_from_the_page_even_when_the_locale_is_not_utf8(tmp_path):
    env = dict(os.environ, PYTHONUTF8="0", PYTHONIOENCODING="cp1252")          # what a frozen Windows build sees
    p = subprocess.Popen([sys.executable, "-m", "motioncraft_engine.sidecar", "--mock"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
                         cwd=os.path.dirname(os.path.dirname(__file__)))
    pkg = tmp_path / "P.motioncraft"
    (pkg / "fonts").mkdir(parents=True)
    (pkg / "fonts" / "manifest.json").write_text("[]")
    reqs = [{"id": 1, "method": "open", "params": {"package": str(pkg), "settings": {"width": 640, "height": 360, "frame_rate": 24, "duration": 10}}},
            {"id": 2, "method": "qa_run", "params": {"facts": {"deliverable": {"aspect": "16:9", "width": 640, "height": 360, "fps": 24, "durationSec": 10, "alpha": False}, "renders": [],
                "assets": [{"id": "a", "kind": "image", "path": "assets/images/a.png", "source": "import", "rights": None, "name": TEXT}]}}}]
    data = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in reqs).encode("utf-8")
    out, _ = p.communicate(data, timeout=60)
    replies = [json.loads(line) for line in out.decode("utf-8").splitlines() if line.strip()]
    assert all(r["ok"] for r in replies), replies
    rights = next(r for r in replies[1]["result"]["results"] if r["check"] == "rights-unconfirmed")
    assert TEXT in rights["findings"][0]["evidence"]["detail"], rights["findings"][0]["evidence"]["detail"]
