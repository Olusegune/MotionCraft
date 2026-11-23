//! MotionCraft desktop shell: project packages on disk and a read-only look at the EffectCraft install.
//!
//! This layer never edits composition data. The `.ecproj` is the only store of that (AGENTS.md). Engine commands are not
//! sent from here: they go through the Python adapter (ticket P1-11). This file only locates the engine and launches its
//! GUI. No shell, no `eval`, no network.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};

const PACKAGE_EXT: &str = "motioncraft";
const PINNED_VERSION: &str = "0.24.1";
const MAX_PROJECT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    id: String,
    name: String,
    path: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    state: &'static str,
    found: Option<String>,
    version: Option<String>,
    pinned: &'static str,
    detail: String,
}

fn projects_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| format!("No documents folder available: {e}"))?;
    let root = base.join("MotionCraft");
    fs::create_dir_all(&root).map_err(|e| format!("Could not create {}: {e}", root.display()))?;
    root.canonicalize().map_err(|e| e.to_string())
}

/// Turns a name from outside into a safe folder name (port of the safe.py idea: allow-list, never block-list).
pub fn safe_name(raw: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut last_space = false;
    for c in raw.chars() {
        let ok = c.is_alphanumeric() || c == '-' || c == '_';
        if ok {
            out.push(c);
            last_space = false;
        } else if (c == ' ' || c == '.') && !last_space && !out.is_empty() {
            out.push(' ');
            last_space = true;
        }
    }
    let name: String = out.trim().chars().take(60).collect::<String>().trim().to_string();
    if name.is_empty() {
        return Err("Give the project a name using letters or numbers.".into());
    }
    let upper = name.to_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
        "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&upper.as_str()) {
        return Ok(format!("{name} project"));
    }
    Ok(name)
}

/// A package path from the UI is accepted only if it is a `.motioncraft` folder directly inside the projects root.
pub fn check_package(root: &Path, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let canon = p.canonicalize().map_err(|_| "That project folder no longer exists.".to_string())?;
    if canon.parent() != Some(root) {
        return Err("That folder is outside the MotionCraft projects folder.".into());
    }
    if canon.extension().and_then(|e| e.to_str()) != Some(PACKAGE_EXT) || !canon.is_dir() {
        return Err("That is not a MotionCraft project package.".into());
    }
    Ok(canon)
}

/// Write temp, fsync, rename (PROJECT_SCHEMA.md storage rule).
pub fn atomic_write(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    // Keep the previous good file as `*.bak` first: if a crash or a full disk ever damages project.json, the last good copy is there.
    if let Ok(old) = fs::read(dest) {
        if serde_json::from_slice::<Value>(&old).is_ok() {
            let _ = fs::write(dest.with_extension("json.bak"), &old);
        }
    }
    let tmp = dest.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not replace {}: {e}", dest.display())
    })
}

fn serialise(project: &Value) -> Result<Vec<u8>, String> {
    if !project.is_object() || project.get("schemaVersion").and_then(Value::as_str) != Some("1.0") {
        return Err("Not a MotionCraft project (schemaVersion 1.0 expected).".into());
    }
    let bytes = serde_json::to_vec_pretty(project).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PROJECT_BYTES {
        return Err("The project file is unexpectedly large; refusing to write it.".into());
    }
    Ok(bytes)
}

fn summary(dir: &Path, v: &Value) -> ProjectSummary {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    ProjectSummary { id: s("id"), name: s("name"), path: dir.to_string_lossy().into_owned(), updated_at: s("updatedAt") }
}

#[tauri::command(async)]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let root = projects_root(&app)?;
    let mut out = vec![];
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let dir = entry.path();
        if dir.extension().and_then(|e| e.to_str()) != Some(PACKAGE_EXT) || !dir.is_dir() {
            continue;
        }
        if let Ok(text) = fs::read_to_string(dir.join("project.json")) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                out.push(summary(&dir, &v));
            }
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command(async)]
fn create_project(app: tauri::AppHandle, project: Value) -> Result<ProjectSummary, String> {
    let root = projects_root(&app)?;
    let bytes = serialise(&project)?;
    let name = project.get("name").and_then(Value::as_str).unwrap_or_default();
    let base = safe_name(name)?;
    let mut dir = root.join(format!("{base}.{PACKAGE_EXT}"));
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{base} {n}.{PACKAGE_EXT}"));
        n += 1;
    }
    fs::create_dir(&dir).map_err(|e| format!("Could not create the project folder: {e}"))?;
    for sub in ["assets/audio", "assets/images", "assets/video", "assets/brand", "assets/references", "fonts", "previews", "renders", "logs"] {
        fs::create_dir_all(dir.join(sub)).map_err(|e| e.to_string())?;
    }
    fs::write(dir.join("fonts").join("manifest.json"), b"[]\n").map_err(|e| e.to_string())?;
    atomic_write(&dir.join("project.json"), &bytes)?;
    Ok(summary(&dir.canonicalize().unwrap_or(dir), &project))
}

#[tauri::command(async)]
fn load_project(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    let text = fs::read_to_string(dir.join("project.json")).map_err(|e| format!("Could not read project.json: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("project.json is damaged: {e}"))?;
    if v.get("schemaVersion").and_then(Value::as_str) != Some("1.0") {
        return Err("This project was made by a different MotionCraft version and cannot be opened yet.".into());
    }
    Ok(v)
}

#[tauri::command(async)]
fn save_project(app: tauri::AppHandle, path: String, project: Value) -> Result<(), String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    atomic_write(&dir.join("project.json"), &serialise(&project)?)
}

// ---------------------------------------------------------------- crash recovery (P1-06, P1-13)

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectHealth {
    /// ok | damaged | missing
    state: &'static str,
    has_backup: bool,
    backup_updated_at: Option<String>,
}

fn read_valid(path: &Path) -> Option<Value> {
    let v: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (v.get("schemaVersion").and_then(Value::as_str) == Some("1.0")).then_some(v)
}

fn health_of(dir: &Path) -> ProjectHealth {
    let main = dir.join("project.json");
    let bak = read_valid(&dir.join("project.json.bak"));
    let state = if !main.exists() { "missing" } else if read_valid(&main).is_some() { "ok" } else { "damaged" };
    ProjectHealth {
        state,
        has_backup: bak.is_some(),
        backup_updated_at: bak.as_ref().and_then(|v| v.get("updatedAt")).and_then(Value::as_str).map(str::to_string),
    }
}

/// Puts the last good copy back. The damaged file is kept beside it as project.damaged.json, never deleted.
fn restore_backup_in(dir: &Path) -> Result<(), String> {
    let bak = read_valid(&dir.join("project.json.bak")).ok_or("There is no usable backup of this project.")?;
    let main = dir.join("project.json");
    if main.exists() {
        let _ = fs::rename(&main, dir.join("project.damaged.json"));
    }
    atomic_write(&main, &serialise(&bak)?)
}

#[tauri::command(async)]
fn project_health(app: tauri::AppHandle, path: String) -> Result<ProjectHealth, String> {
    Ok(health_of(&check_package(&projects_root(&app)?, &path)?))
}

#[tauri::command(async)]
fn restore_backup(app: tauri::AppHandle, path: String) -> Result<(), String> {
    restore_backup_in(&check_package(&projects_root(&app)?, &path)?)
}

/// A marker file says "a project is open". It is removed on a normal exit or when the project is closed, so finding it at launch
/// means MotionCraft did not close properly (crash, kill, power loss).
fn marker_file(base: &Path) -> PathBuf {
    base.join("session.json")
}
fn write_marker(base: &Path, package: &str) -> Result<(), String> {
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    atomic_write(&marker_file(base), serde_json::json!({ "package": package }).to_string().as_bytes())
}
fn read_marker(base: &Path) -> Option<String> {
    let v: Value = serde_json::from_slice(&fs::read(marker_file(base)).ok()?).ok()?;
    v.get("package").and_then(Value::as_str).map(str::to_string)
}
fn clear_marker(base: &Path) {
    let _ = fs::remove_file(marker_file(base));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Unclean {
    path: String,
    name: String,
    updated_at: String,
    health: ProjectHealth,
}

/// Called once at launch, before the new session starts. Clears the marker either way so the prompt shows once.
#[tauri::command(async)]
fn unclean_session(app: tauri::AppHandle) -> Option<Unclean> {
    let base = app.path().app_data_dir().ok()?;
    let pkg = read_marker(&base)?;
    clear_marker(&base);
    let dir = check_package(&projects_root(&app).ok()?, &pkg).ok()?;
    let health = health_of(&dir);
    let v = read_valid(&dir.join("project.json")).or_else(|| read_valid(&dir.join("project.json.bak")))?;
    let s = summary(&dir, &v);
    Some(Unclean { path: s.path, name: s.name, updated_at: s.updated_at, health })
}

#[tauri::command(async)]
fn session_begin(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write_marker(&base, &dir.to_string_lossy())
}

#[tauri::command(async)]
fn session_end(app: tauri::AppHandle) {
    if let Ok(base) = app.path().app_data_dir() {
        clear_marker(&base);
    }
}

fn cli_name() -> &'static str {
    if cfg!(windows) { "effectcraft-cli.exe" } else { "effectcraft-cli" }
}
fn gui_name() -> &'static str {
    if cfg!(windows) { "effectcraft.exe" } else { "effectcraft" }
}

fn candidates(override_path: &str) -> Vec<PathBuf> {
    candidates_with(override_path, &|k| std::env::var(k).ok())
}

/// Where effectcraft-cli may be: the user's setting, EFFECTCRAFT_CLI, the installer folders (the Windows MSI installs to
/// `Program Files\EffectCraft`, found on a real machine; older notes said `ArtCraft\EffectCraft`), and every PATH entry.
fn candidates_with(override_path: &str, env: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    let mut v = vec![];
    if !override_path.trim().is_empty() {
        v.push(PathBuf::from(override_path.trim()));
    }
    if let Some(p) = env("EFFECTCRAFT_CLI") {
        v.push(PathBuf::from(p));
    }
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(base) = env(var) {
                let b = PathBuf::from(base);
                v.push(b.join("EffectCraft").join(cli_name()));
                v.push(b.join("ArtCraft").join("EffectCraft").join(cli_name()));
            }
        }
        if let Some(base) = env("LOCALAPPDATA") {
            let b = PathBuf::from(base);
            v.push(b.join("Programs").join("EffectCraft").join(cli_name()));
            v.push(b.join("Programs").join("ArtCraft").join("EffectCraft").join(cli_name()));
        }
    } else {
        for p in ["/Applications/EffectCraft.app/Contents/MacOS", "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"] {
            v.push(Path::new(p).join(cli_name()));
        }
        if let Some(home) = env("HOME") {
            let h = PathBuf::from(home);
            v.push(h.join("Applications").join("EffectCraft.app").join("Contents").join("MacOS").join(cli_name()));
            v.push(h.join(".cargo").join("bin").join(cli_name()));
        }
    }
    if let Some(path) = env("PATH").or_else(|| env("Path")) {
        for dir in std::env::split_paths(&path) {
            v.push(dir.join(cli_name()));
        }
    }
    v
}

/// Only a regular file with exactly the engine CLI's name is ever run, and only with `--version`. Network (UNC) paths are
/// refused so a setting can never point at a binary on another machine.
fn looks_like_cli(p: &Path) -> bool {
    let s = p.to_string_lossy();
    if s.starts_with("\\\\") || s.starts_with("//") {
        return false;
    }
    p.is_file() && p.file_name().and_then(|n| n.to_str()).map(|n| n.eq_ignore_ascii_case(cli_name())).unwrap_or(false)
}

fn run_version(cli: &Path) -> Result<String, String> {
    let mut cmd = Command::new(cli);
    cmd.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    // effectcraft-cli is a console program. Without this Windows opens a console window for it, and with Windows Terminal as the
    // default terminal that is a terminal window flashing over the app every time the engine is checked.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start {}: {e}", cli.display()))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => break,
            None if Instant::now() > deadline => {
                let _ = child.kill();
                return Err("effectcraft-cli did not answer within 5 s.".into());
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn parse_version(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|t| t.matches('.').count() >= 2 && t.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|t| t.trim_matches('.').to_string())
}

fn find_cli(override_path: &str) -> Option<PathBuf> {
    candidates(override_path).into_iter().find(|p| looks_like_cli(p))
}

#[tauri::command(async)]
fn engine_status(override_path: String) -> EngineStatus {
    let Some(cli) = find_cli(&override_path) else {
        return EngineStatus {
            state: "missing",
            found: None,
            version: None,
            pinned: PINNED_VERSION,
            detail: format!("effectcraft-cli was not found. Install EffectCraft {PINNED_VERSION}, or set its path in Settings."),
        };
    };
    let found = Some(cli.to_string_lossy().into_owned());
    match run_version(&cli) {
        Ok(text) => match parse_version(&text) {
            Some(v) if v == PINNED_VERSION => EngineStatus {
                state: "connected",
                found,
                version: Some(v),
                pinned: PINNED_VERSION,
                detail: format!("Found {} ({text}). The check compares the version number; the commit is verified by the adapter (P1-11).", cli.display()),
            },
            Some(v) => EngineStatus {
                state: "version-mismatch",
                found,
                version: Some(v.clone()),
                pinned: PINNED_VERSION,
                detail: format!("Found EffectCraft {v}, but MotionCraft is pinned to {PINNED_VERSION}. Install the pinned version."),
            },
            None => EngineStatus { state: "error", found, version: None, pinned: PINNED_VERSION, detail: format!("Unexpected --version output: {text}") },
        },
        Err(e) => EngineStatus { state: "error", found, version: None, pinned: PINNED_VERSION, detail: e },
    }
}

struct Sidecar {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<String>,
    next_id: u64,
    has_cli: bool,
}

#[derive(Default)]
pub struct EngineState {
    sidecar: Mutex<Option<Sidecar>>,
    gui: Mutex<Option<Child>>,
    /// Spend confirmations handed out after a user click: token -> expiry. Single use (AGENTS.md money rule).
    spend: Mutex<HashMap<String, Instant>>,
}

const ENGINE_METHODS: [&str; 35] = [
    "open", "inspect", "add_text", "set_text", "add_camera", "lock", "unlock", "preview", "close", "add_shape", "add_solid", "add_media", "apply_primitive",
    "primitives", "audio_analyze", "audio_cached", "sync_markers", "preview_movie_start", "render_start", "render_poll", "builder_execute", "qa_run", "qa_fix",
    "snapshot_save", "snapshot_diff", "snapshot_preview", "snapshot_restore",
    "render_resume", "render_cancel", "render_discard", "render_jobs", "songmap_import", "sync_labelled_markers", "timeline_read", "layer_timing",
];
const MODEL_METHODS: [&str; 11] = ["models", "models_refresh", "generate_start", "generate_poll", "generate_cancel", "llm_status", "llm_set", "llm_models", "llm_complete", "director_intent", "builder_plan"];
/// Methods that call a language model: a cloud provider needs a key and a spend token, a local one neither.
const LLM_CALL_METHODS: [&str; 3] = ["llm_complete", "director_intent", "builder_plan"];
/// Language-model providers that run in the cloud: a call needs a key and a spend token. Local ones (ollama, lmstudio, inkling) need neither,
/// and the helper only lets them reach a loopback address. Value = the credential-store account the key is kept under.
const LLM_CLOUD: [(&str, &str); 4] = [("openai", "openai"), ("anthropic", "anthropic"), ("gemini", "google"), ("openrouter", "openrouter")];
const LLM_LOCAL: [&str; 3] = ["ollama", "lmstudio", "inkling"];
/// Credential-store accounts: the generation providers plus the two language-model-only ones.
const KEY_ACCOUNTS: [&str; 7] = ["byteplus", "google", "openai", "kie", "fal", "anthropic", "openrouter"];
const WRITE_METHODS: [&str; 16] = ["add_text", "set_text", "add_camera", "lock", "unlock", "add_shape", "add_solid", "add_media", "apply_primitive", "sync_markers", "builder_execute", "qa_fix", "snapshot_save", "snapshot_restore", "sync_labelled_markers", "layer_timing"];
/// Methods that spend money or make a deliverable: they need a live spend token from a click (AGENTS.md).
const PAID_ENGINE_METHODS: [&str; 2] = ["render_start", "render_resume"];
const PROVIDERS: [&str; 5] = ["byteplus", "google", "openai", "kie", "fal"];
const KEY_SERVICE: &str = "motioncraft";
const SPEND_TTL: Duration = Duration::from_secs(300);

fn sidecar_program() -> Result<(PathBuf, Vec<String>, Option<PathBuf>), String> {
    let exe_name = if cfg!(windows) { "motioncraft-engine.exe" } else { "motioncraft-engine" };
    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            let p = dir.join(exe_name);
            if p.is_file() {
                return Ok((p, vec![], None));
            }
        }
    }
    // Development builds only: run the Python package from a checkout (MOTIONCRAFT_ENGINE_DIR=<repo>/engine). Release builds
    // never read this variable, so an environment setting cannot choose what the installed app runs.
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("MOTIONCRAFT_ENGINE_DIR") {
        let d = PathBuf::from(dir);
        if d.join("motioncraft_engine").is_dir() {
            let py = if cfg!(windows) { "python" } else { "python3" };
            return Ok((PathBuf::from(py), vec!["-m".into(), "motioncraft_engine.sidecar".into()], Some(d)));
        }
    }
    Err("The MotionCraft engine helper was not found next to the app. Reinstall MotionCraft.".into())
}

fn start_sidecar(cli: Option<&Path>, data_dir: Option<&Path>) -> Result<Sidecar, String> {
    let (prog, mut args, cwd) = sidecar_program()?;
    if let Some(c) = cli {
        args.push("--effectcraft-cli".into());
        args.push(c.to_string_lossy().into_owned());
    }
    if let Some(d) = data_dir {
        args.push("--data-dir".into());
        args.push(d.to_string_lossy().into_owned());
    }
    // The helper gets no provider keys in its environment: keys travel per request, for the one provider a call uses.
    let mut cmd = Command::new(prog);
    cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the engine helper: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    Ok(Sidecar { child, stdin, rx, next_id: 1, has_cli: cli.is_some() })
}

fn gui_running(st: &EngineState) -> bool {
    let mut g = st.gui.lock().unwrap();
    match g.as_mut() {
        Some(c) => match c.try_wait() {
            Ok(None) => true,
            _ => {
                *g = None;
                false
            }
        },
        None => false,
    }
}

fn provider_ok(p: &str) -> Result<(), String> {
    if PROVIDERS.contains(&p) { Ok(()) } else { Err(format!("Unknown provider {p}.")) }
}

fn key_entry(provider: &str) -> Result<keyring::Entry, String> {
    if !KEY_ACCOUNTS.contains(&provider) {
        return Err(format!("Unknown provider {provider}."));
    }
    keyring::Entry::new(KEY_SERVICE, &format!("{provider}-api-key")).map_err(|e| format!("Credential store unavailable: {e}"))
}

/// Keys live only in the operating system credential store. They are never returned to the page.
#[tauri::command(async)]
fn set_provider_key(provider: String, key: String) -> Result<(), String> {
    let k = key.trim();
    if k.len() < 8 || k.len() > 512 || k.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("That does not look like an API key.".into());
    }
    key_entry(&provider)?.set_password(k).map_err(|e| format!("Could not save the key: {e}"))
}

#[tauri::command(async)]
fn delete_provider_key(provider: String) -> Result<(), String> {
    match key_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the key: {e}")),
    }
}

#[tauri::command(async)]
fn provider_key_status() -> HashMap<String, bool> {
    KEY_ACCOUNTS.iter().map(|p| (p.to_string(), key_entry(p).ok().and_then(|e| e.get_password().ok()).is_some())).collect()
}

fn get_key(provider: &str) -> Result<String, String> {
    key_entry(provider)?.get_password().map_err(|_| format!("Add your {provider} key in Settings first."))
}

fn random_token() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| format!("No secure random source: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// The spend gate (S-01). The page calls this from the click on the confirmation sheet, which has shown the price. The token is
/// single use and expires; `engine_call` refuses `generate_start` without a live one.
#[tauri::command(async)]
fn confirm_spend(st: State<EngineState>, provider: String, model: String) -> Result<String, String> {
    if provider != "local-render" && !LLM_CLOUD.iter().any(|(p, _)| *p == provider) {
        provider_ok(&provider)?; // a final render on this computer is the only non-provider spend; cloud language models are the other
    }
    if model.is_empty() || model.len() > 200 {
        return Err("Bad model.".into());
    }
    let t = random_token()?;
    let mut m = st.spend.lock().unwrap();
    m.retain(|_, exp| *exp > Instant::now());
    m.insert(t.clone(), Instant::now() + SPEND_TTL);
    Ok(t)
}

fn take_spend(st: &EngineState, token: &str) -> bool {
    let mut m = st.spend.lock().unwrap();
    m.retain(|_, exp| *exp > Instant::now());
    m.remove(token).is_some()
}

/// One request to the Python engine helper. The method list is closed, the package path is re-validated here, writes are refused
/// while an EffectCraft window has the project open (P0-07), keys are injected for the one provider a call uses, and a paid call
/// needs a live spend token.
#[tauri::command(async)]
fn engine_call(
    app: tauri::AppHandle,
    st: State<EngineState>,
    method: String,
    mut params: Value,
    override_path: String,
    package: Option<String>,
) -> Result<Value, String> {
    let is_engine = ENGINE_METHODS.contains(&method.as_str());
    if !is_engine && !MODEL_METHODS.contains(&method.as_str()) {
        return Err(format!("Unknown engine method {method}."));
    }
    if WRITE_METHODS.contains(&method.as_str()) && gui_running(&st) {
        return Err("EffectCraft has this project open. Make changes there, then close it and press Refresh. MotionCraft will not write the file while it is open.".into());
    }
    if !params.is_object() {
        params = serde_json::json!({});
    }
    {
        // Never trust the page for secrets or paths.
        let o = params.as_object_mut().unwrap();
        for k in ["package", "api_key", "keys"] {
            o.remove(k);
        }
    }
    if method == "open" || method == "generate_start" {
        let root = projects_root(&app)?;
        let pkg = check_package(&root, package.as_deref().ok_or("No project path.")?)?;
        params.as_object_mut().unwrap().insert("package".into(), Value::String(pkg.to_string_lossy().into_owned()));
    }
    if PAID_ENGINE_METHODS.contains(&method.as_str()) {
        let token = params.get("spend_token").and_then(Value::as_str).unwrap_or("").to_string();
        if !take_spend(&st, &token) {
            return Err("A final render needs a confirmation from a click on the render sheet. Confirm again.".into());
        }
    }
    if method == "generate_start" {
        let provider = params.get("provider").and_then(Value::as_str).ok_or("No provider.")?.to_string();
        provider_ok(&provider)?;
        let token = params.get("spend_token").and_then(Value::as_str).unwrap_or("").to_string();
        if !take_spend(&st, &token) {
            return Err("This needs a spend confirmation from a click on the confirmation sheet. Confirm again.".into());
        }
        let key = get_key(&provider)?;
        params.as_object_mut().unwrap().insert("api_key".into(), Value::String(key));
    }
    if LLM_CALL_METHODS.contains(&method.as_str()) {
        let provider = params.get("provider").and_then(Value::as_str).ok_or("No language-model provider.")?.to_string();
        if let Some((_, account)) = LLM_CLOUD.iter().find(|(p, _)| *p == provider) {
            let token = params.get("spend_token").and_then(Value::as_str).unwrap_or("").to_string();
            if !take_spend(&st, &token) {
                return Err("A cloud language-model call needs a spend confirmation from a click. Confirm again.".into());
            }
            let key = get_key(account)?;
            params.as_object_mut().unwrap().insert("api_key".into(), Value::String(key));
        } else if !LLM_LOCAL.contains(&provider.as_str()) {
            return Err(format!("Unknown language-model provider {provider}."));
        }
    }
    if method == "models_refresh" {
        let mut keys = serde_json::Map::new();
        if let Ok(k) = get_key("fal") {
            keys.insert("fal".into(), Value::String(k)); // only fal's listing needs a key
        }
        params.as_object_mut().unwrap().insert("keys".into(), Value::Object(keys));
    }
    let cli = find_cli(&override_path);
    if is_engine && cli.is_none() {
        return Err("EffectCraft was not found. Set its path in Settings.".into());
    }
    let data_dir = app.path().app_data_dir().ok();
    sidecar_request(&st, cli.as_deref(), data_dir.as_deref(), &method, params)
}

/// Sends one request to the engine helper (starting it if needed) and waits for the reply with the matching id.
fn sidecar_request(st: &EngineState, cli: Option<&Path>, data_dir: Option<&Path>, method: &str, params: Value) -> Result<Value, String> {
    let mut guard = st.sidecar.lock().unwrap();
    let need_restart = matches!(guard.as_ref(), Some(s) if cli.is_some() && !s.has_cli);
    if need_restart {
        if let Some(mut old) = guard.take() {
            let _ = old.child.kill();
        }
    }
    if guard.is_none() {
        *guard = Some(start_sidecar(cli, data_dir)?);
    }
    let sc = guard.as_mut().unwrap();
    let id = sc.next_id;
    sc.next_id += 1;
    let line = serde_json::json!({"id": id, "method": method, "params": params}).to_string();
    let io_ok = writeln!(sc.stdin, "{line}").and_then(|_| sc.stdin.flush()).is_ok();
    let timeout = Duration::from_secs(if method == "open" || method == "preview" || method == "models_refresh" || method == "builder_execute" || method == "qa_run" || method.starts_with("snapshot_") || LLM_CALL_METHODS.contains(&method) { 180 } else { 60 });
    let reply: Result<Value, String> = if io_ok {
        loop {
            match sc.rx.recv_timeout(timeout) {
                Ok(l) => {
                    if let Ok(v) = serde_json::from_str::<Value>(&l) {
                        if v.get("id").and_then(Value::as_u64) == Some(id) {
                            break Ok(v);
                        }
                    }
                }
                Err(_) => break Err("The engine helper did not answer in time and was stopped.".to_string()),
            }
        }
    } else {
        Err("The engine helper stopped. Try again.".to_string())
    };
    match reply {
        Ok(v) => {
            if v.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(v.get("result").cloned().unwrap_or(Value::Null))
            } else {
                Err(v.pointer("/error/message").and_then(Value::as_str).unwrap_or("Engine error").to_string())
            }
        }
        Err(e) => {
            if let Some(mut dead) = guard.take() {
                let _ = dead.child.kill();
            }
            Err(e)
        }
    }
}

/// Starts the EffectCraft GUI on this project. The project opens on its last active composition (P0-14). Returns at once;
/// while the window is running, `engine_call` refuses writes.
#[tauri::command(async)]
fn open_in_effectcraft(app: tauri::AppHandle, st: State<EngineState>, path: String, override_path: String) -> Result<(), String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    let cli = find_cli(&override_path).ok_or("EffectCraft was not found. Set its path in Settings.")?;
    let ecproj = dir.join("comp.ecproj");
    if !ecproj.is_file() {
        return Err("This project has no composition yet. Open Build once to create it.".into());
    }
    if gui_running(&st) {
        return Err("EffectCraft is already open.".into());
    }
    let gui = cli.with_file_name(gui_name());
    if !gui.is_file() {
        return Err(format!("{} was not found next to effectcraft-cli.", gui_name()));
    }
    let child = Command::new(gui)
        .arg(&ecproj)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start EffectCraft: {e}"))?;
    *st.gui.lock().unwrap() = Some(child);
    Ok(())
}

/// A generated picture as a data URL, for the thumbnail. Only files under the package's assets/images folder, images only.
#[tauri::command(async)]
fn asset_data_url(app: tauri::AppHandle, path: String, rel: String) -> Result<String, String> {
    use base64::Engine as _;
    let dir = check_package(&projects_root(&app)?, &path)?;
    let r = Path::new(&rel);
    let parts: Vec<_> = r.components().collect();
    let plain = parts.iter().all(|c| matches!(c, std::path::Component::Normal(_)));
    if !plain || parts.len() != 3 || parts[0].as_os_str() != "assets" || parts[1].as_os_str() != "images" {
        return Err("Not a picture asset of this project.".into());
    }
    let file = dir.join(r).canonicalize().map_err(|_| "That picture no longer exists.".to_string())?;
    if !file.starts_with(&dir) {
        return Err("Not a picture asset of this project.".into());
    }
    let mime = match file.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => return Err("Not a picture file.".into()),
    };
    if file.metadata().map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
        return Err("That picture is too large to preview.".into());
    }
    let bytes = fs::read(&file).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// The absolute path of a file the page may play or show: only under previews/, renders/ or assets/ of a project package. The
/// page turns it into a URL with the asset protocol, whose scope is the projects folder.
#[tauri::command(async)]
fn package_file(app: tauri::AppHandle, path: String, rel: String) -> Result<String, String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    let r = Path::new(&rel);
    let comps: Vec<_> = r.components().collect();
    let plain = comps.iter().all(|c| matches!(c, std::path::Component::Normal(_)));
    let top = comps.first().and_then(|c| c.as_os_str().to_str()).unwrap_or("");
    if !plain || comps.len() < 2 || !["previews", "renders", "assets"].contains(&top) {
        return Err("Not a file of this project.".into());
    }
    let file = dir.join(r).canonicalize().map_err(|_| "That file no longer exists.".to_string())?;
    if !file.starts_with(&dir) || !file.is_file() {
        return Err("Not a file of this project.".into());
    }
    Ok(file.to_string_lossy().into_owned())
}

/// Collected editable project: copies the whole package (composition, assets, font manifest) into a folder the user chose.
#[tauri::command(async)]
fn export_package(app: tauri::AppHandle, path: String, dest_parent: String) -> Result<String, String> {
    let root = projects_root(&app)?;
    let src = check_package(&root, &path)?;
    let parent = PathBuf::from(&dest_parent).canonicalize().map_err(|_| "That folder does not exist.".to_string())?;
    if !parent.is_dir() {
        return Err("Choose a folder.".into());
    }
    if parent.starts_with(&src) {
        return Err("Choose a folder outside the project itself.".into());
    }
    let base = src.file_stem().and_then(|s| s.to_str()).unwrap_or("project").to_string();
    let dst = unique_package(&parent, &base);
    collect_package(&src, &dst).inspect_err(|_| {
        let _ = fs::remove_dir_all(&dst);
    })?;
    Ok(dst.to_string_lossy().into_owned())
}

/// What a collected editable project leaves out: the draft movies and stills (they are made again on Build) and the working logs. Everything else is
/// kept, with its relative paths, so the package opens on another computer: the composition, the assets, the font manifest, the renders, the project file.
const COLLECT_SKIP: [&str; 2] = ["previews", "logs"];

fn collect_package(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Could not create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() || (kind.is_dir() && COLLECT_SKIP.iter().any(|s| name == std::ffi::OsStr::new(s))) {
            continue;
        }
        if kind.is_dir() {
            copy_dir(&entry.path(), &dst.join(&name), 1)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), dst.join(&name)).map_err(|e| format!("Could not copy {}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

#[tauri::command(async)]
fn effectcraft_window_open(st: State<EngineState>) -> bool {
    gui_running(&st)
}

/// What a file is, from its first bytes (never from its name). Pictures, video and audio only.
pub fn sniff(head: &[u8]) -> Option<(&'static str, &'static str)> {
    let h = head;
    if h.starts_with(b"\x89PNG") {
        Some(("image", "png"))
    } else if h.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image", "jpg"))
    } else if h.len() >= 12 && &h[0..4] == b"RIFF" && &h[8..12] == b"WEBP" {
        Some(("image", "webp"))
    } else if h.starts_with(b"GIF8") {
        Some(("image", "gif"))
    } else if h.len() >= 12 && &h[4..8] == b"ftyp" {
        Some(("video", "mp4"))
    } else if h.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        Some(("video", "webm"))
    } else if h.len() >= 12 && &h[0..4] == b"RIFF" && &h[8..12] == b"WAVE" {
        Some(("audio", "wav"))
    } else if h.starts_with(b"ID3") || (h.len() >= 2 && h[0] == 0xff && (h[1] & 0xe0) == 0xe0) {
        Some(("audio", "mp3"))
    } else if h.starts_with(b"fLaC") {
        Some(("audio", "flac"))
    } else {
        None
    }
}

#[derive(Serialize)]
pub struct ImportedAsset {
    kind: &'static str,
    path: String,
    name: String,
}

/// Copies a picture, video or audio file into the project's assets folder. The type comes from the file's bytes, sizes are
/// capped, the new name is generated from a sanitised stem, and nothing outside the package is written.
#[tauri::command(async)]
fn import_asset(app: tauri::AppHandle, path: String, source: String) -> Result<ImportedAsset, String> {
    use std::io::Read;
    let dir = check_package(&projects_root(&app)?, &path)?;
    let src = PathBuf::from(&source).canonicalize().map_err(|_| "That file does not exist.".to_string())?;
    if !src.is_file() {
        return Err("Choose a file, not a folder.".into());
    }
    let mut head = [0u8; 16];
    let n = fs::File::open(&src).and_then(|mut f| f.read(&mut head)).map_err(|e| format!("Could not read the file: {e}"))?;
    let (kind, ext) = sniff(&head[..n]).ok_or("That is not a picture, video or audio file MotionCraft can use.")?;
    let size = src.metadata().map_err(|e| e.to_string())?.len();
    let cap: u64 = match kind {
        "image" => 60 * 1024 * 1024,
        "audio" => 400 * 1024 * 1024,
        _ => 4 * 1024 * 1024 * 1024,
    };
    if size > cap {
        return Err(format!("That file is too large ({} MB).", size / 1_048_576));
    }
    let stem = safe_name(src.file_stem().and_then(|s| s.to_str()).unwrap_or("file")).unwrap_or_else(|_| "file".into());
    let sub = match kind { "image" => "images", "video" => "video", _ => "audio" };
    let folder = dir.join("assets").join(sub);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let id = random_token()?;
    let name = format!("imp-{}-{}.{}", &id[..8], stem.replace(' ', "-"), ext);
    fs::copy(&src, folder.join(&name)).map_err(|e| format!("Could not copy the file: {e}"))?;
    Ok(ImportedAsset { kind, path: format!("assets/{sub}/{name}"), name: stem })
}

/// A Pulseframe SongMap is plain JSON. Before it is copied into the project it must really be one: valid JSON, an object, schema version 1,
/// a duration and a list of sections. (The engine helper checks and clamps every field again when it reads it.)
pub fn validate_songmap(text: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(text).map_err(|_| "That is not a SongMap file (it is not valid JSON).".to_string())?;
    let o = v.as_object().ok_or("That is not a SongMap file.")?;
    if o.get("schema_version").and_then(Value::as_i64) != Some(1) {
        return Err("This SongMap is not schema version 1, which is the version MotionCraft reads.".into());
    }
    if !o.get("duration").map(|d| d.is_number()).unwrap_or(false) || !o.get("sections").map(Value::is_array).unwrap_or(false) {
        return Err("That SongMap has no duration or no sections.".into());
    }
    Ok(())
}

/// Brings a SongMap made by Pulseframe into the project as assets/audio/imp-<id>-<name>.songmap.json. It is not an audio track and is not
/// listed as one: the page records it separately.
#[tauri::command(async)]
fn import_songmap(app: tauri::AppHandle, path: String, source: String) -> Result<ImportedAsset, String> {
    use std::io::Read;
    let dir = check_package(&projects_root(&app)?, &path)?;
    let src = PathBuf::from(&source).canonicalize().map_err(|_| "That file does not exist.".to_string())?;
    if !src.is_file() {
        return Err("Choose a file, not a folder.".into());
    }
    const CAP: u64 = 5 * 1024 * 1024;
    if src.metadata().map_err(|e| e.to_string())?.len() > CAP {
        return Err("That SongMap is larger than 5 MB.".into());
    }
    let mut text = String::new();
    fs::File::open(&src)
        .and_then(|f| f.take(CAP + 1).read_to_string(&mut text))
        .map_err(|_| "That file could not be read as text.".to_string())?;
    validate_songmap(&text)?;
    let stem = safe_name(src.file_stem().and_then(|s| s.to_str()).unwrap_or("songmap").trim_end_matches(".songmap")).unwrap_or_else(|_| "songmap".into());
    let folder = dir.join("assets").join("audio");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let id = random_token()?;
    let name = format!("imp-{}-{}.songmap.json", &id[..8], stem.replace(' ', "-"));
    fs::write(folder.join(&name), text.as_bytes()).map_err(|e| format!("Could not copy the file: {e}"))?;
    Ok(ImportedAsset { kind: "songmap", path: format!("assets/audio/{name}"), name: stem })
}

fn copy_dir(src: &Path, dst: &Path, depth: u32) -> Result<(), String> {
    if depth > 8 {
        return Err("The project folder is nested too deeply to copy.".into());
    }
    fs::create_dir_all(dst).map_err(|e| format!("Could not create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue; // links are never followed or copied
        } else if kind.is_dir() {
            copy_dir(&from, &to, depth + 1)?;
        } else if kind.is_file() {
            fs::copy(&from, &to).map_err(|e| format!("Could not copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

fn unique_package(root: &Path, base: &str) -> PathBuf {
    let mut dir = root.join(format!("{base}.{PACKAGE_EXT}"));
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{base} {n}.{PACKAGE_EXT}"));
        n += 1;
    }
    dir
}

#[tauri::command(async)]
fn projects_folder(app: tauri::AppHandle) -> Result<String, String> {
    Ok(projects_root(&app)?.to_string_lossy().into_owned())
}

/// Shows the projects folder in the system file browser. Fixed program, the folder is our own canonical root.
#[tauri::command(async)]
fn reveal_projects_folder(app: tauri::AppHandle) -> Result<(), String> {
    let root = projects_root(&app)?;
    let prog = if cfg!(windows) { "explorer.exe" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    Command::new(prog).arg(root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| format!("Could not open the folder: {e}"))?;
    Ok(())
}

/// Brings a `.motioncraft` folder from anywhere into the projects folder (a copy) so it can be opened. Used by File > Open Project Folder.
#[tauri::command(async)]
fn import_project(app: tauri::AppHandle, source: String) -> Result<ProjectSummary, String> {
    let root = projects_root(&app)?;
    let src = PathBuf::from(&source).canonicalize().map_err(|_| "That folder does not exist.".to_string())?;
    if src.extension().and_then(|e| e.to_str()) != Some(PACKAGE_EXT) || !src.is_dir() {
        return Err("Choose a folder whose name ends in .motioncraft.".into());
    }
    let text = fs::read_to_string(src.join("project.json")).map_err(|_| "That folder has no project.json, so it is not a MotionCraft project.".to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("project.json is damaged: {e}"))?;
    if v.get("schemaVersion").and_then(Value::as_str) != Some("1.0") {
        return Err("This project was made by a different MotionCraft version and cannot be opened yet.".into());
    }
    if src.parent() == Some(root.as_path()) {
        return Ok(summary(&src, &v)); // already in the projects folder: open it where it is
    }
    if root.starts_with(&src) {
        return Err("Choose a project folder, not a folder that contains the projects folder.".into());
    }
    let base = safe_name(v.get("name").and_then(Value::as_str).unwrap_or("Imported project"))?;
    let dst = unique_package(&root, &base);
    copy_dir(&src, &dst, 0).inspect_err(|_| {
        let _ = fs::remove_dir_all(&dst);
    })?;
    Ok(summary(&dst.canonicalize().unwrap_or(dst), &v))
}

/// File > Save a Copy: copies the whole package (assets and composition) under a new name; the page supplies the new project.json
/// (new id and name). The original is not touched.
#[tauri::command(async)]
fn duplicate_project(app: tauri::AppHandle, path: String, project: Value) -> Result<ProjectSummary, String> {
    let root = projects_root(&app)?;
    let src = check_package(&root, &path)?;
    let bytes = serialise(&project)?;
    let base = safe_name(project.get("name").and_then(Value::as_str).unwrap_or_default())?;
    let dst = unique_package(&root, &base);
    copy_dir(&src, &dst, 0).inspect_err(|_| {
        let _ = fs::remove_dir_all(&dst);
    })?;
    atomic_write(&dst.join("project.json"), &bytes)?;
    Ok(summary(&dst.canonicalize().unwrap_or(dst), &project))
}

/// When the splash was shown, and the minimum time it stays up (so it is not a flash).
static SPLASH_AT: Mutex<Option<Instant>> = Mutex::new(None);
const SPLASH_MIN: Duration = Duration::from_millis(1500);
const DOCS_URL: &str = "https://github.com/Olusegune/MotionCraft/tree/main/docs";

/// Windows 11 animates a window as it appears and disappears. Over a window that is already on screen that shows up as a ghost copy
/// of it, with its own title-bar buttons, drifting in and fading out at start-up. Turning the transitions off for our windows
/// removes it. Other platforms have nothing to do.
#[cfg(windows)]
fn no_window_animation(w: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    if let Ok(h) = w.hwnd() {
        let on: i32 = 1;
        // SAFETY: a valid window handle from Tauri, and a pointer to a 4-byte BOOL that lives for the call.
        unsafe {
            DwmSetWindowAttribute(h.0 as _, DWMWA_TRANSITIONS_FORCEDISABLED as u32, &on as *const i32 as *const _, 4);
        }
    }
}
#[cfg(not(windows))]
fn no_window_animation(_: &tauri::WebviewWindow) {}

/// Closes the splash and shows the main window (idempotent). A timer calls it too, so a page that never loads cannot leave the
/// user looking at the splash forever.
fn show_main(app: &tauri::AppHandle) {
    // Main first, then the splash is hidden (no animation) and only then closed. Closing it in the same instant the main window
    // appeared let Windows 11 play the close animation as a ghost panel, with title-bar buttons, over the main window.
    if let Some(m) = app.get_webview_window("main") {
        // show() already activates the window. Asking for focus again right afterwards made Windows draw a flickering translucent
        // copy of the window (with title-bar buttons) for about a second and a half; measured on screen, and gone without it.
        let _ = m.show();
    }
    if let Some(sp) = app.get_webview_window("splashscreen") {
        let _ = sp.set_always_on_top(false);
        let _ = sp.hide();
        let _ = sp.close();
    }
}

/// Moves the splash bar. The text is from a fixed list in this file, and is JSON-quoted when it is sent to the page.
fn splash_progress(app: &tauri::AppHandle, pct: u32, text: &str) {
    if let Some(w) = app.get_webview_window("splashscreen") {
        let t = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into());
        let _ = w.eval(format!("window.setProgress && window.setProgress({pct}, {t})"));
    }
}

/// The page reports each real start-up step as it finishes; the bar only ever moves for something that happened.
#[tauri::command(async)]
fn startup_step(app: tauri::AppHandle, step: String) {
    match step.as_str() {
        "ui" => splash_progress(&app, 55, "Opening projects"),
        "projects" => splash_progress(&app, 75, "Looking for EffectCraft"),
        "engine" => splash_progress(&app, 92, "Almost ready"),
        _ => {}
    }
}

#[tauri::command(async)]
fn app_ready(app: tauri::AppHandle) {
    splash_progress(&app, 100, "Ready");
    std::thread::spawn(move || {
        // Wait for the splash to have been shown (it appears once its picture has loaded), then for its minimum time.
        for _ in 0..40 {
            if SPLASH_AT.lock().unwrap().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let left = match *SPLASH_AT.lock().unwrap() {
            Some(at) => SPLASH_MIN.saturating_sub(at.elapsed()),
            None => Duration::ZERO,
        };
        std::thread::sleep(left.max(Duration::from_millis(350)));   // let the bar be seen reaching 100%
        show_main(&app);
    });
}

/// Opens the documentation: the copy that ships with the app when there is one, otherwise the project page. Fixed program and
/// fixed or app-resource targets only.
fn open_docs_now(app: &tauri::AppHandle) {
    let local = app.path().resource_dir().ok().map(|d| d.join("docs")).filter(|d| d.is_dir());
    let target = local.map(|d| d.to_string_lossy().into_owned()).unwrap_or_else(|| DOCS_URL.to_string());
    let prog = if cfg!(windows) { "explorer.exe" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let _ = Command::new(prog).arg(target).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

#[tauri::command(async)]
fn open_docs(app: tauri::AppHandle) {
    open_docs_now(&app);
}

/// Menu labels use `&` mnemonics on Windows and Linux; macOS would show the ampersand, so it is dropped there.
fn lbl(label: &str) -> String {
    if cfg!(target_os = "macos") { label.replace('&', "") } else { label.to_string() }
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
    let it = |id: &str, label: &str, acc: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, lbl(label));
        if let Some(a) = acc {
            b = b.accelerator(a);
        }
        b.build(app)
    };
    let mac = cfg!(target_os = "macos");
    let mut file = SubmenuBuilder::new(app, lbl("&File"))
        .item(&it("file-new", "&New Project…", Some("CmdOrCtrl+N"))?)
        .item(&it("file-open", "&Open Project…", Some("CmdOrCtrl+O"))?)
        .item(&it("file-open-folder", "Open Project &Folder…", Some("CmdOrCtrl+Shift+O"))?)
        .separator()
        .item(&it("file-save", "&Save", Some("CmdOrCtrl+S"))?)
        .item(&it("file-save-copy", "Save a &Copy…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&it("file-close", "C&lose Project", Some("CmdOrCtrl+W"))?)
        .separator()
        .item(&it("file-reveal", "Show Projects Fol&der", None)?);
    if !mac {
        // On macOS Settings and Quit live in the app menu (built below), never in File.
        file = file
            .separator()
            .item(&it("file-settings", "Se&ttings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, Some("Exit"))?);
    }
    let file = file.build()?;
    let edit = SubmenuBuilder::new(app, lbl("&Edit"))
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&it("edit-palette", "Command &Palette…", Some("CmdOrCtrl+K"))?)
        .build()?;
    let stage = |n: u8, id: &str, label: &str| it(id, label, Some(&format!("CmdOrCtrl+{n}")));
    let go = SubmenuBuilder::new(app, lbl("&Go"))
        .item(&stage(1, "go-brief", "&Brief")?)
        .item(&stage(2, "go-intent", "&Intent")?)
        .item(&stage(3, "go-direction", "&Direction")?)
        .item(&stage(4, "go-treatment", "&Treatment")?)
        .item(&stage(5, "go-build", "B&uild")?)
        .item(&stage(6, "go-review", "&Review")?)
        .item(&stage(7, "go-deliver", "De&liver")?)
        .build()?;
    let view = SubmenuBuilder::new(app, lbl("&View"))
        .item(&it("view-viewer-only", "&Viewer-only Mode", Some("CmdOrCtrl+Shift+V"))?)
        .item(&it("view-inspector", "Show or Hide &Inspector", Some("CmdOrCtrl+\\"))?)
        .separator()
        .item(&it("view-zoom-in", "Zoom &In", Some("CmdOrCtrl+="))?)
        .item(&it("view-zoom-out", "Zoom &Out", Some("CmdOrCtrl+-"))?)
        .item(&it("view-zoom-reset", "&Actual Size", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let tools = SubmenuBuilder::new(app, lbl("&Tools"))
        .item(&it("tools-models", "Image and Video &Models…", None)?)
        .item(&it("tools-effectcraft", "Open in &EffectCraft", Some("CmdOrCtrl+E"))?)
        .item(&it("tools-engine", "&Locate EffectCraft…", None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, lbl("&Window"))
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let help = SubmenuBuilder::new(app, lbl("&Help"))
        .item(&it("help-docs", "&Documentation", Some("F1"))?)
        .item(&it("help-shortcuts", "&Keyboard Shortcuts", None)?)
        .item(&it("help-manual", "Working &Manually (no AI)", None)?)
        .item(&it("help-about", "&About MotionCraft", None)?)
        .build()?;
    if mac {
        // Native macOS layout: the app menu comes first and carries About, Settings (Cmd+,), Hide and Quit (Cmd+Q).
        let appmenu = SubmenuBuilder::new(app, "MotionCraft")
            .item(&it("help-about", "About MotionCraft", None)?)
            .separator()
            .item(&it("file-settings", "Settings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, Some("Quit MotionCraft"))?)
            .build()?;
        return MenuBuilder::new(app).items(&[&appmenu, &file, &edit, &go, &view, &tools, &window, &help]).build();
    }
    MenuBuilder::new(app).items(&[&file, &edit, &go, &view, &tools, &window, &help]).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Every command that takes `State<EngineState>` (engine_call, confirm_spend, effectcraft_window_open, ...) fails with "state not
        // managed" without this. It was lost once and nothing noticed, because the tests call the functions directly.
        .manage(EngineState::default())
        .on_page_load(|webview, payload| {
            use tauri::webview::PageLoadEvent;
            let app = webview.app_handle().clone();
            match (webview.label(), payload.event()) {
                ("splashscreen", PageLoadEvent::Finished) => {
                    *SPLASH_AT.lock().unwrap() = Some(Instant::now());
                    let _ = webview.window().show();
                    let v = serde_json::to_string(&app.package_info().version.to_string()).unwrap_or_default();
                    let _ = webview.eval(format!("window.setVersion && window.setVersion({v})"));
                    splash_progress(&app, 10, "Starting");
                }
                ("main", PageLoadEvent::Started) => splash_progress(&app, 25, "Loading the interface"),
                ("main", PageLoadEvent::Finished) => splash_progress(&app, 45, "Interface loaded"),
                _ => {}
            }
        })
        .setup(|app| {
            // The splash is created here (hidden) so its link can be handled: mc-open://docs opens the documentation, nothing else may
            // be navigated to.
            let docs_app = app.handle().clone();
            tauri::WebviewWindowBuilder::new(app, "splashscreen", tauri::WebviewUrl::App("splash.html".into()))
                .title("MotionCraft")
                .inner_size(1050.0, 450.0)
                .resizable(false)
                .decorations(false)
                .center()
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)   // a shadow gives the borderless window a frame that Windows animates when it closes
                .visible(false)
                .background_color(tauri::window::Color(24, 26, 28, 255))
                .on_navigation(move |url| {
                    if url.scheme() == "mc-open" {
                        if url.host_str() == Some("docs") {
                            open_docs_now(&docs_app);
                        }
                        return false;
                    }
                    matches!(url.host_str(), Some("tauri.localhost") | Some("localhost")) || url.scheme() == "tauri"
                })
                .build()?;
            if let Some(sp) = app.get_webview_window("splashscreen") {
                no_window_animation(&sp);
            }
            // The menu belongs to the main window only; the splash window must not get a menu bar.
            if let Some(main) = app.get_webview_window("main") {
                no_window_animation(&main);
                main.set_menu(build_menu(app.handle())?)?;
            }
            let h = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(12));
                show_main(&h);
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            load_project,
            save_project,
            engine_status,
            open_in_effectcraft,
            effectcraft_window_open,
            engine_call,
            set_provider_key,
            delete_provider_key,
            provider_key_status,
            confirm_spend,
            asset_data_url,
            projects_folder,
            reveal_projects_folder,
            import_project,
            duplicate_project,
            import_asset,
            import_songmap,
            package_file,
            export_package,
            app_ready,
            startup_step,
            open_docs,
            project_health,
            restore_backup,
            unclean_session,
            session_begin,
            session_end
        ])
        .build(tauri::generate_context!())
        .expect("error while building MotionCraft")
        .run(|app, event| {
            // A normal exit removes the "project is open" marker; a crash or kill leaves it, which is what the next launch looks for.
            if let tauri::RunEvent::Exit = event {
                if let Ok(base) = app.path().app_data_dir() {
                    clear_marker(&base);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engine_state_is_registered_with_the_app() {
        // A command taking State<EngineState> cannot run unless the builder manages it, and the unit tests above never go through the
        // command layer. Keep this guard in step with `run()`.
        let src = include_str!("lib.rs");
        let needle = format!(".{}(EngineState::default())", "manage");   // built at run time so this test's own text is not what it finds
        assert_eq!(src.lines().filter(|l| l.trim_start().starts_with(&needle)).count(), 1, "run() must register the engine state exactly once");
        assert!(src.matches("State<EngineState>").count() >= 4, "commands that need the engine state exist");
    }

    #[test]
    fn a_crash_mid_save_loses_nothing_and_a_damaged_file_can_be_restored() {
        let dir = std::env::temp_dir().join(format!("mc-crash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let main = dir.join("project.json");
        let v1 = serde_json::json!({"schemaVersion": "1.0", "name": "x", "updatedAt": "t1"});
        let v2 = serde_json::json!({"schemaVersion": "1.0", "name": "x", "updatedAt": "t2"});
        atomic_write(&main, &serialise(&v1).unwrap()).unwrap();
        assert!(!dir.join("project.json.bak").exists(), "the first write has nothing to back up");
        atomic_write(&main, &serialise(&v2).unwrap()).unwrap();
        assert_eq!(health_of(&dir).state, "ok");
        assert_eq!(health_of(&dir).backup_updated_at.as_deref(), Some("t1"), "the backup is the previous good save");

        // The process dies half-way through the next save: a torn temp file is left, project.json is untouched.
        fs::write(dir.join("project.json.tmp"), b"{\"schemaVersion\": \"1.").unwrap();
        assert_eq!(read_valid(&main).unwrap()["updatedAt"], "t2");

        // The file itself is damaged (disk fault): it is reported, and restore brings back the last good copy.
        fs::write(&main, b"{ not json").unwrap();
        assert_eq!(health_of(&dir).state, "damaged");
        restore_backup_in(&dir).unwrap();
        assert_eq!(health_of(&dir).state, "ok");
        assert_eq!(read_valid(&main).unwrap()["updatedAt"], "t1");
        assert!(dir.join("project.damaged.json").exists(), "the damaged file is kept, not deleted");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_file_never_becomes_the_backup_and_restore_needs_a_good_one() {
        let dir = std::env::temp_dir().join(format!("mc-nobak-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let main = dir.join("project.json");
        let good = serialise(&serde_json::json!({"schemaVersion": "1.0", "name": "x", "updatedAt": "g"})).unwrap();
        atomic_write(&main, &good).unwrap();
        atomic_write(&main, &good).unwrap();
        fs::write(&main, b"junk").unwrap();
        atomic_write(&main, &good).unwrap(); // saving over a damaged file must not overwrite the good backup with junk
        assert_eq!(read_valid(&dir.join("project.json.bak")).unwrap()["updatedAt"], "g");
        fs::write(dir.join("project.json.bak"), b"also junk").unwrap();
        fs::write(&main, b"junk").unwrap();
        assert!(restore_backup_in(&dir).is_err());
        assert_eq!(fs::read(&main).unwrap(), b"junk", "nothing is touched when there is no good backup");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_open_project_marker_survives_only_an_unclean_exit() {
        let base = std::env::temp_dir().join(format!("mc-marker-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        assert_eq!(read_marker(&base), None);
        write_marker(&base, "C:/docs/MotionCraft/A.motioncraft").unwrap();
        assert_eq!(read_marker(&base).as_deref(), Some("C:/docs/MotionCraft/A.motioncraft"), "still there after a crash");
        clear_marker(&base);
        assert_eq!(read_marker(&base), None, "a normal exit or close removes it");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_songmap_must_be_a_real_one_before_it_is_copied_in() {
        let good = r#"{"schema_version": 1, "duration": 88.0, "bpm": 120, "sections": [], "beats": []}"#;
        assert!(validate_songmap(good).is_ok());
        for (bad, why) in [
            ("not json at all", "valid JSON"),
            ("[1, 2, 3]", "not a SongMap"),
            (r#"{"schema_version": 2, "duration": 1, "sections": []}"#, "schema version 1"),
            (r#"{"duration": 1, "sections": []}"#, "schema version 1"),
            (r#"{"schema_version": 1, "sections": []}"#, "no duration"),
            (r#"{"schema_version": 1, "duration": 5}"#, "no sections"),
            (r#"{"schema_version": 1, "duration": "5", "sections": []}"#, "no duration"),
        ] {
            let e = validate_songmap(bad).expect_err(bad);
            assert!(e.contains(why), "{bad}: {e}");
        }
    }

    #[test]
    fn songmap_import_and_marker_writes_are_in_the_closed_method_list() {
        assert!(ENGINE_METHODS.contains(&"songmap_import") && !WRITE_METHODS.contains(&"songmap_import"), "reading a SongMap writes nothing");
        assert!(ENGINE_METHODS.contains(&"sync_labelled_markers") && WRITE_METHODS.contains(&"sync_labelled_markers"), "markers write the composition");
        assert!(!PAID_ENGINE_METHODS.contains(&"sync_labelled_markers") && !PAID_ENGINE_METHODS.contains(&"songmap_import"), "neither costs anything");
    }

    #[test]
    fn names_are_sanitised() {
        assert_eq!(safe_name("My Piece").unwrap(), "My Piece");
        assert_eq!(safe_name("../../Windows/System32").unwrap(), "WindowsSystem32");
        assert_eq!(safe_name("a/b\\c:d*e?").unwrap(), "abcde");
        assert_eq!(safe_name("  .. hidden").unwrap(), "hidden");
        assert!(safe_name("///").is_err());
        assert!(safe_name("").is_err());
        assert_eq!(safe_name("con").unwrap(), "con project");
        assert!(safe_name(&"x".repeat(200)).unwrap().len() <= 60);
    }

    #[test]
    fn package_paths_must_sit_directly_in_the_root() {
        let base = std::env::temp_dir().join(format!("mc-test-{}", std::process::id()));
        let root = base.join("root");
        fs::create_dir_all(root.join("ok.motioncraft")).unwrap();
        fs::create_dir_all(root.join("plain")).unwrap();
        fs::create_dir_all(base.join("outside.motioncraft")).unwrap();
        let root = root.canonicalize().unwrap();
        assert!(check_package(&root, root.join("ok.motioncraft").to_str().unwrap()).is_ok());
        assert!(check_package(&root, root.join("plain").to_str().unwrap()).is_err());
        assert!(check_package(&root, base.join("outside.motioncraft").to_str().unwrap()).is_err());
        assert!(check_package(&root, root.join("ok.motioncraft").join("..").join("..").join("outside.motioncraft").to_str().unwrap()).is_err());
        assert!(check_package(&root, root.join("missing.motioncraft").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn writes_are_atomic_and_replace() {
        let dir = std::env::temp_dir().join(format!("mc-atomic-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("project.json");
        atomic_write(&f, b"one").unwrap();
        atomic_write(&f, b"two").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two");
        assert!(!dir.join("project.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_foreign_json() {
        assert!(serialise(&serde_json::json!({"hello": 1})).is_err());
        assert!(serialise(&serde_json::json!({"schemaVersion": "1.0", "name": "x"})).is_ok());
    }

    /// Needs a real engine: EFFECTCRAFT_CLI=<path> MOTIONCRAFT_ENGINE_DIR=<repo>/engine cargo test -- --ignored
    #[test]
    #[ignore]
    fn sidecar_round_trip_with_the_real_engine() {
        let cli = PathBuf::from(std::env::var("EFFECTCRAFT_CLI").expect("EFFECTCRAFT_CLI"));
        let base = std::env::temp_dir().join(format!("mc-sidecar-{}", std::process::id()));
        let pkg = base.join("T.motioncraft");
        fs::create_dir_all(&pkg).unwrap();
        let st = EngineState::default();
        let open = sidecar_request(&st, Some(&cli), None, "open", serde_json::json!({"package": pkg.to_string_lossy()})).unwrap();
        assert_eq!(open["layers"].as_array().unwrap().len(), 0);
        let added = sidecar_request(&st, Some(&cli), None, "add_text", serde_json::json!({"text": "From Rust"})).unwrap();
        assert_eq!(added["layers"][0]["name"], "From Rust");
        let prev = sidecar_request(&st, Some(&cli), None, "preview", serde_json::json!({"times": [0.0], "max_side": 320})).unwrap();
        assert!(prev["png"].as_str().unwrap().len() > 100);
        let bad = sidecar_request(&st, Some(&cli), None, "nope", serde_json::json!({}));
        assert!(bad.is_err());
        let again = sidecar_request(&st, Some(&cli), None, "inspect", serde_json::json!({}));
        assert!(again.is_ok(), "helper must keep serving after an error reply");
        let _ = fs::remove_dir_all(&base);
    }

    /// Spend-gate test list (AGENTS.md): every paid path must go through `take_spend`: generate_start, render_start and a cloud llm_complete.
    #[test]
    fn spend_tokens_are_single_use_and_expire() {
        let st = EngineState::default();
        let t = random_token().unwrap();
        assert_eq!(t.len(), 32);
        assert_ne!(t, random_token().unwrap());
        assert!(!take_spend(&st, &t), "an unknown token is refused");
        st.spend.lock().unwrap().insert(t.clone(), Instant::now() + SPEND_TTL);
        assert!(take_spend(&st, &t));
        assert!(!take_spend(&st, &t), "a token works once");
        st.spend.lock().unwrap().insert("old".into(), Instant::now() - Duration::from_secs(1));
        assert!(!take_spend(&st, "old"), "an expired token is refused");
        assert!(!take_spend(&st, ""));
    }

    #[test]
    fn only_generate_start_is_paid_and_providers_are_a_closed_list() {
        assert!(MODEL_METHODS.contains(&"generate_start"));
        assert!(provider_ok("kie").is_ok() && provider_ok("fal").is_ok() && provider_ok("byteplus").is_ok());
        assert!(provider_ok("suno").is_err() && provider_ok("../x").is_err());
        assert!(!WRITE_METHODS.contains(&"generate_start"));
    }

    #[test]
    fn cloud_language_models_are_gated_and_keys_never_come_from_the_page() {
        assert!(MODEL_METHODS.contains(&"llm_complete"));
        for m in LLM_CALL_METHODS {
            assert!(MODEL_METHODS.contains(&m) && !WRITE_METHODS.contains(&m), "{m} must be allowed, gated and not write the project");
        }
        assert!(LLM_CALL_METHODS.contains(&"builder_plan"), "the Builder's planning call goes through the same gate");
        assert!(ENGINE_METHODS.contains(&"builder_execute") && WRITE_METHODS.contains(&"builder_execute"), "building writes the project, so it is refused while EffectCraft has it open");
        assert!(ENGINE_METHODS.contains(&"qa_run") && !WRITE_METHODS.contains(&"qa_run") && !PAID_ENGINE_METHODS.contains(&"qa_run"), "QA reads the composition and writes nothing");
        assert!(ENGINE_METHODS.contains(&"qa_fix") && WRITE_METHODS.contains(&"qa_fix") && !PAID_ENGINE_METHODS.contains(&"qa_fix"), "a QA fix writes the composition, so it is refused while EffectCraft has it open");
        // P5-02: resuming a final render is a final render, so it needs its own fresh spend token; cancel, discard and list cost nothing.
        assert!(PAID_ENGINE_METHODS.contains(&"render_resume"), "a resumed render needs a confirmation from a click");
        for m in ["render_cancel", "render_discard", "render_jobs"] {
            assert!(ENGINE_METHODS.contains(&m) && !PAID_ENGINE_METHODS.contains(&m) && !WRITE_METHODS.contains(&m), "{m} is free and does not write the project");
        }
        for m in ["snapshot_save", "snapshot_diff", "snapshot_preview", "snapshot_restore"] {
            assert!(ENGINE_METHODS.contains(&m) && !PAID_ENGINE_METHODS.contains(&m), "{m} needs the engine and costs nothing");
        }
        assert!(WRITE_METHODS.contains(&"snapshot_save") && WRITE_METHODS.contains(&"snapshot_restore"), "saving and restoring a version write the project");
        assert!(ENGINE_METHODS.contains(&"timeline_read") && !WRITE_METHODS.contains(&"timeline_read") && !PAID_ENGINE_METHODS.contains(&"timeline_read"), "the timeline only reads and costs nothing");
        assert!(ENGINE_METHODS.contains(&"audio_cached") && !WRITE_METHODS.contains(&"audio_cached") && !PAID_ENGINE_METHODS.contains(&"audio_cached"), "reading a kept analysis writes nothing and costs nothing");
        assert!(ENGINE_METHODS.contains(&"layer_timing") && WRITE_METHODS.contains(&"layer_timing") && !PAID_ENGINE_METHODS.contains(&"layer_timing"), "moving or trimming a layer writes the composition (blocked while EffectCraft has it open) and costs nothing");
        assert!(!WRITE_METHODS.contains(&"snapshot_diff") && !WRITE_METHODS.contains(&"snapshot_preview"), "comparing and previewing only read");
        assert!(!PAID_ENGINE_METHODS.contains(&"builder_execute"), "a plan costs a known $0 today; a paid plan would need its own token path");
        assert!(LLM_CALL_METHODS.contains(&"director_intent"), "the Director calls a model, so it goes through the same gate");
        for (p, account) in LLM_CLOUD {
            assert!(!LLM_LOCAL.contains(&p), "{p} cannot be both cloud and local");
            assert!(KEY_ACCOUNTS.contains(&account), "{account} has no credential-store account");
        }
        assert!(LLM_LOCAL.iter().all(|p| !LLM_CLOUD.iter().any(|(c, _)| c == p)));
        assert!(!WRITE_METHODS.contains(&"llm_complete"), "a language-model call does not write the project");
        assert!(key_entry("suno").is_err() && key_entry("../x").is_err());
    }

    #[test]
    fn finds_the_installer_folder_and_path_entries() {
        let base = std::env::temp_dir().join(format!("mc-find-{}", std::process::id()));
        let pf = base.join("pf");
        fs::create_dir_all(pf.join("EffectCraft")).unwrap();
        fs::write(pf.join("EffectCraft").join(cli_name()), b"x").unwrap();
        let on_path = base.join("bin");
        fs::create_dir_all(&on_path).unwrap();
        fs::write(on_path.join(cli_name()), b"x").unwrap();
        let pf_s = pf.to_string_lossy().into_owned();
        let path_s = std::env::join_paths([&on_path]).unwrap().to_string_lossy().into_owned();
        let env = |k: &str| match k {
            "ProgramFiles" => Some(pf_s.clone()),
            "PATH" => Some(path_s.clone()),
            _ => None,
        };
        let c = candidates_with("", &env);
        let found: Vec<_> = c.iter().filter(|p| looks_like_cli(p)).collect();
        if cfg!(windows) {
            assert!(found.iter().any(|p| p.starts_with(&pf)), "installer folder not searched");
        }
        assert!(found.iter().any(|p| p.starts_with(&on_path)), "PATH not searched");
        assert!(candidates_with("D:/x/effectcraft-cli.exe", &env)[0].ends_with("effectcraft-cli.exe"), "the user's setting comes first");
        let _ = fs::remove_dir_all(&base);
    }

    /// Run on a machine that has EffectCraft installed: cargo test detects_a_real_install -- --ignored --nocapture
    #[test]
    #[ignore]
    fn detects_a_real_install() {
        let st = engine_status(String::new());
        println!("state={} found={:?} version={:?}", st.state, st.found, st.version);
        assert_eq!(st.state, "connected");
    }

    #[test]
    fn package_copies_skip_links_and_keep_files() {
        let base = std::env::temp_dir().join(format!("mc-copy-{}", std::process::id()));
        let src = base.join("a.motioncraft");
        fs::create_dir_all(src.join("assets").join("images")).unwrap();
        fs::write(src.join("project.json"), b"{}").unwrap();
        fs::write(src.join("assets").join("images").join("x.png"), b"png").unwrap();
        let dst = base.join("b.motioncraft");
        copy_dir(&src, &dst, 0).unwrap();
        assert_eq!(fs::read(dst.join("assets").join("images").join("x.png")).unwrap(), b"png");
        assert_eq!(unique_package(&base, "a").file_name().unwrap(), "a 2.motioncraft");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_collected_project_keeps_what_is_needed_to_reopen_it_and_leaves_out_drafts_and_logs() {
        let base = std::env::temp_dir().join(format!("mc-collect-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let src = base.join("a.motioncraft");
        for d in ["assets/images", "assets/audio", "fonts", "renders", "previews", "logs", "analysis", "revisions"] {
            fs::create_dir_all(src.join(d)).unwrap();
        }
        fs::write(src.join("project.json"), b"{}").unwrap();
        fs::write(src.join("comp.ecproj"), b"ecproj").unwrap();
        fs::write(src.join("fonts").join("manifest.json"), b"[]").unwrap();
        fs::write(src.join("assets/images/x.png"), b"png").unwrap();
        fs::write(src.join("assets/audio/s.wav"), b"wav").unwrap();
        fs::write(src.join("renders/final.mp4"), b"mp4").unwrap();
        fs::write(src.join("analysis/s.wav.1-2.json"), b"{}").unwrap();
        fs::write(src.join("revisions/v1.ecproj"), b"v1").unwrap();
        fs::write(src.join("previews/draft.mp4"), b"big draft").unwrap();
        fs::write(src.join("logs/text-layers.json"), b"{}").unwrap();
        let dst = base.join("out.motioncraft");
        collect_package(&src, &dst).unwrap();
        for kept in ["project.json", "comp.ecproj", "fonts/manifest.json", "assets/images/x.png", "assets/audio/s.wav", "renders/final.mp4", "analysis/s.wav.1-2.json", "revisions/v1.ecproj"] {
            assert!(dst.join(kept).is_file(), "{kept} should be kept");
        }
        assert!(!dst.join("previews").exists(), "draft movies are left out");
        assert!(!dst.join("logs").exists(), "working logs are left out");
        assert_eq!(fs::read(dst.join("comp.ecproj")).unwrap(), b"ecproj");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn media_is_recognised_by_its_bytes_not_its_name() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n....").unwrap(), ("image", "png"));
        assert_eq!(sniff(&[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap(), ("image", "jpg"));
        assert_eq!(sniff(b"\0\0\0\x18ftypmp42").unwrap(), ("video", "mp4"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WAVEfmt ").unwrap(), ("audio", "wav"));
        assert_eq!(sniff(b"ID3\x04\0\0").unwrap(), ("audio", "mp3"));
        assert!(sniff(b"MZ\x90\0 an exe renamed to .png").is_none());
        assert!(sniff(b"<html>").is_none());
        assert!(sniff(b"").is_none());
    }

    #[test]
    fn paid_engine_methods_are_registered_and_not_free_writes() {
        assert!(PAID_ENGINE_METHODS.contains(&"render_start"));
        assert!(ENGINE_METHODS.contains(&"render_start"));
        assert!(!MODEL_METHODS.contains(&"render_start"));
        assert!(!WRITE_METHODS.contains(&"render_start"), "a render does not write the project");
        for m in ["preview_movie_start", "render_poll", "audio_analyze", "primitives"] {
            assert!(!WRITE_METHODS.contains(&m), "{m} must stay allowed while EffectCraft is open");
        }
    }

    /// Needs a real engine (see sidecar_round_trip_with_the_real_engine): motion, draft movie and final render through the helper.
    #[test]
    #[ignore]
    fn render_round_trip_with_the_real_engine() {
        let cli = PathBuf::from(std::env::var("EFFECTCRAFT_CLI").expect("EFFECTCRAFT_CLI"));
        let base = std::env::temp_dir().join(format!("mc-render-{}", std::process::id()));
        let pkg = base.join("R.motioncraft");
        fs::create_dir_all(&pkg).unwrap();
        let st = EngineState::default();
        let call = |m: &str, p: Value| sidecar_request(&st, Some(&cli), None, m, p);
        call("open", serde_json::json!({"package": pkg.to_string_lossy(), "settings": {"width": 640, "height": 360, "frame_rate": 30, "duration": 3}})).unwrap();
        let t = call("add_text", serde_json::json!({"text": "Rust render"})).unwrap();
        let lid = t["layer"].clone();
        call("apply_primitive", serde_json::json!({"layer": lid, "primitive": "entrance.fade-in", "params": {"duration": 1.0}})).unwrap();
        let wait = |mut j: Value| {
            for _ in 0..600 {
                if j["state"] != "running" { return j; }
                std::thread::sleep(Duration::from_millis(100));
                j = call("render_poll", serde_json::json!({"job": j["id"]})).unwrap();
            }
            panic!("render did not finish");
        };
        let prev = wait(call("preview_movie_start", serde_json::json!({})).unwrap());
        assert_eq!(prev["state"], "done", "{prev}");
        assert!(pkg.join(prev["output"].as_str().unwrap()).is_file());
        let fin = wait(call("render_start", serde_json::json!({"preset": "h264", "name": "Rust", "spend_token": "t"})).unwrap());
        assert_eq!(fin["state"], "done", "{fin}");
        assert_eq!(fin["frames"], 90);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("effectcraft-cli 0.24.1"), Some("0.24.1".into()));
        assert_eq!(parse_version("EffectCraft v0.25.0 (abc1234)"), Some("0.25.0".into()));
        assert_eq!(parse_version("no version"), None);
    }

    #[test]
    fn only_cli_named_files_are_run() {
        assert!(!looks_like_cli(Path::new("C:/Windows/System32/cmd.exe")));
        assert!(!looks_like_cli(Path::new(r"\\server\share\effectcraft-cli.exe")));
        let dir = std::env::temp_dir().join(format!("mc-cli-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let evil = dir.join("effectcraft-cli-evil.exe");
        fs::write(&evil, b"x").unwrap();
        assert!(!looks_like_cli(&evil), "a prefix match must not be enough");
        let good = dir.join(cli_name());
        fs::write(&good, b"x").unwrap();
        assert!(looks_like_cli(&good));
        let _ = fs::remove_dir_all(&dir);
    }
}
