# Engine adapter contract

The adapter is the only code that talks to EffectCraft. It lives in `engine/motioncraft_engine/adapter/`. Two
implementations ship: `EffectCraftAdapter` (real, MCP over stdio) and `MockAdapter` (in-memory, deterministic, used by
CI). Both must pass the same contract test suite (`engine/tests/adapter_contract/`).

Pinned engine: `storytold/effectcraft@7e2d0256209974ffb92a29d8bdb6f2a49078f51f` (0.24.1). Source docs:
[agents.md](https://github.com/storytold/effectcraft/blob/main/docs/agents.md),
[mcp.md](https://github.com/storytold/effectcraft/blob/main/docs/mcp.md),
[control-protocol.md](https://github.com/storytold/effectcraft/blob/main/docs/control-protocol.md).

## Interface

```python
class EngineAdapter(Protocol):
    # lifecycle
    def create(self, package_dir: Path, settings: CompSettings) -> ProjectHandle: ...
    def open(self, ecproj: Path) -> ProjectHandle: ...
    def save(self) -> None: ...
    def close(self) -> None: ...
    def attach_gui(self, control_port: int) -> None: ...      # switch to --bridge mode
    def detach_gui(self) -> None: ...

    # read
    def inspect(self) -> DocSnapshot: ...                     # comps, layers (id, name, kind, parent), markers
    def layer_props(self, comp: str, layer_id: int) -> dict: ...

    # write (every call passes the lock check first)
    def execute(self, steps: list[Command], *, actor: Actor, stop_on_error: bool = True) -> BatchResult: ...

    # approval and drift
    def lock_layers(self, comp: str, layer_ids: list[int], *, native: bool = True) -> None: ...
    def unlock_layers(self, comp: str, layer_ids: list[int], *, by_user: UserAction) -> None: ...
    def hash_layers(self, comp: str, layer_ids: list[int] | None = None) -> dict[int, str]: ...

    # output
    def preview(self, comp: str, times: list[float], max_side: int = 960) -> PreviewResult: ...
    def render_final(self, job: FinalRenderJob, spend_token: str) -> RenderResult: ...
    def export(self, kind: Literal["lottie", "ecproj_copy"], comp: str, path: Path) -> ExportResult: ...

    # events
    def subscribe(self, on_event: Callable[[EngineEvent], None]) -> Unsubscribe: ...
```

`Actor` is `agent:<director|builder|qa>` or `user`. `Command` = `{id: str, params: dict}`, exactly an EffectCraft
engine command id and its params.

## Mapping to EffectCraft (real adapter)

| Adapter call | EffectCraft | Notes |
| --- | --- | --- |
| process start | `effectcraft-cli mcp --automation-read-root <pkg> --automation-read-root <cache> --automation-write-root <pkg>` | stdio JSON-RPC. Refuse to start if `effectcraft-cli --version` ≠ lock file |
| `create` | `command_run file.newProject`, `comp.new {name,width,height,frameRate,duration}`, `file.save {path}` | Confirmed at the pin (P0-02): `file.newProject` takes no params; `comp.new` accepts `name,width,height,frameRate,duration` (none required); `file.save` takes an optional `path` |
| `open` | `command_run file.open {path}` | |
| `inspect` | `doc_inspect` + `command_run layer.tree` per comp; resource `effectcraft://document` | Never cached |
| `layer_props` | `command_run prop.get` over the layer's property tree (`layer.tree` gives paths) | Input to hashing |
| `execute` | `command_batch {steps, stop_on_error}` | Each step is its own undo step. Use the `batch` tool when one atomic undo is wanted (one Builder pass = one undo) |
| `lock_layers` (native) | `layer.setSwitch {layers:[…], switch:"lock", value:true}` | Shows the lock in the GUI; EffectCraft then skips locked layers in several commands |
| `unlock_layers` | `layer.setSwitch … value:false` | Only from a `UserAction`; creates a revision |
| `preview` | `render_preview {comp, times, max_side, columns?}` | Contact sheet when several times |
| `render_final` | `renderQueue.add {comp, format:"prores", channels:"rgba", proresProfile:"4444", output}` or `format:"h264"`, then `renderQueue.render {wait:true}` with `_meta.progressToken` | Only with a valid spend token. Check `file.checkOutput` first |
| `export` lottie | `command_run file.exportLottie {comp, path, includeExpressions}` → `{path, bytes, warnings}` | Surface every warning |
| markers | `comp.addMarker`, `comp.deleteAllMarkers`, `layer.addMarker` | Audio markers carry `motioncraft:` in the comment |
| `attach_gui` | restart child as `effectcraft-cli mcp --bridge <port>` | Bridge forwards to the live app. Confinement flags refuse `ui_*` tools — keep them on |
| text | `layer.newText`, `layer.setText` (font, size, fill, `variations`, `direction`, features all live here), `text.fonts`, `text.fontFeatures`, `text.animatorFontAxes`, `text.addSelector` | Native text only. `text.sourceText.style` does not exist at the pin (checked P0-02) |

Snapshot of 766 commands is committed. Other confirmed names: `layer.newShape`, `layer.newSolid`, `layer.newCamera`, `file.saveCopy`, `text.presets`. `layer.setSwitch` requires `switch` (one of video, audio, solo, lock, shy, collapse, quality, fx, frameBlend, motionBlur, adjustment, threeD, guide, preserveTransparency); `layers` and `value` are optional. `renderQueue.add` takes `format` (h264, prores, …) and `channels` (rgb, rgba, alpha). Discover the rest at runtime with `command_list {schemas:true}` and snapshot it into
`engine/tests/fixtures/effectcraft_commands.<sha>.json`; the contract tests fail if a command the primitives use
disappears or changes schema on a pin bump.

## Lock check (authoritative)

Before any `execute` from an agent actor:

1. Resolve every layer each step targets: explicit `layer`/`layers` params, `#N` index references (resolve to ids
   via `inspect`), selection-based commands (refused for agents — agents must name layers), comp-wide commands that
   can touch all layers (`edit.clear`, `layer.arrange`, …: allowed only if none are locked, otherwise refused).
2. If any target has `lock == "approved"` in `layerMap` → raise `LockedLayerError(layer_ids, command_id)`. Nothing
   is sent.
3. Unknown command ids (not in the snapshot) are refused for agents.

The native switch is defence in depth, not the source of truth: a user can unlock in the GUI, which is a hand edit
and is caught by drift detection.

## Hashing and drift

- `hash_layers` = SHA-256 over a canonical JSON of the layer's properties from `prop.get` (sorted keys, floats
  rounded to 6 decimals, excluding selection state, UI expansion state and the lock switch itself).
- Store the hash at approval (`approvedHash`) and after every agent write.
- On open, on GUI save, and on app refocus: recompute; a mismatch → `RevisionRecord {actor:"user", kind:"manual_edit",
  layers:[…]}`; for an approved layer also set `approval.state = "changed_by_user"`. Never revert.
- Phase 0 must prove the hash is stable across 20 save/reopen cycles with no edits (criterion 2 extension).

## Concurrency rules

- EffectCraft's project-file OS lock is taken by CLI runs only, not by the desktop app or `mcp`. So: while the GUI
  is open, the adapter writes **only through the bridge**, never to the file directly.
- One writer at a time per project inside MotionCraft: the adapter holds an asyncio lock per project.
- Never call `file.save` while a GUI session has unsaved changes the agent did not make; ask the user.

## Errors

| Engine response | Adapter raises |
| --- | --- |
| JSON-RPC `-32602` (unknown arg) | `AdapterContractError` (a bug in our code) |
| `isError:true` / `failed > 0` in a batch | `CommandFailed(results)` with per-step detail |
| process exit / broken pipe | `EngineUnavailable`; restart once, then surface to UI |
| version mismatch at start | `EnginePinMismatch` |

## Mock adapter

In-memory document: comps → layers (`id`, `kind`, `name`, `props` dict) → keyframes; markers. Implements every call,
deterministic ids, a fake `preview` that returns a solid PNG with the layer count drawn, and a fake render that writes
a small file. Must reproduce: lock refusals, hash changes on prop edits, drift on "external" edits
(`mock.simulate_user_edit`), batch failure semantics.
