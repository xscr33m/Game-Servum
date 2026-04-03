import { useEffect, useRef, useState } from "react";
import {
  FaArrowsRotate,
  FaCircleExclamation,
  FaPlugCircleXmark,
  FaTrash,
  FaTriangleExclamation,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks/useBackend";
import { RemoveAgentDialog } from "@/components/agent/RemoveAgentDialog";
import type { BackendConnection } from "@/lib/config";

const SHOW_DELAY_MS = 2000;

/**
 * Delays visibility by {@link SHOW_DELAY_MS} after `shouldShow` becomes true,
 * and resets immediately when it becomes false.
 */
function useDelayedVisibility(shouldShow: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (shouldShow) {
      timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    } else {
      timerRef.current = setTimeout(() => setVisible(false), 0);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [shouldShow]);

  return visible;
}

/**
 * Non-blocking banner shown below the header on every page when the active
 * agent is in any non-connected state.  Replaces the old full-screen
 * AgentReconnectionScreen with an inline indicator that keeps the entire
 * Commander usable.
 *
 * A short delay prevents the banner from flashing briefly during fast
 * reconnect cycles (e.g. clicking "Reconnect" in the AgentControlPanel).
 */
export function AgentStatusBanner() {
  const { activeConnection, resetReconnectAttempts, removeConnection } =
    useBackend();

  const [removeTarget, setRemoveTarget] = useState<BackendConnection | null>(
    null,
  );

  const isIntentional =
    activeConnection?.status === "updating" ||
    activeConnection?.status === "restarting";

  const compatWarning = activeConnection?.agentInfo?.compatibilityWarning;

  const shouldShowStatus =
    !!activeConnection && activeConnection.status !== "connected";

  // Skip the delay for intentional disconnects (update/restart) — show immediately.
  // Keep the delay for unexpected disconnects to avoid flicker on brief network blips.
  const delayedVisible = useDelayedVisibility(
    shouldShowStatus && !isIntentional,
  );
  const statusVisible = isIntentional ? shouldShowStatus : delayedVisible;

  // Show compatibility warning even when connected
  if (!activeConnection) return null;
  if (!statusVisible && !compatWarning) return null;

  const name = activeConnection.name;
  const status = activeConnection.status;
  const attempts = activeConnection.reconnectAttempts ?? 0;

  // ── Compatibility warning (shown even when connected) ─────────────────
  if (status === "connected" && compatWarning) {
    return (
      <Banner color="amber">
        <FaTriangleExclamation className="h-3.5 w-3.5 shrink-0" />
        <span>
          Agent <strong>{name}</strong> is outdated (v
          {activeConnection.agentInfo?.version}). Update recommended for full
          compatibility. You may experience issues or missing features.
        </span>
      </Banner>
    );
  }

  if (!statusVisible) return null;

  // ── Updating ──────────────────────────────────────────────────────────
  if (status === "updating") {
    return (
      <Banner color="blue">
        <FaArrowsRotate className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>
          Agent <strong>{name}</strong> is updating and will reconnect
          automatically…
        </span>
      </Banner>
    );
  }

  // ── Restarting ────────────────────────────────────────────────────────
  if (status === "restarting") {
    return (
      <Banner color="blue">
        <FaArrowsRotate className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>
          Agent <strong>{name}</strong> is restarting and will reconnect
          automatically…
        </span>
      </Banner>
    );
  }

  // ── Reconnecting / Authenticating ─────────────────────────────────────
  if (status === "reconnecting" || status === "authenticating") {
    return (
      <Banner color="amber">
        <FaArrowsRotate className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>
          Reconnecting to agent <strong>{name}</strong>
          {attempts > 0 && (
            <span className="opacity-70"> (attempt {attempts})</span>
          )}
          …
        </span>
      </Banner>
    );
  }

  // ── Error (max attempts reached or auth failure) ──────────────────────
  if (status === "error") {
    return (
      <>
        <Banner color="red">
          <FaCircleExclamation className="h-3.5 w-3.5 shrink-0" />
          <span>
            Connection to agent <strong>{name}</strong> failed
            {activeConnection.lastError && (
              <span className="opacity-70">
                {" "}
                — {activeConnection.lastError}
              </span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs hover:bg-red-500/20"
              onClick={() => resetReconnectAttempts(activeConnection.id)}
            >
              <FaArrowsRotate className="h-3 w-3 mr-1" />
              Retry
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs hover:bg-red-500/20"
              onClick={() => setRemoveTarget(activeConnection)}
            >
              <FaTrash className="h-3 w-3 mr-1" />
              Remove
            </Button>
          </div>
        </Banner>
        <RemoveAgentDialog
          open={!!removeTarget}
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          agent={removeTarget}
          onConfirm={(id) => removeConnection(id)}
        />
      </>
    );
  }

  // ── Disconnected (fallback) ───────────────────────────────────────────
  return (
    <Banner color="gray">
      <FaPlugCircleXmark className="h-3.5 w-3.5 shrink-0" />
      <span>
        Agent <strong>{name}</strong> is disconnected
      </span>
    </Banner>
  );
}

// ── Shared banner shell ─────────────────────────────────────────────────

const COLOR_CLASSES = {
  blue: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
  amber:
    "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400",
  gray: "bg-muted/50 border-border text-muted-foreground",
} as const;

function Banner({
  color,
  children,
}: {
  color: keyof typeof COLOR_CLASSES;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`shrink-0 flex items-center gap-2.5 px-4 py-2 border-b text-sm ${COLOR_CLASSES[color]}`}
    >
      {children}
    </div>
  );
}
