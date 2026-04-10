import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import {
  UnsavedChangesContext,
  type DirtyEntry,
  type UnsavedChangesContextValue,
} from "./UnsavedChangesContextDef";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  // We keep the map in a ref so that frequent updates (every keystroke) don't
  // trigger re-renders of the entire tree.  A small counter state is bumped
  // whenever the *derived* dirty boolean changes.
  const entriesRef = useRef<Map<string, DirtyEntry>>(new Map());
  const [hasDirtyState, setHasDirtyState] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const pendingProceed = useRef<(() => void) | null>(null);
  // Flag to let the next blocker trigger pass through without showing the
  // dialog again (the dirty state hasn't re-rendered yet when proceed fires).
  const bypassBlockerRef = useRef(false);

  // ─── Registration helpers ───
  const recalcDirty = useCallback(() => {
    const dirty = Array.from(entriesRef.current.values()).some(
      (e) => e.isDirty,
    );
    setHasDirtyState(dirty);
  }, []);

  const registerDirty = useCallback(
    (key: string, entry: DirtyEntry) => {
      entriesRef.current.set(key, entry);
      recalcDirty();
    },
    [recalcDirty],
  );

  const unregisterDirty = useCallback(
    (key: string) => {
      entriesRef.current.delete(key);
      recalcDirty();
    },
    [recalcDirty],
  );

  // ─── In-page navigation guard ───
  const requestNavigation = useCallback(
    (onProceed: () => void) => {
      if (!hasDirtyState) {
        onProceed();
        return;
      }
      pendingProceed.current = onProceed;
      setSaveError(null);
      setDialogOpen(true);
    },
    [hasDirtyState],
  );

  // ─── React Router blocker (route navigation) ───
  const blocker = useBlocker(hasDirtyState);

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (bypassBlockerRef.current) {
        bypassBlockerRef.current = false;
        blocker.proceed();
        return;
      }
      pendingProceed.current = () => blocker.proceed();
      setSaveError(null);
      setDialogOpen(true);
    }
  }, [blocker]);

  // ─── beforeunload (browser refresh / close) ───
  useEffect(() => {
    if (!hasDirtyState) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDirtyState]);

  // ─── Dialog action handlers ───
  function getDirtyEntries(): DirtyEntry[] {
    return Array.from(entriesRef.current.values()).filter((e) => e.isDirty);
  }

  async function handleSave() {
    const dirty = getDirtyEntries();
    setIsSaving(true);
    setSaveError(null);
    try {
      for (const entry of dirty) {
        if (entry.onSave) {
          await entry.onSave();
        }
      }
      // Proceed after successful save
      setDialogOpen(false);
      bypassBlockerRef.current = true;
      const proceed = pendingProceed.current;
      pendingProceed.current = null;
      proceed?.();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save changes",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    const dirty = getDirtyEntries();
    for (const entry of dirty) {
      entry.onDiscard?.();
    }
    setDialogOpen(false);
    bypassBlockerRef.current = true;
    const proceed = pendingProceed.current;
    pendingProceed.current = null;
    proceed?.();
  }

  function handleCancel() {
    setDialogOpen(false);
    // If the blocker was active, reset it so the URL stays
    if (blocker.state === "blocked") {
      blocker.reset();
    }
    pendingProceed.current = null;
  }

  // ─── Context value (stable ref where possible) ───
  const ctxValue: UnsavedChangesContextValue = {
    registerDirty,
    unregisterDirty,
    hasDirtyState,
    requestNavigation,
  };

  return (
    <UnsavedChangesContext.Provider value={ctxValue}>
      {children}
      <UnsavedChangesDialog
        open={dialogOpen}
        saving={isSaving}
        error={saveError}
        onSave={handleSave}
        onDiscard={handleDiscard}
        onCancel={handleCancel}
      />
    </UnsavedChangesContext.Provider>
  );
}
