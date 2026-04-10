import { getElectronSettings } from "@/lib/electronSettings";

const WELCOME_KEY = "has-seen-welcome";

// Use Electron settings store (which persists in Documents/) or fallback to localStorage
function getStorage() {
  return getElectronSettings();
}

/**
 * Returns true if the user has seen the welcome step before.
 * When true, subsequent wizard opens skip straight to the connect step.
 */
export function hasSeenWelcome(): boolean {
  return getStorage().getItem(WELCOME_KEY) === "true";
}

/**
 * Marks the welcome step as seen (called when user clicks "Get Started").
 */
export function markWelcomeSeen(): void {
  getStorage().setItem(WELCOME_KEY, "true");
}
