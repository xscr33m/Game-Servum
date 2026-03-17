import { useState, useEffect, useCallback } from "react";
import {
  FaCubes,
  FaPlus,
  FaArrowUpRightFromSquare,
  FaTrashCan,
  FaArrowsRotate,
  FaChevronUp,
  FaChevronDown,
  FaCircleCheck,
  FaCircleExclamation,
  FaSpinner,
  FaServer,
  FaUsers,
  FaDownload,
} from "react-icons/fa6";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useBackend } from "@/hooks/useBackend";
import { useGameCapabilities } from "@/hooks/useGameCapabilities";
import { toastSuccess } from "@/lib/toast";
import {
  getGameName,
  getWorkshopUrl,
} from "@/components/server-details/games/registry";
import type { GameServer, ServerMod } from "@/types";

interface ModsTabProps {
  server: GameServer;
}

const statusConfig = {
  pending: {
    label: "Pending",
    variant: "secondary" as const,
    icon: FaSpinner,
  },
  downloading: {
    label: "Downloading",
    variant: "warning" as const,
    icon: FaSpinner,
  },
  installed: {
    label: "Installed",
    variant: "success" as const,
    icon: FaCircleCheck,
  },
  error: {
    label: "Error",
    variant: "destructive" as const,
    icon: FaCircleExclamation,
  },
  update_available: {
    label: "Update Available",
    variant: "warning" as const,
    icon: FaDownload,
  },
};

export function ModsTab({ server }: ModsTabProps) {
  const [workshopInput, setWorkshopInput] = useState("");
  const [isServerMod, setIsServerMod] = useState(false);
  const [mods, setMods] = useState<ServerMod[]>([]);
  const [modParam, setModParam] = useState("");
  const [serverModParam, setServerModParam] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const { capabilities, gameDefinition } = useGameCapabilities(server.gameId);
  const [error, setError] = useState<string | null>(null);
  const [persistentError, setPersistentError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<number | null>(null);
  const [modToRemove, setModToRemove] = useState<ServerMod | null>(null);

  const { api, subscribe, isConnected } = useBackend();

  const loadMods = useCallback(async () => {
    try {
      const data = await api.servers.getMods(server.id);
      setMods(data.mods);
      setModParam(data.modParam);
      setServerModParam(data.serverModParam);
      // Only clear local errors, not persistent errors from WebSocket
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadMods();
  }, [loadMods, isConnected]);

  // Subscribe to mod updates via WebSocket
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "mod:progress" || message.type === "mod:installed") {
        const payload = message.payload as { serverId: number };
        if (payload.serverId === server.id) {
          loadMods();
        }
      } else if (message.type === "mod:error") {
        const payload = message.payload as { serverId: number; error: string };
        if (payload.serverId === server.id) {
          // Show persistent error message that won't be cleared by loadMods
          setPersistentError(payload.error);
          loadMods();
        }
      }
    });
    return unsubscribe;
  }, [subscribe, server.id, loadMods]);

  async function handleAddMod() {
    if (!workshopInput.trim()) return;

    setAdding(true);
    setError(null);
    setPersistentError(null);

    try {
      await api.servers.addMod(server.id, workshopInput.trim(), isServerMod);
      toastSuccess("Mod added — downloading...");
      setWorkshopInput("");
      setIsServerMod(false);
      await loadMods();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleMod(mod: ServerMod) {
    setActionInProgress(mod.id);
    try {
      await api.servers.updateMod(server.id, mod.id, { enabled: !mod.enabled });
      toastSuccess(`${mod.name} ${mod.enabled ? "disabled" : "enabled"}`);
      await loadMods();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleReinstallMod(mod: ServerMod) {
    setActionInProgress(mod.id);
    try {
      await api.servers.reinstallMod(server.id, mod.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleRemoveMod(mod: ServerMod) {
    setActionInProgress(mod.id);
    try {
      await api.servers.removeMod(server.id, mod.id);
      toastSuccess(`${mod.name} removed`);
      await loadMods();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleMoveMod(modId: number, direction: "up" | "down") {
    const index = mods.findIndex((m) => m.id === modId);
    if (index === -1) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= mods.length) return;

    // Swap in local state for instant feedback
    const reordered = [...mods];
    [reordered[index], reordered[newIndex]] = [
      reordered[newIndex],
      reordered[index],
    ];
    setMods(reordered);

    // Persist new order
    try {
      await api.servers.reorderMods(
        server.id,
        reordered.map((m) => m.id),
      );
      await loadMods();
    } catch (err) {
      setError((err as Error).message);
      await loadMods(); // revert on error
    }
  }

  // Check if input looks like a valid workshop ID or URL
  const isValidInput = (() => {
    const input = workshopInput.trim();
    if (!input) return false;
    // Direct ID
    if (/^\d+$/.test(input)) return true;
    // Steam URL with ID
    if (/[?&]id=\d+/.test(input)) return true;
    return false;
  })();

  const isRunning = server.status === "running";
  const installedMods = mods.filter(
    (m) => m.status === "installed" || m.status === "update_available",
  );
  const clientMods = installedMods.filter((m) => !m.isServerMod && m.enabled);
  const serverMods = installedMods.filter((m) => m.isServerMod && m.enabled);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <FaSpinner className="h-6 w-6 animate-spin mx-auto mb-2" />
          Loading mods...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* No Workshop support — show info message */}
      {capabilities && !capabilities.workshopMods && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FaCubes className="h-5 w-5 text-ring" />
              Mod Management
            </CardTitle>
            <CardDescription>
              Steam Workshop is not available for {getGameName(server.gameId)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This game doesn't support Steam Workshop mods through Game-Servum.
              Mods must be downloaded from external sources (e.g., Nexus Mods)
              and installed manually into the server directory.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Workshop mod management — only when workshop is supported */}
      {(!capabilities || capabilities.workshopMods) && (
        <>
          {/* Warning if server is running */}
          {isRunning && (
            <Alert variant="destructive">
              <FaCircleExclamation className="h-4 w-4" />
              <AlertDescription>
                Server is running. Stop the server before modifying mods.
              </AlertDescription>
            </Alert>
          )}

          {/* Error display */}
          {(error || persistentError) && (
            <Alert variant="destructive">
              <FaCircleExclamation className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>{error || persistentError}</span>
                {persistentError && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-destructive-foreground hover:bg-destructive/20"
                    onClick={() => setPersistentError(null)}
                  >
                    Dismiss
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Add Mod Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FaPlus className="h-5 w-5 text-ring" />
                Add Workshop Mod
              </CardTitle>
              <CardDescription>
                Enter a Steam Workshop ID or URL to download a mod
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label htmlFor="workshopInput" className="sr-only">
                    Workshop ID or URL
                  </Label>
                  <Input
                    id="workshopInput"
                    placeholder="Workshop ID or URL (e.g., 2116157322 or https://steamcommunity.com/...)"
                    value={workshopInput}
                    onChange={(e) => setWorkshopInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        isValidInput &&
                        !adding &&
                        !isRunning
                      ) {
                        handleAddMod();
                      }
                    }}
                    disabled={isRunning}
                  />
                </div>
                <Button
                  onClick={handleAddMod}
                  disabled={!isValidInput || adding || isRunning}
                >
                  {adding ? (
                    <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FaPlus className="h-4 w-4 mr-2" />
                  )}
                  Add Mod
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isServerMod}
                    onChange={(e) => setIsServerMod(e.target.checked)}
                    className="rounded border-input hover:cursor-pointer"
                    disabled={isRunning}
                  />
                  <FaServer className="h-4 w-4 text-muted-foreground" />
                  Server-side only mod
                </label>
              </div>

              <p className="text-sm text-muted-foreground">
                Find mods on the{" "}
                <a
                  href={getWorkshopUrl(
                    gameDefinition?.workshopAppId,
                    server.appId,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {getGameName(server.gameId)} Steam Workshop
                  <FaArrowUpRightFromSquare className="h-3 w-3" />
                </a>
              </p>
            </CardContent>
          </Card>

          {/* Installed Mods Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FaCubes className="h-5 w-5 text-ring" />
                Installed Mods
                {mods.length > 0 && (
                  <Badge variant="secondary">{mods.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Manage installed mods and their load order
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mods.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FaCubes className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No mods installed yet.</p>
                  <p className="text-sm mt-1">Add mods using the form above.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {mods.map((mod, index) => {
                    const statusCfg = statusConfig[mod.status];
                    const StatusIcon = statusCfg.icon;
                    const isProcessing = actionInProgress === mod.id;

                    return (
                      <div
                        key={mod.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          mod.enabled
                            ? "bg-muted/50 border-border"
                            : "bg-muted/20 border-border/50 opacity-60"
                        }`}
                      >
                        {/* Load order & move buttons */}
                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleMoveMod(mod.id, "up")}
                            disabled={index === 0 || isRunning}
                            title="Move up"
                          >
                            <FaChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                            {index + 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => handleMoveMod(mod.id, "down")}
                            disabled={index === mods.length - 1 || isRunning}
                            title="Move down"
                          >
                            <FaChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{mod.name}</p>
                            {mod.isServerMod && (
                              <Badge variant="outline" className="text-xs">
                                <FaServer className="h-3 w-3 mr-1" />
                                Server
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>ID: {mod.workshopId}</span>
                            <a
                              href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <FaArrowUpRightFromSquare className="h-3 w-3" />
                            </a>
                          </div>
                        </div>

                        <Badge variant={statusCfg.variant} className="shrink-0">
                          <StatusIcon
                            className={`h-3 w-3 mr-1 ${
                              mod.status === "downloading" ? "animate-spin" : ""
                            }`}
                          />
                          {statusCfg.label}
                        </Badge>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleMod(mod)}
                            disabled={
                              isRunning ||
                              isProcessing ||
                              (mod.status !== "installed" &&
                                mod.status !== "update_available")
                            }
                            title={mod.enabled ? "Disable mod" : "Enable mod"}
                          >
                            {mod.enabled ? "Disable" : "Enable"}
                          </Button>

                          {mod.status === "error" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleReinstallMod(mod)}
                              disabled={isRunning || isProcessing}
                              title="Retry installation"
                            >
                              <FaArrowsRotate className="h-4 w-4" />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setModToRemove(mod)}
                            disabled={isRunning || isProcessing}
                            title="Remove mod"
                            className="text-destructive hover:text-destructive"
                          >
                            <FaTrashCan className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Launch Parameters Info */}
          <Card>
            <CardHeader>
              <CardTitle>Launch Parameters</CardTitle>
              <CardDescription>
                Mod parameters that will be used when starting the server
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {clientMods.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <FaUsers className="h-4 w-4 text-ring" />
                    Client Mods ({clientMods.length})
                  </div>
                  <div className="bg-muted p-3 rounded-lg font-mono text-sm break-all">
                    {modParam || "-mod="}
                  </div>
                </div>
              )}

              {serverMods.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                    <FaServer className="h-4 w-4 text-ring" />
                    Server-side Mods ({serverMods.length})
                  </div>
                  <div className="bg-muted p-3 rounded-lg font-mono text-sm break-all">
                    {serverModParam || "-serverMod="}
                  </div>
                </div>
              )}

              {installedMods.length === 0 && (
                <div className="bg-muted p-3 rounded-lg font-mono text-sm text-muted-foreground">
                  No mods configured
                </div>
              )}

              {installedMods.length > 0 &&
                clientMods.length === 0 &&
                serverMods.length === 0 && (
                  <div className="bg-muted p-3 rounded-lg font-mono text-sm text-muted-foreground">
                    All mods are disabled
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Remove Mod Confirmation Dialog */}
          <Dialog
            open={!!modToRemove}
            onOpenChange={(open) => !open && setModToRemove(null)}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FaTrashCan className="h-5 w-5 text-destructive" />
                  Remove Mod
                </DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove{" "}
                  <span className="font-semibold text-foreground">
                    {modToRemove?.name}
                  </span>
                  ?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setModToRemove(null)}
                  disabled={actionInProgress === modToRemove?.id}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={actionInProgress === modToRemove?.id}
                  onClick={() => {
                    if (modToRemove) {
                      handleRemoveMod(modToRemove);
                      setModToRemove(null);
                    }
                  }}
                  className="w-full sm:w-auto"
                >
                  Remove
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
