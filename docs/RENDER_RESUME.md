# Final render: parts, cancel and resume (P5-02, AT-13)

A final render is cut into 2-second parts when it can be. Each finished part is kept in `renders/.parts/<job>/` with a `job.json`;
the parts are joined with ffmpeg at the end and the folder is removed. If the render is interrupted (cancel, the engine dies, the
app is killed) the finished parts stay, and **Resume** renders only what is missing. At most one part (2 s of film) is redone.

## Measured on EffectCraft 0.24.1 (Windows)

- A part `[start, end)` is exact: end is exclusive, 0 to 2 s at 30 fps is 60 frames, parts are contiguous.
- ProRes 4444: joined parts are **bit-identical** to a single pass (180 of 180 frame hashes at 6 s).
- H.264: same frame count, **64.6 dB PSNR** against a single pass (not bit-identical: the encoder restarts at each part).
- AT-13 (`tests/test_render_resume_real.py`): the engine process was killed mid-render of a 60 s ProRes clip, the render was resumed,
  and the movie had all 1800 frames, bit-identical to an uninterrupted render.
- `scripts/smoke_render.py` does the same through the packaged app's own commands.

## When it renders in one piece instead (and says why)

- ffmpeg is not installed (it is needed to join the parts; it is not bundled).
- The project has audio (joined parts could glitch the sound; audio inside renders is not checked anywhere).
- The frame rate is not a whole number, such as 29.97 (part boundaries could not be exact).
- The render is under two parts long.

## Rules

- A resume is refused if the composition changed since the render started (the old parts would not match). Discard it and start again.
- A resume is a final render: it needs a fresh single-use spend token from a click (`render_resume` is in `PAID_ENGINE_METHODS`).
- A cancelled one-piece render keeps no half-written file. A part that was in flight is never kept or trusted.
- Discard deletes only that job's folder under `renders/.parts/`.
- Not checked: a Mac; ffmpeg missing on a real user's machine in the packaged app; renders longer than a few minutes; 4K.
