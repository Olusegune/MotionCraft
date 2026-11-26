# Security review

Date: 2026-11-23 · Branch: `feat/macos-native` · Reviewer: Claude (automated pass with hand review) · Scope: the desktop shell, the Python engine
helper, the dependencies and the CI workflow.

This is what was **run** and what was **read by hand**. Anything not listed was not checked (see the end).

## Scans (run)

| Check | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities |
| `pip-audit .` (engine project) | no known vulnerabilities |
| `bandit -r motioncraft_engine -ll` | no findings at medium or high |
| `cargo audit` | 1 vulnerability, **fixed** (below); 3 warnings, accepted (below) |
| `cargo clippy --all-targets -- -D warnings` | clean |

## Findings

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| SR-01 | Medium | **Fixed** | `cookie` 0.18.2 (RUSTSEC-2026-0594): private cookie nonces can repeat in processes that fork. A transitive dependency of the web view stack. Updated to 0.18.3 in `Cargo.lock`; `cargo audit` reports no vulnerabilities and `cargo test` passes. |
| SR-02 | Low | Accepted | `glib` 0.18.5 (RUSTSEC-2024-0429, unsound iterator) and `proc-macro-error` 1.0.4 (RUSTSEC-2024-0370, unmaintained). Both come in only through `gtk`, the Linux part of the menu and web view stack (`tauri` and `muda` pull in `gtk`, which pulls in `glib`), confirmed with `cargo tree -i`. MotionCraft ships for Windows and macOS. Revisit when Tauri moves its Linux dependencies. |
| SR-03 | Low | Accepted | `chrono` 0.4.45 is reported unmaintained (RUSTSEC-2026-0543). No vulnerability. Which crate pulls it in was not traced (`cargo tree -i chrono` printed nothing); watch for a replacement upstream. |
| SR-04 | Process | **Fixed** | Build output (`portable/*.exe`) was committed by mistake and broke the Windows portable-zip step in CI. Removed and ignored (`/portable/`). The binaries remain in the repository history (about 18 MB per commit that touched them); removing them would need a history rewrite, which was not done. |

## Read by hand (what was confirmed in the code)

- **Spend gate.** `confirm_spend` issues a token that is single-use and expires after 5 minutes (`SPEND_TTL`); every paid or cloud call (final renders, image and video generation `generate_start`, and cloud language-model calls) refuses a missing, used or expired token in the Rust command, not only in the page, and the provider API key is added to the request in Rust so the page never holds it. Covered by `spend_tokens_are_single_use_and_expire`
  and the render tests.
- **Write protection while EffectCraft is open.** Every method in `WRITE_METHODS` (now including `layer_timing`) is refused while an EffectCraft
  window has the project open. A test asserts the lists stay consistent (`layer_timing`, `timeline_read`, `audio_cached` are on the allow-list;
  only the first is a write; none is paid).
- **Web view permissions.** `capabilities/default.json` grants `core:default` and `dialog:allow-open` only: no shell, file-system or network
  plugin.
- **Files.** `package_file` serves only `previews/`, `renders/` and `assets/` of a project package, rejects any path that is not plain
  components, and checks the resolved path stays inside the package. Imported media is identified by its bytes, size-capped and renamed.
  A collected project (`collect_package`) copies regular files only: links are skipped, and draft movies and logs are left out (tested).
- **Engine helper.** The audio analysis cache writes only inside the project's own `analysis/` folder and is a convenience: a read-only folder
  does not fail the analysis (tested). Paths for audio and SongMap files go through the same checked asset resolver (`..`, absolute paths and
  other kinds are refused; tested).
- **API keys** live in the operating system credential store under service `motioncraft`, never in project files.

## Not checked

- Process launches (`Command::new` at lib.rs lines ~351, 492, 743, 994, 1125) were located but not each traced to its argument source.
- The content-security-policy string and the asset-protocol scope were located, not evaluated.
- No secret scan of the Git history was run (a tool such as gitleaks was not available); the committed binaries mentioned in SR-04 were not inspected.
- No penetration test, no fuzzing, no review of the provider HTTP code paths beyond the spend gate.
- macOS-specific behaviour (signing, notarisation, sandbox) was not reviewed.
