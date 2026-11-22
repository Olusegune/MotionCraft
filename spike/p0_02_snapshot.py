"""P0-02: snapshot command_list {schemas:true} and check the command/param names used in ENGINE_ADAPTER.md.

Writes engine/tests/fixtures/effectcraft_commands.<sha7>.json and prints a table of every command id the
docs rely on, with its accepted params. Exit code 1 if a documented command is missing.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from mcp_client import PIN, McpClient, default_cli  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "engine" / "tests" / "fixtures" / f"effectcraft_commands.{PIN[:7]}.json"

# Command ids that ENGINE_ADAPTER.md / PHASE0_SPIKE.md rely on.
DOCUMENTED = [
    "file.newProject", "file.open", "file.save", "comp.new", "layer.tree", "prop.get", "layer.setSwitch",
    "layer.newText", "layer.setText", "text.sourceText.style", "text.fonts", "text.fontFeatures",
    "renderQueue.add", "renderQueue.render", "file.checkOutput", "file.exportLottie", "comp.addMarker",
    "comp.deleteAllMarkers", "layer.addMarker", "edit.clear", "layer.arrange", "prop.addKey", "prop.set",
]


def main() -> int:
    cli = default_cli()
    version = subprocess.run([str(cli), "--version"], capture_output=True, text=True, check=True).stdout.strip()
    with tempfile.TemporaryDirectory() as td, McpClient(Path(td)) as c:
        init = c.initialize()
        tools, _ = c.request("tools/list"), None
        listing, _ = c.tool("command_list", {"schemas": True})
    cmds = listing["commands"] if isinstance(listing, dict) and "commands" in listing else listing
    by_id = {x.get("id"): x for x in cmds}
    snapshot = {"engineVersion": version, "pin": PIN, "mcpServerInfo": init.get("serverInfo"),
                "mcpTools": sorted(t["name"] for t in tools["tools"]), "commandCount": len(cmds),
                "commands": sorted(cmds, key=lambda x: x.get("id", ""))}
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"engine: {version}\ncommands: {len(cmds)}\nfixture: {FIXTURE.relative_to(ROOT)}\nmcp tools: {snapshot['mcpTools']}\n")
    missing = []
    for cid in DOCUMENTED:
        x = by_id.get(cid)
        if not x:
            missing.append(cid)
            print(f"MISSING  {cid}")
            continue
        schema = x.get("schema") or {}
        props = sorted((schema.get("properties") or {}).keys())
        req = schema.get("required") or []
        print(f"ok       {cid:28} params={props} required={req}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
