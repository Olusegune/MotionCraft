//! MotionCraft desktop shell: project packages on disk and a read-only look at the EffectCraft install.
//!
//! This layer never edits composition data. The `.ecproj` is the only store of that (AGENTS.md). Engine commands are not
//! sent from here: they go through the Python adapter (ticket P1-11). This file only locates the engine and launches its
//! GUI. No shell, no `eval`, no network.

use serde::Serialize;
use serde_json::Value;
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
    let mut v = vec![];
    if !override_path.trim().is_empty() {
        v.push(PathBuf::from(override_path.trim()));
    }
    if let Ok(p) = std::env::var("EFFECTCRAFT_CLI") {
        v.push(PathBuf::from(p));
    }
    if cfg!(windows) {
        for var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(var) {
                let b = PathBuf::from(base);
                v.push(if var == "LOCALAPPDATA" { b.join("Programs") } else { b }.join("ArtCraft").join("EffectCraft").join(cli_name()));
            }
        }
    } else {
        for p in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"] {
            v.push(Path::new(p).join(cli_name()));
        }
        if let Ok(home) = std::env::var("HOME") {
            v.push(Path::new(&home).join(".cargo").join("bin").join(cli_name()));
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
}

#[derive(Default)]
pub struct EngineState {
    sidecar: Mutex<Option<Sidecar>>,
    gui: Mutex<Option<Child>>,
}

const METHODS: [&str; 9] = ["open", "inspect", "add_text", "set_text", "add_camera", "lock", "unlock", "preview", "close"];
const WRITE_METHODS: [&str; 5] = ["add_text", "set_text", "add_camera", "lock", "unlock"];

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
    // Development only: run the Python package from a checkout (MOTIONCRAFT_ENGINE_DIR=<repo>/engine).
    if let Ok(dir) = std::env::var("MOTIONCRAFT_ENGINE_DIR") {
        let d = PathBuf::from(dir);
        if d.join("motioncraft_engine").is_dir() {
            let py = if cfg!(windows) { "python" } else { "python3" };
            return Ok((PathBuf::from(py), vec!["-m".into(), "motioncraft_engine.sidecar".into()], Some(d)));
        }
    }
    Err("The MotionCraft engine helper was not found next to the app. Reinstall MotionCraft.".into())
}

fn start_sidecar(cli: &Path) -> Result<Sidecar, String> {
    let (prog, mut args, cwd) = sidecar_program()?;
    args.push("--effectcraft-cli".into());
    args.push(cli.to_string_lossy().into_owned());
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
    Ok(Sidecar { child, stdin, rx, next_id: 1 })
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

/// One request to the Python engine helper. The method list is closed, the package path is re-validated here, and writes are
/// refused while an EffectCraft window has the project open (P0-07: a write behind an open GUI is silently lost).
#[tauri::command]
fn engine_call(
    app: tauri::AppHandle,
    st: State<EngineState>,
    method: String,
    mut params: Value,
    override_path: String,
    package: Option<String>,
) -> Result<Value, String> {
    if !METHODS.contains(&method.as_str()) {
        return Err(format!("Unknown engine method {method}."));
    }
    if WRITE_METHODS.contains(&method.as_str()) && gui_running(&st) {
        return Err("EffectCraft has this project open. Make changes there, then close it and press Refresh. MotionCraft will not write the file while it is open.".into());
    }
    if !params.is_object() {
        params = serde_json::json!({});
    }
    if method == "open" {
        let root = projects_root(&app)?;
        let pkg = check_package(&root, package.as_deref().ok_or("No project path.")?)?;
        params.as_object_mut().unwrap().insert("package".into(), Value::String(pkg.to_string_lossy().into_owned()));
    } else {
        params.as_object_mut().unwrap().remove("package");
    }
    let cli = find_cli(&override_path).ok_or("EffectCraft was not found. Set its path in Settings.")?;
    sidecar_request(&st, &cli, &method, params)
}

/// Sends one request to the engine helper (starting it if needed) and waits for the reply with the matching id.
fn sidecar_request(st: &EngineState, cli: &Path, method: &str, params: Value) -> Result<Value, String> {
    let mut guard = st.sidecar.lock().unwrap();
    if guard.is_none() {
        *guard = Some(start_sidecar(cli)?);
    }
    let sc = guard.as_mut().unwrap();
    let id = sc.next_id;
    sc.next_id += 1;
    let line = serde_json::json!({"id": id, "method": method, "params": params}).to_string();
    let io_ok = writeln!(sc.stdin, "{line}").and_then(|_| sc.stdin.flush()).is_ok();
    let timeout = Duration::from_secs(if method == "open" || method == "preview" { 180 } else { 60 });
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

#[tauri::command]
fn effectcraft_window_open(st: State<EngineState>) -> bool {
    gui_running(&st)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineState::default())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            load_project,
            save_project,
            engine_status,
            open_in_effectcraft,
            effectcraft_window_open,
            engine_call
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
        let open = sidecar_request(&st, &cli, "open", serde_json::json!({"package": pkg.to_string_lossy()})).unwrap();
        assert_eq!(open["layers"].as_array().unwrap().len(), 0);
        let added = sidecar_request(&st, &cli, "add_text", serde_json::json!({"text": "From Rust"})).unwrap();
        assert_eq!(added["layers"][0]["name"], "From Rust");
        let prev = sidecar_request(&st, &cli, "preview", serde_json::json!({"times": [0.0], "max_side": 320})).unwrap();
        assert!(prev["png"].as_str().unwrap().len() > 100);
        let bad = sidecar_request(&st, &cli, "nope", serde_json::json!({}));
        assert!(bad.is_err());
        let again = sidecar_request(&st, &cli, "inspect", serde_json::json!({}));
        assert!(again.is_ok(), "helper must keep serving after an error reply");
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
