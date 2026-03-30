import { useContext, useEffect, useRef } from "react";
import {
  UnsavedChangesContext,
  type DirtyEntry,
} from "@/contexts/UnsavedChangesContextDef";

interface UseUnsavedChangesOptions {
  onSave?: () => Promise<void>;
  onDiscard?: () => void;
}

/**
 * Register a component's dirty state with the global unsaved-changes guard.
 *
 * @param key      Stable identifier for this component (e.g. "file-editor").
 * @param isDirty  Whether the component currently has unsaved changes.
 * @param options  Optional save / discard callbacks invoked from the dialog.
 * @returns        `{ requestNavigation }` — call before in-page navigations.
 */
export function useUnsavedChanges(
  key: string,
  isDirty: boolean,
  options?: UseUnsavedChangesOptions,
) {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error(
      "useUnsavedChanges must be used inside <UnsavedChangesProvider>",
    );
  }

  // Keep callbacks in refs so the registration doesn't churn on every render
  const onSaveRef = useRef(options?.onSave);
  const onDiscardRef = useRef(options?.onDiscard);
  onSaveRef.current = options?.onSave;
  onDiscardRef.current = options?.onDiscard;

  useEffect(() => {
    const entry: DirtyEntry = {
      isDirty,
      onSave: onSaveRef.current ? () => onSaveRef.current!() : undefined,
      onDiscard: onDiscardRef.current
        ? () => onDiscardRef.current!()
        : undefined,
    };
    ctx.registerDirty(key, entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isDirty]);

  useEffect(() => {
    return () => ctx.unregisterDirty(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { requestNavigation: ctx.requestNavigation };
}
