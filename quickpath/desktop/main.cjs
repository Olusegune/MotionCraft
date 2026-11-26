// QuickPath as a desktop app. The same server and page as `node src/server.ts`, in its own window.
// The window shows only http://127.0.0.1:<port> (nothing else can load in it), has no Node access, and asks the system for no permissions.
"use strict";
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("node:path");

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
  win.setMenuBarVisibility(false);
  // Nothing but our own page may load here, and no new windows may open.
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin + "/")) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.loadURL(origin);
  win.on("closed", () => { win = null; });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Open the QuickPath folder", click: () => shell.openPath(require("node:path").join(require("node:os").homedir(), "Documents", "QuickPath")) },
      { type: "separator" }, { role: "quit" } ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
  ]));
  server = start(0);                                           // any free port, on 127.0.0.1 only
  server.once("listening", open);
});

app.on("window-all-closed", () => { try { server && server.close(); } catch { /* already closed */ } app.quit(); });
