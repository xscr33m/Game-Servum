import { useContext } from "react";
import {
  BackendContext,
  type BackendContextValue,
} from "@/contexts/BackendContextDef";

export function useBackend(): BackendContextValue {
  const ctx = useContext(BackendContext);
  if (!ctx) {
    throw new Error("useBackend() must be used within <BackendProvider>");
  }
  return ctx;
}
