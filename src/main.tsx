import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);

// Keep the native window hidden until React has committed and the browser has
// had an opportunity to paint the initial shell.
requestAnimationFrame(() => requestAnimationFrame(() => {
  void getCurrentWindow().show().catch((error) => {
    // The browser-only development server has no Tauri window to show. In a
    // packaged app, keep failures visible for startup diagnostics.
    if ("__TAURI_INTERNALS__" in window) console.error("Unable to show main window", error);
  });
}));
