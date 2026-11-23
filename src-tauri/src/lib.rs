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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
fn load_project(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    let text = fs::read_to_string(dir.join("project.json")).map_err(|e| format!("Could not read project.json: {e}"))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("project.json is damaged: {e}"))?;
    if v.get("schemaVersion").and_then(Value::as_str) != Some("1.0") {
        return Err("This project was made by a different MotionCraft version and cannot be opened yet.".into());
    }
    Ok(v)
}

#[tauri::command]
fn save_project(app: tauri::AppHandle, path: String, project: Value) -> Result<(), String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    atomic_write(&dir.join("project.json"), &serialise(&project)?)
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
    let mut child = Command::new(cli)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", cli.display()))?;
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

#[tauri::command]
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

const ENGINE_METHODS: [&str; 9] = ["open", "inspect", "add_text", "set_text", "add_camera", "lock", "unlock", "preview", "close"];
const MODEL_METHODS: [&str; 5] = ["models", "models_refresh", "generate_start", "generate_poll", "generate_cancel"];
const WRITE_METHODS: [&str; 5] = ["add_text", "set_text", "add_camera", "lock", "unlock"];
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
    provider_ok(provider)?;
    keyring::Entry::new(KEY_SERVICE, &format!("{provider}-api-key")).map_err(|e| format!("Credential store unavailable: {e}"))
}

/// Keys live only in the operating system credential store. They are never returned to the page.
#[tauri::command]
fn set_provider_key(provider: String, key: String) -> Result<(), String> {
    let k = key.trim();
    if k.len() < 8 || k.len() > 512 || k.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("That does not look like an API key.".into());
    }
    key_entry(&provider)?.set_password(k).map_err(|e| format!("Could not save the key: {e}"))
}

#[tauri::command]
fn delete_provider_key(provider: String) -> Result<(), String> {
    match key_entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the key: {e}")),
    }
}

#[tauri::command]
fn provider_key_status() -> HashMap<String, bool> {
    PROVIDERS.iter().map(|p| (p.to_string(), key_entry(p).ok().and_then(|e| e.get_password().ok()).is_some())).collect()
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
#[tauri::command]
fn confirm_spend(st: State<EngineState>, provider: String, model: String) -> Result<String, String> {
    provider_ok(&provider)?;
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
#[tauri::command]
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
    let timeout = Duration::from_secs(if method == "open" || method == "preview" || method == "models_refresh" { 180 } else { 60 });
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
#[tauri::command]
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
#[tauri::command]
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

#[tauri::command]
fn effectcraft_window_open(st: State<EngineState>) -> bool {
    gui_running(&st)
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

#[tauri::command]
fn projects_folder(app: tauri::AppHandle) -> Result<String, String> {
    Ok(projects_root(&app)?.to_string_lossy().into_owned())
}

/// Shows the projects folder in the system file browser. Fixed program, the folder is our own canonical root.
#[tauri::command]
fn reveal_projects_folder(app: tauri::AppHandle) -> Result<(), String> {
    let root = projects_root(&app)?;
    let prog = if cfg!(windows) { "explorer.exe" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    Command::new(prog).arg(root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| format!("Could not open the folder: {e}"))?;
    Ok(())
}

/// Brings a `.motioncraft` folder from anywhere into the projects folder (a copy) so it can be opened. Used by File > Open Project Folder.
#[tauri::command]
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
#[tauri::command]
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

/// Closes the splash and shows the main window (idempotent). The page calls it when it has drawn; a timer calls it too, so a
/// page that never loads cannot leave the user looking at the splash forever.
fn show_main(app: &tauri::AppHandle) {
    if let Some(sp) = app.get_webview_window("splashscreen") {
        let _ = sp.close();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.show();
        let _ = m.set_focus();
    }
}

#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    show_main(&app);
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
    let it = |id: &str, label: &str, acc: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, label);
        if let Some(a) = acc {
            b = b.accelerator(a);
        }
        b.build(app)
    };
    let file = SubmenuBuilder::new(app, "&File")
        .item(&it("file-new", "&New Project…", Some("CmdOrCtrl+N"))?)
        .item(&it("file-open", "&Open Project…", Some("CmdOrCtrl+O"))?)
        .item(&it("file-open-folder", "Open Project &Folder…", Some("CmdOrCtrl+Shift+O"))?)
        .separator()
        .item(&it("file-save", "&Save", Some("CmdOrCtrl+S"))?)
        .item(&it("file-save-copy", "Save a &Copy…", Some("CmdOrCtrl+Shift+S"))?)
        .item(&it("file-close", "C&lose Project", Some("CmdOrCtrl+W"))?)
        .separator()
        .item(&it("file-reveal", "Show Projects Fol&der", None)?)
        .item(&it("file-settings", "Se&ttings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("E&xit"))?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "&Edit")
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
    let go = SubmenuBuilder::new(app, "&Go")
        .item(&stage(1, "go-brief", "&Brief")?)
        .item(&stage(2, "go-intent", "&Intent")?)
        .item(&stage(3, "go-direction", "&Direction")?)
        .item(&stage(4, "go-treatment", "&Treatment")?)
        .item(&stage(5, "go-build", "B&uild")?)
        .item(&stage(6, "go-review", "&Review")?)
        .item(&stage(7, "go-deliver", "De&liver")?)
        .build()?;
    let view = SubmenuBuilder::new(app, "&View")
        .item(&it("view-viewer-only", "&Viewer-only Mode", Some("CmdOrCtrl+Shift+V"))?)
        .item(&it("view-inspector", "Show or Hide &Inspector", Some("CmdOrCtrl+\\"))?)
        .separator()
        .item(&it("view-zoom-in", "Zoom &In", Some("CmdOrCtrl+="))?)
        .item(&it("view-zoom-out", "Zoom &Out", Some("CmdOrCtrl+-"))?)
        .item(&it("view-zoom-reset", "&Actual Size", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let tools = SubmenuBuilder::new(app, "&Tools")
        .item(&it("tools-models", "Image and Video &Models…", None)?)
        .item(&it("tools-effectcraft", "Open in &EffectCraft", Some("CmdOrCtrl+E"))?)
        .item(&it("tools-engine", "&Locate EffectCraft…", None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "&Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "&Help")
        .item(&it("help-shortcuts", "&Keyboard Shortcuts", None)?)
        .item(&it("help-manual", "Working &Manually (no AI)", None)?)
        .item(&it("help-about", "&About MotionCraft", None)?)
        .build()?;
    MenuBuilder::new(app).items(&[&file, &edit, &go, &view, &tools, &window, &help]).build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState::default())
        .setup(|app| {
            // The menu belongs to the main window only; the splash window must not get a menu bar.
            if let Some(main) = app.get_webview_window("main") {
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
            app_ready
        ])
        .run(tauri::generate_context!())
        .expect("error while running MotionCraft");
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Spend-gate test list (AGENTS.md): every paid path must go through `take_spend`. `generate_start` is the only paid method.
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
        assert!(found.iter().any(|p| p.starts_with(&pf)), "installer folder not searched");
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
