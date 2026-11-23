"""EffectCraftAdapter: the real engine over MCP stdio (`effectcraft-cli mcp`), always confined.

The only module allowed to talk to effectcraft-cli, the control port or the MCP server (AGENTS.md).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from pathlib import Path
from typing import Any

from .base import BaseAdapter, SpendVerifier
from .errors import (AdapterContractError, EnginePinMismatch, EngineUnavailable, GuiWriteConflict)
from .models import (Command, CompInfo, CompSettings, DocSnapshot, ExportResult, FinalRenderJob, LayerInfo, MarkerInfo,
                     PreviewResult, ProjectHandle, RenderResult)
from .pin import PINNED_VERSION

_ENV_KEEP = {"PATH", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "WINDIR", "COMSPEC", "PATHEXT"}


class _Stdio:
    """JSON-RPC over the child's stdin/stdout, one message per line. No shell is ever used."""

    def __init__(self, args: list[str]):
        env = {k: v for k, v in os.environ.items() if k.upper() in _ENV_KEEP}
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                  encoding="utf-8", bufsize=1, env=env, shell=False)
        self.err: list[str] = []
        threading.Thread(target=lambda: [self.err.append(l.rstrip()) for l in self.p.stderr], daemon=True).start()
        self.n = 0

    def call(self, method: str, params: dict | None = None) -> Any:
        self.n += 1
        rid = self.n
        try:
            self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}) + "\n")
            self.p.stdin.flush()
            while True:
                line = self.p.stdout.readline()
                if not line:
                    raise EngineUnavailable(f"engine closed the connection: {self.err[-3:]}")
                msg = json.loads(line)
                if msg.get("id") == rid:
                    if "error" in msg:
                        e = msg["error"]
                        if e.get("code") == -32602:
                            raise AdapterContractError(e.get("message", "invalid params"))
                        raise RuntimeError(e.get("message", "error"))
                    return msg["result"]
        except (BrokenPipeError, OSError) as e:
            raise EngineUnavailable(str(e)) from e

    def notify(self, method: str) -> None:
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method}) + "\n")
        self.p.stdin.flush()

    def close(self) -> None:
        try:
            self.p.stdin.close()
            self.p.wait(timeout=20)
        except Exception:  # noqa: BLE001
            self.p.kill()


class EffectCraftAdapter(BaseAdapter):
    def __init__(self, cli: Path, *, read_roots: list[Path], write_roots: list[Path], spend_verifier: SpendVerifier | None = None,
                 expected_version: str = PINNED_VERSION):
        super().__init__(spend_verifier)
        self.cli = Path(cli)
        self.read_roots = [Path(p).resolve() for p in read_roots]
        self.write_roots = [Path(p).resolve() for p in write_roots]
        if not self.write_roots:
            raise ValueError("at least one write root is required: the engine is always confined")
        self._expected = expected_version
        self._io: _Stdio | None = None
        self._path: Path | None = None

    # ------------------------------------------------------------- process
    def version(self) -> str:
        out = subprocess.run([str(self.cli), "--version"], capture_output=True, text=True, timeout=10, shell=False).stdout
        m = re.search(r"\d+\.\d+\.\d+", out)
        return m.group(0) if m else out.strip()

    def _start(self, bridge: int | None = None) -> None:
        found = self.version()
        if found != self._expected:
            raise EnginePinMismatch(found, self._expected)
        args = [str(self.cli), "mcp"]
        for r in self.read_roots:
            args += ["--automation-read-root", str(r)]
        for w in self.write_roots:
            args += ["--automation-write-root", str(w)]
        if bridge is not None:
            args += ["--bridge", str(bridge)]
        io = _Stdio(args)
        io.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "motioncraft-adapter", "version": "0"}})
        io.notify("notifications/initialized")
        self._io = io

    def _need(self) -> _Stdio:
        if self._io is None:
            self._start()
        return self._io  # type: ignore[return-value]

    def _tool(self, name: str, args: dict | None = None) -> Any:
        io = self._need()
        try:
            res = io.call("tools/call", {"name": name, "arguments": args or {}})
        except EngineUnavailable:
            self._io = None  # restart once (docs: Errors), then surface
            io = self._need()
            res = io.call("tools/call", {"name": name, "arguments": args or {}})
        text = "\n".join(c["text"] for c in res.get("content", []) if c.get("type") == "text")
        try:
            val = json.loads(text) if text else None
        except json.JSONDecodeError:
            val = text
        if res.get("isError"):
            if isinstance(val, str) and "invalid parameters" in val and "is locked" not in val:
                raise AdapterContractError(val)
            raise RuntimeError(val if isinstance(val, str) else json.dumps(val))
        return val

    def _run(self, cmd: Command, *, force_unlock: list[int] | None = None) -> Any:
        return self._tool("command_run", {"id": cmd.id, "params": cmd.params})

    def _under(self, p: Path, roots: list[Path]) -> bool:
        p = p.resolve()
        return any(p == r or r in p.parents for r in roots)

    # ------------------------------------------------------------- lifecycle
    def create(self, package_dir: Path, settings: CompSettings) -> ProjectHandle:
        self._guard_direct_file_write()
        if not self._under(package_dir, self.write_roots):
            raise ValueError("package_dir is outside the write roots")
        package_dir.mkdir(parents=True, exist_ok=True)
        self._run(Command(id="file.newProject"))
        cid = self._run(Command(id="comp.new", params={"name": settings.name, "width": settings.width, "height": settings.height,
                                                       "frameRate": settings.frame_rate, "duration": settings.duration}))["comp"]
        self._path = package_dir / "comp.ecproj"
        self._run(Command(id="file.save", params={"path": str(self._path)}))
        return ProjectHandle(path=self._path, active_comp=cid)

    def open(self, ecproj: Path) -> ProjectHandle:
        self._guard_direct_file_write()
        if not self._under(Path(ecproj), self.read_roots + self.write_roots):
            raise ValueError("ecproj is outside the read/write roots")
        self._run(Command(id="file.open", params={"path": str(ecproj)}))
        self._path = Path(ecproj)
        self._emit("opened", path=str(ecproj))
        return ProjectHandle(path=self._path, active_comp=self.inspect().active_comp)

    def save(self) -> None:
        if self._path is None:
            raise EngineUnavailable("no project open")
        self._run(Command(id="file.save", params={"path": str(self._path)}))
        self._emit("saved", path=str(self._path))

    def close(self) -> None:
        if self._io:
            self._io.close()
            self._io = None
        self._path = None

    # ------------------------------------------------------------- reads
    def inspect(self) -> DocSnapshot:
        proj = self._tool("get_project")
        comps = []
        for it in proj.get("items", []):
            if it.get("type") != "Composition":
                continue
            c = self._tool("get_comp", {"comp": it["id"]})
            layers = [LayerInfo(id=l["id"], name=l["name"], kind=l["type"], index=l["index"], parent=l.get("parent"),
                                native_locked=bool(l["switches"].get("locked"))) for l in c.get("layers", [])]
            comps.append(CompInfo(id=it["id"], name=it["name"], width=it["size"][0], height=it["size"][1],
                                  frame_rate=it["frameRate"], duration=it["duration"], layers=layers, markers=[]))
        return DocSnapshot(path=proj.get("path"), dirty=bool(proj.get("dirty")), active_comp=proj.get("activeComp"), comps=comps)

    def layer_props(self, comp: int | str, layer_id: int) -> dict:
        tree = self._run(Command(id="layer.tree", params={"layer": layer_id, "comp": comp}))
        props: dict[str, Any] = {}

        def walk(n: dict) -> None:
            if "children" in n:
                for ch in n["children"]:
                    walk(ch)
            elif "path" in n:
                props[n["path"]] = {"type": n.get("type"), "value": n.get("value")}
        walk(tree["properties"])
        for path in list(props):
            try:
                p = self._run(Command(id="prop.get", params={"layer": layer_id, "path": path, "comp": comp}))
            except Exception:  # noqa: BLE001
                continue
            if isinstance(p, dict) and p.get("keys"):
                props[path]["keys"] = p["keys"]
        return {"name": tree.get("name"), "blend": tree.get("blendMode"), "in": tree.get("in"), "out": tree.get("out"),
                "parent": tree.get("parent"), "props": props}

    # ------------------------------------------------------------- locks (real engine specifics)
    def _native_unlock(self, comp_id: int, layer_ids: list[int]) -> None:
        # layer.setSwitch skips locked layers (P0-10), so use layer.unlockAll and re-lock the rest of the registry.
        self._run(Command(id="layer.unlockAll"))
        keep = sorted(self._locked.get(comp_id, set()) - set(layer_ids))
        if keep:
            self._run(Command(id="layer.setSwitch", params={"layers": keep, "switch": "lock", "value": True}))

    # ------------------------------------------------------------- output
    def preview(self, comp: int | str, times: list[float], max_side: int = 960) -> PreviewResult:
        import base64
        io = self._need()
        args: dict[str, Any] = {"comp": comp, "max_side": max_side}
        args.update({"times": times} if len(times) > 1 else {"time": times[0]})
        try:
            res = io.call("tools/call", {"name": "render_preview", "arguments": args})
        except AdapterContractError:
            if len(times) <= 1:
                raise
            # The released EffectCraft 0.24.1 has no contact sheet (`times`), the pinned commit does: fall back to one frame.
            res = io.call("tools/call", {"name": "render_preview", "arguments": {"comp": comp, "max_side": max_side, "time": times[0]}})
            times = times[:1]
        png = next((base64.b64decode(c["data"]) for c in res.get("content", []) if c.get("type") == "image"), b"")
        meta = next((json.loads(c["text"]) for c in res.get("content", []) if c.get("type") == "text"), {})
        if not png:
            raise RuntimeError("render_preview returned no image")
        return PreviewResult(comp=meta.get("comp", 0), times=list(times), width=meta.get("width", 0), height=meta.get("height", 0),
                             png=png, contact_sheet=len(times) > 1)

    def _render(self, job: FinalRenderJob) -> RenderResult:
        if not self._under(job.output, self.write_roots):
            raise ValueError("render output is outside the write roots")
        self._run(Command(id="file.checkOutput", params={"path": str(job.output)}))
        params: dict[str, Any] = {"comp": job.comp, "output": str(job.output)}
        params.update({"format": "prores", "proresProfile": "4444", "channels": "rgba"} if job.preset == "prores4444" else {"format": "h264"})
        self._run(Command(id="renderQueue.add", params=params))
        out = self._run(Command(id="renderQueue.render", params={"wait": True}))
        if isinstance(out, dict) and out.get("failed"):
            raise RuntimeError(f"render failed: {out}")
        frames = sum(i.get("frames", 0) for i in (out or {}).get("items", []))
        return RenderResult(output=job.output, frames=frames, bytes=job.output.stat().st_size if job.output.exists() else 0)

    def export(self, kind: str, comp: int | str, path: Path) -> ExportResult:
        if not self._under(path, self.write_roots):
            raise ValueError("export path is outside the write roots")
        if kind == "ecproj_copy":
            self._run(Command(id="file.saveCopy", params={"path": str(path)}))
            return ExportResult(path=path, bytes=path.stat().st_size)
        out = self._run(Command(id="file.exportLottie", params={"comp": comp, "path": str(path)}))
        return ExportResult(path=path, bytes=out["bytes"], warnings=list(out.get("warnings", [])))

    # ------------------------------------------------------------- GUI bridge
    def _attach(self, port: int) -> None:
        if port < 1024:
            raise ValueError("refusing a privileged control port")
        if self._io:
            self._io.close()
        self._start(bridge=port)

    def _detach(self) -> None:
        if self._io:
            self._io.close()
        self._io = None

    def _gui_has_unsaved(self) -> bool:
        try:
            return bool(self.inspect().dirty) and self._gui_port is not None
        except Exception:  # noqa: BLE001
            return False

    def _guard_direct_file_write(self) -> None:
        if self._gui_port is not None:
            raise GuiWriteConflict("a GUI session has this project open; direct file writes are lost. Use the bridge")
