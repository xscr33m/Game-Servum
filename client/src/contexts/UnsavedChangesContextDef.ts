import { createContext } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirtyEntry {
  isDirty: boolean;
  onSave?: () => Promise<void>;
  onDiscard?: () => void;
}

export interface UnsavedChangesContextValue {
  /** Register (or update) a component's dirty state. */
  registerDirty: (key: string, entry: DirtyEntry) => void;
  /** Unregister a component (e.g. on unmount). */
  unregisterDirty: (key: string) => void;
  /** True when at least one registered component has unsaved changes. */
  hasDirtyState: boolean;
  /**
   * Guard an in-page navigation (tab switch, file switch, etc.).
   * If there are unsaved changes the dialog is shown; otherwise `onProceed`
   * is called immediately.
   */
  requestNavigation: (onProceed: () => void) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const UnsavedChangesContext =
  createContext<UnsavedChangesContextValue | null>(null);
