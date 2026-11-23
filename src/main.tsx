import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/app.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

// Close the splash once the page has drawn, but keep it up long enough to be seen.
if ("__TAURI_INTERNALS__" in window) {
  window.setTimeout(() => { import("./lib/api").then((m) => m.getApi()).then((a) => a.appReady()).catch(() => undefined); }, 1600);
}
