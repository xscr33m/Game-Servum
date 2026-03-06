import { useState, useEffect, useCallback, useRef } from "react";
import {
  FaServer,
  FaArrowsRotate,
  FaRotateRight,
  FaPlugCircleBolt,
  FaCircle,
  FaChevronDown,
  FaPlus,
  FaPen,
  FaTrash,
  FaEllipsis,
  FaArrowUp,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddAgentDialog } from "@/components/agent/AddAgentDialog";
import { RemoveAgentDialog } from "@/components/agent/RemoveAgentDialog";
import { EditAgentDialog } from "@/components/agent/EditAgentDialog";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";
import type { BackendConnection } from "@/lib/config";
import type { UpdateState } from "@/types";

const STATUS_COLORS = {
  connected: "text-green-500",
  authenticating: "text-yellow-500",
  reconnecting: "text-yellow-500",
  updating: "text-blue-500",
  disconnected: "text-red-400",
  error: "text-red-500",
} as const;

/**
 * Unified agent control panel for the Dashboard header.
 * Combines agent selection, actions, and management in one component.
 */
export function AgentControlPanel() {
  const {
    connections,
    activeConnection,
    setActiveConnection,
    removeConnection,
    updateConnectionDetails,
    isConnected,
    api,
    subscribe,
    reconnectConnection,
    updateConnectionStatus,
  } = useBackend();

  const [menuOpen, setMenuOpen] = useState(false);
  const [displayUptime, setDisplayUptime] = useState<number | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Agent management dialogs
  const [showAdd, setShowAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BackendConnection | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<BackendConnection | null>(null);

  // Track hover state for action buttons per agent
  const [hoveringActionsId, setHoveringActionsId] = useState<string | null>(
    null,
  );

  // Agent actions menu state
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);

  // Agent settings state
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(false);

  // Update state
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const manualCheckRef = useRef(false);

  // Fetch agent system info when connected
  const fetchInfo = useCallback(async () => {
    if (!isConnected) return;
    try {
      const info = await api.system.getInfo();
      setDisplayUptime(info.uptime);
    } catch {
      // Not critical — agent info is supplementary
    }
  }, [api, isConnected]);

  // Fetch agent settings when connected
  const fetchAgentSettings = useCallback(async () => {
    if (!isConnected) return;
    try {
      const settings = await api.system.getAgentSettings();
      setAutoStartEnabled(settings.autoStartEnabled);
    } catch {
      // Not critical — settings are supplementary
    }
  }, [api, isConnected]);

  // Fetch update state when connected
  const fetchUpdateState = useCallback(async () => {
    if (!isConnected) return;
    try {
      const state = await api.system.getUpdateState();
      setUpdateState(state);
    } catch {
      // Not critical — update state is supplementary
    }
  }, [api, isConnected]);

  useEffect(() => {
    fetchInfo();
    fetchAgentSettings();
    fetchUpdateState();
  }, [fetchInfo, fetchAgentSettings, fetchUpdateState]);

  // Listen for real-time agent update WebSocket events
  useEffect(() => {
    if (!isConnected) return;
    const unsubscribe = subscribe((message) => {
      if (message.type === "update:detected") {
        const { currentVersion, latestVersion } = message.payload as {
          currentVersion: string;
          latestVersion: string;
        };
        setUpdateState((prev) => ({
          ...prev!,
          updateAvailable: true,
          currentVersion,
          latestVersion,
          checking: false,
        }));
        toastInfo(`Agent update available: v${latestVersion}`, {
          description: `Current version: v${currentVersion}. Open the agent menu to download and install.`,
        });
      } else if (message.type === "update-check:complete") {
        const { updateAvailable, currentVersion, latestVersion } =
          message.payload as {
            updateAvailable: boolean;
            currentVersion: string;
            latestVersion: string;
          };
        setUpdateState((prev) => ({
          ...prev!,
          updateAvailable,
          currentVersion,
          latestVersion,
          checking: false,
        }));
        if (!updateAvailable && manualCheckRef.current) {
          toastInfo("Agent is up to date");
        }
        manualCheckRef.current = false;
      } else if (message.type === "update:applied") {
        setUpdateState((prev) => ({
          ...prev!,
          downloaded: true,
          downloading: false,
        }));
      } else if (message.type === "update:restart") {
        toastInfo("Agent is restarting to install update...");
        if (activeConnection) {
          updateConnectionStatus(activeConnection.id, "updating");
        }
      }
    });
    return unsubscribe;
  }, [isConnected, subscribe, activeConnection, updateConnectionStatus]);

  // Increment displayed uptime locally every 60s
  const hasUptime = displayUptime != null;
  useEffect(() => {
    if (!hasUptime || !isConnected) return;
    const timer = setInterval(() => {
      setDisplayUptime((prev) => (prev != null ? prev + 60 : prev));
    }, 60_000);
    return () => clearInterval(timer);
  }, [isConnected, hasUptime]);

  if (!activeConnection) return null;

  const status = activeConnection.status || "disconnected";
  const statusColor =
    STATUS_COLORS[status as keyof typeof STATUS_COLORS] ||
    STATUS_COLORS.disconnected;

  async function handleReconnect() {
    if (!activeConnection) return;
    setReconnecting(true);
    try {
      const ok = await reconnectConnection(activeConnection.id);
      if (ok) {
        toastSuccess(`Reconnected to ${activeConnection.name}`);
        fetchInfo();
      } else {
        toastError(`Failed to reconnect to ${activeConnection.name}`);
      }
    } catch {
      toastError("Reconnection failed");
    } finally {
      setReconnecting(false);
    }
  }

  async function handleConfirmRestart() {
    if (!activeConnection) return;
    setRestartLoading(true);
    try {
      await api.system.restart();
      toastSuccess("Agent is restarting...");
      updateConnectionStatus(activeConnection.id, "reconnecting");
      setConfirmRestart(false);
    } catch {
      toastError("Failed to restart agent");
    } finally {
      setRestartLoading(false);
    }
  }

  function handleSelectAgent(conn: BackendConnection) {
    setActiveConnection(conn.id);
    setMenuOpen(false);
  }

  function handleEdit(e: React.MouseEvent, conn: BackendConnection) {
    e.stopPropagation();
    setEditTarget(conn);
  }

  function handleRemove(e: React.MouseEvent, conn: BackendConnection) {
    e.stopPropagation();
    setRemoveTarget(conn);
  }

  function handleConfirmRemove(id: string) {
    removeConnection(id);
  }

  function handleSaveEdit(id: string, details: { name: string }) {
    updateConnectionDetails(id, details);
  }

  async function handleToggleAutoStart(checked: boolean) {
    setAutoStartLoading(true);
    try {
      await api.system.updateAgentSettings({ autoStartEnabled: checked });
      setAutoStartEnabled(checked);
      toastSuccess(
        checked
          ? "Auto-start enabled — Agent will start with Windows"
          : "Auto-start disabled",
      );
    } catch (err) {
      toastError((err as Error).message);
      // Revert toggle on error
      setAutoStartEnabled(!checked);
    } finally {
      setAutoStartLoading(false);
    }
  }

  async function handleCheckForUpdates() {
    setUpdateLoading(true);
    manualCheckRef.current = true;
    try {
      await api.system.checkForUpdates();
      // Refresh state after a short delay to allow updater to process
      setTimeout(() => fetchUpdateState(), 1500);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setUpdateLoading(false);
    }
  }

  async function handleDownloadUpdate() {
    setUpdateLoading(true);
    try {
      await api.system.downloadUpdate();
      toastInfo("Downloading update...");
      // Refresh state after a short delay
      setTimeout(() => fetchUpdateState(), 1500);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setUpdateLoading(false);
    }
  }

  async function handleInstallUpdate() {
    if (!activeConnection) return;
    try {
      await api.system.installUpdate();
      // Toast comes via WebSocket "update:restart" event
      updateConnectionStatus(activeConnection.id, "updating");
      setActionsMenuOpen(false);
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h uptime`;
    if (h > 0) return `${h}h ${m}m uptime`;
    return `${m}m uptime`;
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Agent selector dropdown */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-muted/40 border border-border/50 hover:bg-muted/70 hover:border-border transition-colors cursor-pointer select-none"
          >
            {/* Icon with status dot overlay */}
            <div className="relative shrink-0">
              <FaServer className="h-4 w-4 text-muted-foreground" />
              <FaCircle
                className={`absolute -top-0.5 -right-0.5 h-2 w-2 ${statusColor}`}
              />
            </div>

            {/* Agent name */}
            <span className="text-sm font-medium max-w-[160px] truncate">
              {activeConnection.name}
            </span>

            {/* Update badge / Updating indicator */}
            {status === "updating" ? (
              <Badge
                variant="default"
                className="ml-1 text-[10px] px-1.5 py-0 gap-1 bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30"
              >
                <FaArrowsRotate className="h-2.5 w-2.5 animate-spin" />
                Updating
              </Badge>
            ) : updateState?.updateAvailable ? (
              <Badge variant="warning" className="ml-1 text-[10px] px-1.5 py-0">
                Update
              </Badge>
            ) : null}

            {/* Uptime — separated by a subtle divider (hidden while updating) */}
            {status !== "updating" && displayUptime != null && isConnected && (
              <>
                <span className="text-border/80 hidden sm:inline">·</span>
                <span className="text-[11px] text-muted-foreground hidden sm:inline tabular-nums">
                  {formatUptime(displayUptime)}
                </span>
              </>
            )}

            {/* Chevron indicator */}
            <FaChevronDown
              className={`h-2.5 w-2.5 text-muted-foreground/60 transition-transform ml-0.5 ${menuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {menuOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              {/* Dropdown with agent list */}
              <div className="absolute left-0 top-full mt-1.5 z-50 w-80 max-h-[400px] overflow-y-auto rounded-lg border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95">
                {connections.length === 0 ? (
                  <div className="p-6 text-center">
                    <FaServer className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground mb-3">
                      No agents connected.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowAdd(true);
                      }}
                    >
                      <FaPlus className="h-3 w-3 mr-1.5" />
                      Add Agent
                    </Button>
                  </div>
                ) : (
                  <div className="p-1">
                    {connections.map((conn) => {
                      const isActive = conn.id === activeConnection?.id;
                      const s =
                        (conn.status as keyof typeof STATUS_COLORS) ||
                        "disconnected";
                      const showConnectOverlay =
                        !isActive && hoveringActionsId !== conn.id;

                      return (
                        <button
                          key={conn.id}
                          onClick={() => handleSelectAgent(conn)}
                          className={`group w-full text-left rounded-lg border transition-all relative ${
                            isActive
                              ? "border-ring/40 bg-accent"
                              : "border-transparent bg-transparent hover:bg-accent/40 hover:cursor-pointer"
                          }`}
                        >
                          {/* Active indicator bar */}
                          {isActive && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-ring rounded-r-full" />
                          )}

                          {/* Connect overlay for inactive agents */}
                          {showConnectOverlay && (
                            <div className="absolute inset-0 bg-accent/80 backdrop-blur-[2px] rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              <div className="flex items-center gap-2 text-foreground">
                                <FaPlugCircleBolt className="h-4 w-4" />
                                <span className="text-sm font-medium">
                                  Connect
                                </span>
                              </div>
                            </div>
                          )}

                          <div className="p-2.5 flex items-center gap-2.5">
                            {/* Icon with status dot */}
                            <div className="relative shrink-0">
                              <FaServer className="h-4 w-4 text-muted-foreground" />
                              <FaCircle
                                className={`absolute -top-0.5 -right-0.5 h-2 w-2 ${STATUS_COLORS[s]}`}
                              />
                            </div>

                            {/* Name + meta */}
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-medium truncate leading-tight">
                                {conn.name}
                              </div>
                              <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground leading-tight">
                                <span className="font-mono truncate">
                                  {new URL(conn.url).host}
                                </span>
                                {conn.agentInfo && (
                                  <>
                                    <span className="text-border">·</span>
                                    <span className="shrink-0">
                                      v{conn.agentInfo.version}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Edit and Remove buttons - shown on hover */}
                            <div
                              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity relative z-20"
                              onMouseEnter={() => setHoveringActionsId(conn.id)}
                              onMouseLeave={() => setHoveringActionsId(null)}
                            >
                              <button
                                onClick={(e) => handleEdit(e, conn)}
                                className="p-1.5 rounded hover:bg-muted/50 transition-colors hover:cursor-pointer"
                                title="Edit agent"
                              >
                                <FaPen className="h-4 w-4 text-muted-foreground" />
                              </button>
                              <button
                                onClick={(e) => handleRemove(e, conn)}
                                className="p-1.5 rounded hover:bg-destructive/20 transition-colors hover:cursor-pointer"
                                title="Remove agent"
                              >
                                <FaTrash className="h-4 w-4 text-destructive" />
                              </button>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Agent Actions Menu */}
        <div className="relative">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setActionsMenuOpen(!actionsMenuOpen)}
            title="Agent actions"
          >
            <FaEllipsis className="h-4 w-4" />
          </Button>

          {actionsMenuOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setActionsMenuOpen(false)}
              />
              {/* Actions dropdown menu */}
              <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-lg border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95">
                <div className="p-1.5">
                  {/* Reconnect action */}
                  <button
                    onClick={() => {
                      handleReconnect();
                      setActionsMenuOpen(false);
                    }}
                    disabled={
                      !activeConnection || reconnecting || status === "updating"
                    }
                    className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reconnecting ? (
                      <FaArrowsRotate className="h-4 w-4 animate-spin" />
                    ) : (
                      <FaPlugCircleBolt className="h-4 w-4" />
                    )}
                    <span>Reconnect</span>
                  </button>

                  {/* Restart action */}
                  <button
                    onClick={() => {
                      setConfirmRestart(true);
                      setActionsMenuOpen(false);
                    }}
                    disabled={!isConnected || status === "updating"}
                    className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FaRotateRight className="h-4 w-4" />
                    <span>Restart Agent</span>
                  </button>

                  {/* Check for Updates action */}
                  <button
                    onClick={() => {
                      handleCheckForUpdates();
                      setActionsMenuOpen(false);
                    }}
                    disabled={
                      !isConnected ||
                      updateLoading ||
                      updateState?.checking ||
                      updateState?.downloading ||
                      status === "updating"
                    }
                    className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updateState?.checking || updateLoading ? (
                      <FaArrowsRotate className="h-4 w-4 animate-spin" />
                    ) : (
                      <FaArrowsRotate className="h-4 w-4" />
                    )}
                    <span>Check for Updates</span>
                  </button>

                  {/* Download Update action - only shown when update available */}
                  {updateState?.updateAvailable && !updateState.downloaded && (
                    <button
                      onClick={() => {
                        handleDownloadUpdate();
                        setActionsMenuOpen(false);
                      }}
                      disabled={
                        !isConnected ||
                        updateLoading ||
                        updateState?.downloading
                      }
                      className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {updateState?.downloading ? (
                        <FaArrowsRotate className="h-4 w-4 animate-spin" />
                      ) : (
                        <FaArrowUp className="h-4 w-4" />
                      )}
                      <span>
                        Download Update{" "}
                        {updateState?.latestVersion &&
                          `(v${updateState.latestVersion})`}
                      </span>
                      {updateState?.downloading &&
                        updateState?.downloadProgress != null && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {updateState.downloadProgress.toFixed(0)}%
                          </span>
                        )}
                    </button>
                  )}

                  {/* Install & Restart action - only shown when update downloaded */}
                  {updateState?.downloaded && (
                    <button
                      onClick={() => {
                        handleInstallUpdate();
                      }}
                      disabled={!isConnected}
                      className="flex items-center gap-2.5 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FaRotateRight className="h-4 w-4" />
                      <span>Install & Restart Agent</span>
                    </button>
                  )}

                  {/* Divider */}
                  <div className="my-1.5 border-t border-border/50" />

                  {/* Auto-start toggle */}
                  <div className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>Start with Windows</span>
                    <Switch
                      checked={autoStartEnabled}
                      onCheckedChange={handleToggleAutoStart}
                      disabled={autoStartLoading || !isConnected}
                      className="scale-90"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Add Agent Button */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowAdd(true)}
          title="Add agent"
        >
          <FaPlus className="h-4 w-4" />
        </Button>
      </div>

      {/* Add Agent Dialog */}
      <AddAgentDialog open={showAdd} onOpenChange={setShowAdd} />

      {/* Remove Agent Dialog */}
      <RemoveAgentDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        agent={removeTarget}
        onConfirm={handleConfirmRemove}
      />

      {/* Edit Agent Dialog */}
      <EditAgentDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        agent={editTarget}
        onSave={handleSaveEdit}
      />

      {/* Restart Confirmation Dialog */}
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart Agent?</DialogTitle>
            <DialogDescription>
              This will restart the Game-Servum agent on{" "}
              <strong>{activeConnection?.name}</strong>. All running game
              servers will be gracefully stopped and restarted after the agent
              comes back online.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRestart(false)}
              disabled={restartLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmRestart} disabled={restartLoading}>
              {restartLoading ? (
                <>
                  <FaArrowsRotate className="h-4 w-4 mr-2 animate-spin" />
                  Restarting...
                </>
              ) : (
                <>
                  <FaRotateRight className="h-4 w-4 mr-2" />
                  Restart
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
