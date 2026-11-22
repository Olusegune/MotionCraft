"""Minimal stdio JSON-RPC client for `effectcraft-cli mcp`, for spike scripts only.

Spike code is allowed to talk to the engine directly. Product code is not: it goes through
engine/motioncraft_engine/adapter/ (AGENTS.md hard rule).

Always starts the server confined (--automation-read-root / --automation-write-root).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path

PIN = "7e2d0256209974ffb92a29d8bdb6f2a49078f51f"


def default_cli() -> Path:
    env = os.environ.get("EFFECTCRAFT_CLI")
    if env:
        return Path(env)
    exe = "effectcraft-cli.exe" if os.name == "nt" else "effectcraft-cli"
    return Path(__file__).resolve().parents[2] / "effectcraft" / "target" / "release" / exe


class McpError(RuntimeError):
    def __init__(self, message: str, code: int | None = None, data=None):
        super().__init__(message)
        self.code, self.data = code, data


class McpClient:
    def __init__(self, workdir: Path, *, cli: Path | None = None, extra_args: list[str] | None = None,
                 read_roots: list[Path] | None = None, write_roots: list[Path] | None = None,
                 confined: bool = True, env: dict | None = None):
        self.workdir = Path(workdir).resolve()
        self.workdir.mkdir(parents=True, exist_ok=True)
        cli = cli or default_cli()
        args = [str(cli), "mcp"]
        if confined:
            for r in (read_roots or [self.workdir]):
                args += ["--automation-read-root", str(Path(r).resolve())]
            for w in (write_roots or [self.workdir]):
                args += ["--automation-write-root", str(Path(w).resolve())]
        args += extra_args or []
        self.args = args
        # narrowest environment that still lets the engine run
        child_env = {k: v for k, v in os.environ.items()
                     if k.upper() in {"PATH", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA",
                                      "LOCALAPPDATA", "HOME", "WINDIR", "COMSPEC", "PATHEXT"}}
        child_env.update(env or {})
        self.proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1,
                                     env=child_env, shell=False)
        self.stderr_lines: list[str] = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self._id = 0

    def _drain_stderr(self):
        for line in self.proc.stderr:
            self.stderr_lines.append(line.rstrip())

    def _send(self, msg: dict):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def request(self, method: str, params: dict | None = None):
        self._id += 1
        rid = self._id
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise McpError(f"server closed; stderr tail: {self.stderr_lines[-5:]}")
            msg = json.loads(line)
            if msg.get("id") == rid:
                if "error" in msg:
                    e = msg["error"]
                    raise McpError(e.get("message", "error"), e.get("code"), e.get("data"))
                return msg["result"]
            # notifications (progress etc.) are ignored

    def initialize(self):
        r = self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                        "clientInfo": {"name": "motioncraft-spike", "version": "0"}})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return r

    def tool(self, name: str, arguments: dict | None = None, *, raise_on_error: bool = True):
        """Returns (parsed_json_or_text, is_error)."""
        res = self.request("tools/call", {"name": name, "arguments": arguments or {}})
        is_err = bool(res.get("isError"))
        parts = [c for c in res.get("content", []) if c.get("type") == "text"]
        text = "\n".join(p["text"] for p in parts)
        try:
            val = json.loads(text) if text else None
        except json.JSONDecodeError:
            val = text
        if is_err and raise_on_error:
            raise McpError(f"{name} failed: {text[:500]}", data=val)
        return val, is_err

    def run(self, cmd_id: str, params: dict | None = None, **kw):
        return self.tool("command_run", {"id": cmd_id, "params": params or {}}, **kw)

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=20)
        except Exception:
            self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
