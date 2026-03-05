import { getElectronSettings } from "@/lib/electronSettings";

const ONBOARDING_KEY = "onboarding-completed";

// Use Electron settings store (which persists in Documents/) or fallback to localStorage
function getStorage() {
  return getElectronSettings();
}

/**
 * Returns true if onboarding has been completed before.
 */
export function isOnboardingComplete(): boolean {
  return getStorage().getItem(ONBOARDING_KEY) === "true";
}

/**
 * Marks onboarding as complete.
 */
export function markOnboardingComplete(): void {
  getStorage().setItem(ONBOARDING_KEY, "true");
}

/**
 * Resets onboarding state (for re-running the wizard).
 */
export function resetOnboarding(): void {
  getStorage().removeItem(ONBOARDING_KEY);
}
