import { FaArrowsRotate } from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

/**
 * Non-blocking banner shown when the active agent is being updated.
 * Rendered below the header on all pages so the user stays informed
 * without losing access to the rest of the Dashboard.
 */
export function AgentUpdatingBanner() {
  const { activeConnection } = useBackend();

  if (activeConnection?.status !== "updating") return null;

  return (
    <div className="shrink-0 flex items-center gap-2.5 px-4 py-2 bg-blue-500/10 border-b border-blue-500/30 text-blue-600 dark:text-blue-400 text-sm">
      <FaArrowsRotate className="h-3.5 w-3.5 animate-spin shrink-0" />
      <span>
        Agent <strong>{activeConnection.name}</strong> is updating and will
        reconnect automatically…
      </span>
    </div>
  );
}
