import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FaPlus,
  FaArrowsRotate,
  FaGear,
  FaUser,
  FaUserSlash,
  FaPlugCircleXmark,
  FaFileLines,
  FaCircleQuestion,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ServerCard } from "@/components/server-details/ServerCard";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { hasSeenWelcome } from "@/components/onboarding/onboardingState";
import { AddServerDialog } from "@/components/server-details/dialogs/AddServerDialog";
import { DeleteServerDialog } from "@/components/server-details/dialogs/DeleteServerDialog";
import { CancelInstallDialog } from "@/components/server-details/dialogs/CancelInstallDialog";
import { SteamAccountDialog } from "@/components/agent/SteamAccountDialog";
import { SystemMonitor } from "@/components/agent/SystemMonitor";
import { AgentStatusBanner } from "@/components/agent/AgentStatusBanner";
import { useBackend } from "@/hooks/useBackend";
import { logger } from "@/lib/logger";
import { getElectronSettings } from "@/lib/electronSettings";
import { AgentControlPanel } from "@/components/agent/AgentControlPanel";
import { MobileAgentSection } from "@/components/agent/MobileAgentSection";
import { AppHeader } from "@/components/AppHeader";
import { publicAsset } from "@/lib/assets";
import { toastSuccess, toastError, showDependencyError } from "@/lib/toast";
import { Tip } from "@/components/ui/tooltip";
import { useContentWidth } from "@/hooks/useContentWidth";
import { cn } from "@/lib/utils";
import type { GameServer, SteamCMDStatus } from "@/types";
import { APP_VERSION } from "@game-servum/shared";

// ── Module-level navigation cache ──
// Survives SPA navigation (Dashboard → ServerDetail → Dashboard) but not
// full page refreshes.  Keeps the server list visible when the user
// navigates back to the Dashboard while the agent is temporarily unreachable.
let _cachedServers: GameServer[] = [];
let _cachedSteamcmd: SteamCMDStatus | null = null;
let _cacheAgentId: string | null = null;

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [servers, setServers] = useState<GameServer[]>([]);
  const [steamcmd, setSteamcmd] = useState<SteamCMDStatus | null>(null);
  const [loading, setLoading] = useState(false); // Start with false, set true when actually loading
  const [showWizard, setShowWizard] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);
  const [showSteamAccount, setShowSteamAccount] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<GameServer | null>(null);
  const [serverToCancel, setServerToCancel] = useState<GameServer | null>(null);
  const [installProgress, setInstallProgress] = useState<
    Map<number, { percent: number; message: string }>
  >(new Map());
  const [monitoringEnabled, setMonitoringEnabled] = useState(() => {
    return (
      getElectronSettings().getItem("system_monitoring_enabled") === "true"
    );
  });

  const { api, subscribe, isConnected, activeConnection, connections } =
    useBackend();
  const { contentClass } = useContentWidth();

  // Restore from navigation cache if the active agent matches
  useEffect(() => {
    if (activeConnection?.id && activeConnection.id === _cacheAgentId) {
      if (_cachedServers.length > 0) setServers(_cachedServers);
      if (_cachedSteamcmd) setSteamcmd(_cachedSteamcmd);
    } else if (activeConnection?.id && activeConnection.id !== _cacheAgentId) {
      // Agent changed — clear stale cache
      _cachedServers = [];
      _cachedSteamcmd = null;
      _cacheAgentId = activeConnection.id;
    }
  }, [activeConnection?.id]);

  const loadServers = useCallback(async () => {
    const data = await api.servers.getAll();
    setServers(data);
    // Update navigation cache
    _cachedServers = data;
    _cacheAgentId = activeConnection?.id ?? null;

    // Seed install progress for any servers currently installing
    for (const s of data) {
      if (s.status === "installing") {
        api.servers
          .getInstallStatus(s.id)
          .then((status) => {
            if (status.installing && status.percent > 0) {
              setInstallProgress((prev) => {
                const next = new Map(prev);
                next.set(s.id, {
                  percent: status.percent,
                  message: status.message,
                });
                return next;
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [api, activeConnection?.id]);

  const loadSteamCMD = useCallback(async () => {
    const status = await api.steamcmd.getStatus();
    setSteamcmd(status);
    // Update navigation cache
    _cachedSteamcmd = status;
  }, [api]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadSteamCMD(), loadServers()]);
      // Load monitoring setting (non-blocking)
      api.system
        .getSettings()
        .then((s) => {
          setMonitoringEnabled(s.monitoringEnabled);
          getElectronSettings().setItem(
            "system_monitoring_enabled",
            String(s.monitoringEnabled),
          );
        })
        .catch(() => {});
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadSteamCMD, loadServers, api.system]);

  // Fetch initial data (skip before connection is ready or when no agents)
  const hasData = servers.length > 0 || steamcmd !== null;
  useEffect(() => {
    if (isConnected && connections.length > 0) {
      loadData();
    }
  }, [loadData, isConnected, connections.length]);

  // Reload data when connection is (re-)established
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !prevConnected.current && connections.length > 0) {
      // Connection just came back — reload everything
      logger.info("[Dashboard] Connection restored, reloading data...");
      loadData();
    }
    prevConnected.current = isConnected;
  }, [isConnected, loadData, connections.length]);

  // When all agents are removed, clear stale dashboard state
  useEffect(() => {
    if (connections.length === 0) {
      setServers([]);
      setSteamcmd(null);
      setInstallProgress(new Map());
      setLoading(false);
      // Clear navigation cache
      _cachedServers = [];
      _cachedSteamcmd = null;
      _cacheAgentId = null;
    }
  }, [connections.length]);

  // Auto-open wizard on first launch (no agents, never seen welcome)
  const hasAutoOpened = useRef(false);
  useEffect(() => {
    if (
      !hasAutoOpened.current &&
      connections.length === 0 &&
      !hasSeenWelcome()
    ) {
      hasAutoOpened.current = true;
      setShowWizard(true);
    }
  }, [connections.length]);

  // Handle ?setup= query param to open wizard
  useEffect(() => {
    const setupStep = searchParams.get("setup");
    if (setupStep) {
      setShowWizard(true);
    }
  }, [searchParams]);

  // Subscribe to WebSocket messages
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "server:status") {
        const payload = message.payload as {
          serverId: number;
          status: string;
          message?: string;
        };
        // Show error message if server crashed or failed to start
        if (payload.status === "error" && payload.message) {
          showDependencyError(payload.message);
        }
        // Clear install progress when server leaves installing state
        if (payload.status !== "installing") {
          setInstallProgress((prev) => {
            if (!prev.has(payload.serverId)) return prev;
            const next = new Map(prev);
            next.delete(payload.serverId);
            return next;
          });
        }
        // Reload servers on status change
        loadServers();
      }
      if (message.type === "install:progress") {
        const payload = message.payload as {
          serverId: number;
          percent: number;
          message: string;
        };
        setInstallProgress((prev) => {
          const next = new Map(prev);
          next.set(payload.serverId, {
            percent: payload.percent,
            message: payload.message,
          });
          return next;
        });
      }
      if (message.type === "install:complete") {
        const payload = message.payload as {
          serverId?: number;
          serverName?: string;
        };
        toastSuccess(`${payload.serverName || "Server"} installation complete`);
        if (payload.serverId) {
          setInstallProgress((prev) => {
            if (!prev.has(payload.serverId!)) return prev;
            const next = new Map(prev);
            next.delete(payload.serverId!);
            return next;
          });
        }
        // Reload servers when installation completes
        loadServers();
      }
      if (message.type === "server:deleted") {
        const payload = message.payload as { serverId: number };
        // Remove the deleted server from the list without a full reload
        setServers((prev) => prev.filter((s) => s.id !== payload.serverId));
      }
      if (message.type === "install:cancelled") {
        const payload = message.payload as { serverName?: string };
        toastSuccess(
          `Installation of ${payload.serverName || "server"} cancelled`,
        );
      }
    });
    return unsubscribe;
  }, [subscribe, loadServers]);

  async function handleStartServer(id: number) {
    if (!isConnected) return;
    try {
      await api.servers.start(id);
      const server = servers.find((s) => s.id === id);
      toastSuccess(`${server?.name || "Server"} is starting...`);
      await loadServers();
    } catch (err) {
      const errorMessage = (err as Error).message;
      showDependencyError(errorMessage);
    }
  }

  async function handleStopServer(id: number) {
    if (!isConnected) return;
    try {
      await api.servers.stop(id);
      const server = servers.find((s) => s.id === id);
      toastSuccess(`${server?.name || "Server"} stopped`);
      await loadServers();
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  function handleDeleteServer(id: number) {
    const server = servers.find((s) => s.id === id);
    if (server) {
      setServerToDelete(server);
    }
  }

  async function confirmDeleteServer(
    server: GameServer,
    deleteBackups: boolean,
  ) {
    try {
      await api.servers.delete(server.id, server.name, deleteBackups);
      toastSuccess(`${server.name} is being deleted...`);
      // The server:status WS event will update the card to "Deleting"
      // and server:deleted will remove it once complete
      await loadServers();
    } catch (err) {
      toastError((err as Error).message);
      throw err; // Re-throw so dialog knows it failed
    }
  }

  function handleCancelInstall(id: number) {
    const server = servers.find((s) => s.id === id);
    if (server) {
      setServerToCancel(server);
    }
  }

  async function confirmCancelInstall(server: GameServer) {
    try {
      await api.servers.cancelInstall(server.id);
      toastSuccess(`Cancelling installation of ${server.name}...`);
      // The server:status WS event will update the card to "Deleting"
      // and server:deleted will remove it once cleanup is complete
      await loadServers();
    } catch (err) {
      toastError((err as Error).message);
      throw err;
    }
  }

  // Callback for AgentControlPanel "Add Agent" button
  function handleAddAgent() {
    setShowWizard(true);
  }

  const noAgents = connections.length === 0;

  if (loading && !hasData && !noAgents && !showWizard) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <FaArrowsRotate className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Wizard overlay */}
      {showWizard && (
        <OnboardingWizard
          onClose={() => {
            setShowWizard(false);
            setSearchParams({}, { replace: true });
          }}
          onComplete={() => {
            setShowWizard(false);
            setSearchParams({}, { replace: true });
            loadData();
          }}
        />
      )}
      {/* Header */}
      <AppHeader
        left={
          <>
            <img
              src={publicAsset("commander-icon.png")}
              alt="Game-Servum Commander"
              className="h-7 w-auto"
            />
            <div className="flex items-end gap-2">
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-semibold text-muted-foreground tracking-wide uppercase">
                  Game-Servum
                </span>
                <span className="text-xl font-bold -mt-0.5">Commander</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono hidden md:inline mb-0.5">
                v{APP_VERSION}
              </span>
            </div>
            <div className="h-7 w-px bg-ring/30 hidden md:block" />
            <div className="hidden md:flex">
              <AgentControlPanel onAddAgent={handleAddAgent} />
            </div>
          </>
        }
        right={
          <>
            {/* SteamCMD status indicator */}
            {steamcmd?.installed && (
              <Tip content="Steam Account">
                <Badge
                  variant={steamcmd.loggedIn ? "success" : "secondary"}
                  className={`gap-1.5 ${isConnected ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
                  onClick={() => isConnected && setShowSteamAccount(true)}
                >
                  {steamcmd.loggedIn ? (
                    <>
                      <FaUser className="h-3 w-3" />
                      {steamcmd.username}
                    </>
                  ) : (
                    <>
                      <FaUserSlash className="h-3 w-3" />
                      Anonymous
                    </>
                  )}
                </Badge>
              </Tip>
            )}
            <Tip content="Refresh Data">
              <Button
                onClick={loadData}
                variant="outline"
                size="icon"
                disabled={!isConnected || noAgents}
              >
                <FaArrowsRotate className="h-4 w-4" />
              </Button>
            </Tip>
            <Tip content="Help & Info">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate("/help")}
              >
                <FaCircleQuestion className="h-4 w-4" />
              </Button>
            </Tip>
            <Tip content="Application Logs">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate("/logs")}
              >
                <FaFileLines className="h-4 w-4" />
              </Button>
            </Tip>
            <Tip content="Settings">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate("/settings")}
              >
                <FaGear className="h-4 w-4" />
              </Button>
            </Tip>
          </>
        }
        mobileMenuTitle="Commander"
        mobileMenu={
          <div className="space-y-5">
            {/* Agent section */}
            <MobileAgentSection onAddAgent={handleAddAgent} />

            <div className="border-t" />

            {/* Steam account */}
            {steamcmd?.installed && (
              <button
                data-mobile-nav
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                onClick={() => isConnected && setShowSteamAccount(true)}
                disabled={!isConnected}
              >
                {steamcmd.loggedIn ? (
                  <FaUser className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <FaUserSlash className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {steamcmd.loggedIn ? steamcmd.username : "Anonymous"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Steam Account
                  </div>
                </div>
              </button>
            )}

            {/* Navigation */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">
                Navigation
              </div>
              <button
                data-mobile-nav
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                onClick={loadData}
                disabled={!isConnected || noAgents}
              >
                <FaArrowsRotate className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Refresh Data</span>
              </button>
              <button
                data-mobile-nav
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                onClick={() => navigate("/help")}
              >
                <FaCircleQuestion className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Help & Info</span>
              </button>
              <button
                data-mobile-nav
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                onClick={() => navigate("/logs")}
              >
                <FaFileLines className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Application Logs</span>
              </button>
              <button
                data-mobile-nav
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                onClick={() => navigate("/settings")}
              >
                <FaGear className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Settings</span>
              </button>
            </div>

            {/* Version info */}
            <div className="border-t pt-3">
              <span className="text-[11px] text-muted-foreground/60 font-mono">
                v{APP_VERSION}
              </span>
            </div>
          </div>
        }
      />

      <AgentStatusBanner />

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div
            className={cn("mx-auto w-full px-4 py-4 space-y-8", contentClass)}
          >
            {/* System Monitoring */}
            {monitoringEnabled && !noAgents && (
              <SystemMonitor key={activeConnection?.id} />
            )}

            {/* No agents connected — inline empty state */}
            {noAgents ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-5">
                  <FaPlugCircleXmark className="h-7 w-7 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold mb-2">
                  No Agent Connected
                </h2>
                <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
                  Connect a Game-Servum Agent to start managing your game
                  servers. The agent runs on the machine hosting your servers.
                </p>
                <div className="flex gap-3">
                  <Button onClick={handleAddAgent} size="lg">
                    <FaPlus className="h-4 w-4 mr-2" />
                    Connect Agent
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate("/help")}
                  >
                    <FaCircleQuestion className="h-4 w-4 mr-2" />
                    Learn More
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">Game Servers</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {servers.length === 0
                        ? "No servers installed yet"
                        : `${servers.length} server${servers.length !== 1 ? "s" : ""} configured`}
                    </p>
                  </div>
                  <Button
                    disabled={!steamcmd?.installed || !isConnected}
                    onClick={() => setShowAddServer(true)}
                  >
                    <FaPlus className="h-4 w-4 mr-2" />
                    Add Server
                  </Button>
                </div>

                {servers.length === 0 ? (
                  !isConnected && connections.length > 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="rounded-full bg-muted p-6 mb-4">
                        <FaArrowsRotate className="h-8 w-8 text-muted-foreground animate-spin" />
                      </div>
                      <h3 className="text-lg font-medium mb-1">
                        Waiting for agent connection…
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        The agent is currently unreachable. Server list will
                        load automatically once the connection is restored.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="rounded-full bg-muted p-6 mb-4">
                        <FaPlus className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="text-lg font-medium mb-1">
                        No servers installed
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Get started by adding your first game server. SteamCMD
                        will handle the download and installation.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {servers.map((server) => (
                      <ServerCard
                        key={server.id}
                        server={server}
                        onStart={handleStartServer}
                        onStop={handleStopServer}
                        onDelete={handleDeleteServer}
                        onCancelInstall={handleCancelInstall}
                        disabled={!isConnected}
                        installProgress={installProgress.get(server.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Add Server Dialog */}
      <AddServerDialog
        open={showAddServer}
        onOpenChange={setShowAddServer}
        onServerCreated={loadServers}
        steamcmd={steamcmd}
        onSteamStatusChange={loadSteamCMD}
      />

      {/* Delete Server Confirmation Dialog */}
      <DeleteServerDialog
        server={serverToDelete}
        open={serverToDelete !== null}
        onOpenChange={(open) => !open && setServerToDelete(null)}
        onConfirm={confirmDeleteServer}
      />

      {/* Cancel Installation Confirmation Dialog */}
      <CancelInstallDialog
        server={serverToCancel}
        open={serverToCancel !== null}
        onOpenChange={(open) => !open && setServerToCancel(null)}
        onConfirm={confirmCancelInstall}
      />

      {/* Steam Account Dialog */}
      <SteamAccountDialog
        open={showSteamAccount}
        onOpenChange={setShowSteamAccount}
        steamcmd={steamcmd}
        onStatusChange={loadSteamCMD}
      />
    </div>
  );
}
