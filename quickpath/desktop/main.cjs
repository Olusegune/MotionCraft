// QuickPath as a desktop app. The same server and page as `node src/server.ts`, in its own window.
// The window shows only http://127.0.0.1:<port> (nothing else can load in it), has no Node access, and asks the system for no permissions.
"use strict";
const { app, BrowserWindow, Menu, shell, session, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const packaged = app.isPackaged;
process.env.QUICKPATH_UI = packaged ? path.join(process.resourcesPath, "ui") : path.join(__dirname, "..", "ui");
const { start } = require(packaged ? "./server.cjs" : path.join(__dirname, "server.cjs"));

if (!app.requestSingleInstanceLock()) { app.quit(); }

let server = null;
let win = null;

function open() {
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: "#0f1114", title: "QuickPath", show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.setMenuBarVisibility(true);
  // Nothing but our own page may load here, and no new windows may open.
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin + "/")) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  if (process.env.QUICKPATH_SMOKE) win.webContents.once("did-finish-load", smoke);
  win.loadURL(origin);
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// The normal Windows menu bar. Every item either asks the page to press one of its own buttons (so the same checks apply as for a click)
// or opens a file or folder in the system's own program. Nothing here sends anything anywhere.
const HOME_DIR = path.join(os.homedir(), "Documents", "QuickPath");
const press = (id) => { if (win) win.webContents.executeJavaScript(`(() => { const b = document.getElementById(${JSON.stringify(id)}); if (b && !b.disabled) b.click(); })()`).catch(() => {}); };
const docPath = (name) => path.join(packaged ? process.resourcesPath : path.join(__dirname, ".."), "docs", name);
const openDoc = (name) => { const p = docPath(name); if (fs.existsSync(p)) shell.openPath(p); else dialog.showMessageBox(win, { type: "info", message: "That guide was not found next to the app.", detail: p }); };

async function openScript() {
  if (!win) return;
  const r = await dialog.showOpenDialog(win, { title: "Open a script", properties: ["openFile"], filters: [{ name: "Script (Markdown or text)", extensions: ["md", "txt", "markdown"] }] });
  if (r.canceled || !r.filePaths[0]) return;
  let text;
  try {
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 60000) { await dialog.showMessageBox(win, { type: "warning", message: "That script is too long.", detail: "Use a script under 60,000 characters (about 12 pages)." }); return; }
    text = fs.readFileSync(r.filePaths[0], "utf-8");
  } catch { await dialog.showMessageBox(win, { type: "error", message: "Could not read that file." }); return; }
  // The words go into the start box as data (JSON), never as code; the page then reads them like pasted text.
  win.webContents.executeJavaScript(`(() => { const a = document.getElementById("again"); if (a && !a.disabled && document.getElementById("start").hidden) a.click(); const i = document.getElementById("idea"); if (i) { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); } })()`).catch(() => {});
}

// A self-check for the build pipeline: with QUICKPATH_SMOKE=1 the app starts, loads its own page, checks what it can see and exits 0 (all good), 1 (something wrong) or 2 (no answer in time).
// It is how CI proves the packaged app really starts on each system, without a person.
async function smoke() {
  const out = { platform: process.platform, arch: process.arch, version: app.getVersion(), packaged };
  try {
    const port = server.address().port;
    const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    out.shapes = Array.isArray(status.shapes) ? status.shapes.length : 0;
    out.title = await win.webContents.executeJavaScript("document.title");
    out.page = await win.webContents.executeJavaScript("!!document.getElementById('make') && !!document.getElementById('idea')");
    out.menu = (Menu.getApplicationMenu()?.items ?? []).map((i) => String(i.label).replace(/&/g, ""));
    out.docs = !packaged || ["USER_GUIDE.md", "SETUP_KEYS.md", "ROADMAP.md", "QA.md"].every((f) => fs.existsSync(docPath(f)));
    out.ok = out.shapes === 6 && out.title === "QuickPath" && out.page === true && out.docs && ["File", "Edit", "View", "Window", "Help"].every((m) => out.menu.includes(m));
  } catch (e) { out.ok = false; out.error = String(e && e.message || e).slice(0, 200); }
  console.log("QUICKPATH_SMOKE " + JSON.stringify(out));
  app.exit(out.ok ? 0 : 1);
}
if (process.env.QUICKPATH_SMOKE) setTimeout(() => { console.log("QUICKPATH_SMOKE timeout"); app.exit(2); }, 60000).unref();

function buildMenu() {
  const dev = !packaged;
  const mac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    { label: "&File", submenu: [
      { label: "&New video", accelerator: "CmdOrCtrl+N", click: () => press("again") },
      { label: "Open a &script…", accelerator: "CmdOrCtrl+O", click: openScript },
      { label: "Your &videos folder", click: () => { fs.mkdirSync(HOME_DIR, { recursive: true }); shell.openPath(HOME_DIR); } },
      { type: "separator" },
      { label: "&Update video", accelerator: "CmdOrCtrl+Return", click: () => press("update") },
      { label: "Save &final video", accelerator: "CmdOrCtrl+S", click: () => press("final") },
      { label: "Open in &EffectCraft", accelerator: "CmdOrCtrl+E", click: () => press("editor") },
      { type: "separator" },
      { label: "S&ettings and keys…", accelerator: "CmdOrCtrl+,", click: () => press("gear") },
      ...(mac ? [] : [{ type: "separator" }, { role: "quit", label: "E&xit" }]) ] },
    { label: "&Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" } ] },
    { label: "&View", submenu: [
      { role: "reload" }, { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" },
      ...(dev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []) ] },
    { label: "&Window", submenu: [{ role: "minimize" }, { role: "close" }, ...(mac ? [{ type: "separator" }, { role: "front" }] : [])] },
    { label: "&Help", submenu: [
      { label: "&User guide", accelerator: "F1", click: () => openDoc("USER_GUIDE.md") },
      { label: "Setting up &keys", click: () => openDoc("SETUP_KEYS.md") },
      { label: "What is &planned", click: () => openDoc("ROADMAP.md") },
      { label: "How it was &tested", click: () => openDoc("QA.md") },
      { label: "&Signing and first launch", click: () => openDoc("SIGNING.md") },
      { type: "separator" },
      { label: "&About QuickPath", click: () => dialog.showMessageBox(win, { type: "info", title: "About QuickPath", message: `QuickPath ${app.getVersion()}`, detail: "Type an idea or open a script, get a finished video.\nVideos are made on this computer with EffectCraft. Paid AI parts (pictures, voices, music, clips) only run after you confirm a price, and stop at your spending limit.\nYour keys stay in Windows Credential Manager." }) } ] },
  ]);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  server = start(0);                                           // any free port, on 127.0.0.1 only
  server.once("listening", open);
});

app.on("window-all-closed", () => { try { server && server.close(); } catch { /* already closed */ } app.quit(); });
