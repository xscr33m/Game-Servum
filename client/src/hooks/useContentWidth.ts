import { useSyncExternalStore } from "react";
import { getElectronSettings } from "@/lib/electronSettings";

const STORAGE_KEY = "content_width_mode";

type ContentWidthMode = "full" | "centered";

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ContentWidthMode {
  const value = getElectronSettings().getItem(STORAGE_KEY);
  return value === "centered" ? "centered" : "full";
}

export function setContentWidthMode(mode: ContentWidthMode): void {
  getElectronSettings().setItem(STORAGE_KEY, mode);
  emitChange();
}

export function useContentWidth(): {
  contentClass: string;
  mode: ContentWidthMode;
} {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    mode,
    contentClass: mode === "centered" ? "max-w-5xl mx-auto w-full" : "",
  };
}
