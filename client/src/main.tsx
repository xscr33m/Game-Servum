import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initElectronSettings } from "./lib/electronSettings";
import { initCredentialStore } from "./lib/credentialStore";

// Initialize Electron stores (if running in Electron) before rendering.
// This pre-loads app settings + credentials from Documents/Game-Servum/
// so they're available synchronously when React components initialize.
async function boot() {
  await initElectronSettings();
  await initCredentialStore();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot();
