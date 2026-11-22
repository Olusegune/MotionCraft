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
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::Manager;

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

/// Only a file literally named like the engine CLI is ever run, and only with `--version`.
fn looks_like_cli(p: &Path) -> bool {
    p.is_file()
        && p.file_name().and_then(|n| n.to_str()).map(|n| n.to_ascii_lowercase().starts_with("effectcraft-cli")).unwrap_or(false)
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

/// Starts the EffectCraft GUI. Whether it can open a named composition is unverified (ticket P0-14): this opens the
/// project file only.
#[tauri::command]
fn open_in_effectcraft(app: tauri::AppHandle, path: String, override_path: String) -> Result<(), String> {
    let dir = check_package(&projects_root(&app)?, &path)?;
    let cli = find_cli(&override_path).ok_or("EffectCraft was not found. Set its path in Settings.")?;
    let ecproj = dir.join("comp.ecproj");
    if !ecproj.is_file() {
        return Err("This project has no composition yet. Build one first.".into());
    }
    let gui = cli.with_file_name(gui_name());
    if !gui.is_file() {
        return Err(format!("{} was not found next to effectcraft-cli.", gui_name()));
    }
    Command::new(gui).arg(&ecproj).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| format!("Could not start EffectCraft: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_projects, create_project, load_project, save_project, engine_status, open_in_effectcraft])
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

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("effectcraft-cli 0.24.1"), Some("0.24.1".into()));
        assert_eq!(parse_version("EffectCraft v0.25.0 (abc1234)"), Some("0.25.0".into()));
        assert_eq!(parse_version("no version"), None);
    }

    #[test]
    fn only_cli_named_files_are_run() {
        assert!(!looks_like_cli(Path::new("C:/Windows/System32/cmd.exe")));
    }
}
