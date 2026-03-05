import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initElectronSettings } from "./lib/electronSettings";

// Initialize Electron stores (if running in Electron) before rendering.
// This pre-loads app settings from Documents/Game Servum/
// so they're available synchronously when React components initialize.
async function boot() {
  await initElectronSettings();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
