import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FaPlus,
  FaArrowsRotate,
  FaArrowUpRightFromSquare,
  FaHeart,
  FaGlobe,
  FaGithub,
  FaGear,
  FaUser,
  FaUserSlash,
  FaCircleInfo,
  FaPlugCircleXmark,
  FaFileLines,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ServerCard } from "@/components/server-details/ServerCard";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import {
  isOnboardingComplete,
  resetOnboarding,
} from "@/components/onboarding/onboardingState";
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
import { AppHeader } from "@/components/AppHeader";
import { publicAsset } from "@/lib/assets";
import { toastSuccess, toastError, showDependencyError } from "@/lib/toast";
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
  const [showOnboarding, setShowOnboarding] = useState(
    () => !isOnboardingComplete(),
  );
  const [showAddServer, setShowAddServer] = useState(false);
  const [showSteamAccount, setShowSteamAccount] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showNoAgents, setShowNoAgents] = useState(false);
  const [onboardingInitialStep, setOnboardingInitialStep] = useState<
    "connect" | undefined
  >(undefined);
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

  // Fetch initial data (skip during onboarding and before connection is ready)
  // Also skip if we already have cached data — it will be refreshed once connected
  const hasData = servers.length > 0 || steamcmd !== null;
  useEffect(() => {
    if (!showOnboarding && isConnected) {
      loadData();
    }
  }, [loadData, showOnboarding, isConnected]);

  // Reload data when connection is (re-)established
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !prevConnected.current && !showOnboarding) {
      // Connection just came back — reload everything
      logger.info("[Dashboard] Connection restored, reloading data...");
      loadData();
    }
    prevConnected.current = isConnected;
  }, [isConnected, loadData, showOnboarding]);

  // When all agents are removed, show intermediate screen
  useEffect(() => {
    if (connections.length === 0 && !showOnboarding) {
      setShowNoAgents(true);
      // Clear stale dashboard state
      setServers([]);
      setSteamcmd(null);
      setLoading(true);
    } else {
      setShowNoAgents(false);
    }
  }, [connections.length, showOnboarding]);

  // Handle ?setup= query param to re-open onboarding
  useEffect(() => {
    const setupStep = searchParams.get("setup");
    if (setupStep) {
      setShowOnboarding(true);
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

  async function confirmDeleteServer(server: GameServer) {
    try {
      await api.servers.delete(server.id, server.name);
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

  // No agents connected — show intermediate screen before onboarding
  if (showNoAgents) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="w-full max-w-sm mx-4 rounded-xl border bg-card p-8 shadow-lg text-center space-y-4 animate-in fade-in-0 zoom-in-95 duration-200">
          <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <FaPlugCircleXmark className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">No Agent Connected</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              There are no agents configured. Connect an agent to start managing
              your game servers.
            </p>
          </div>
          <Button
            className="w-full"
            onClick={() => {
              resetOnboarding();
              setShowNoAgents(false);
              setOnboardingInitialStep("connect");
              setShowOnboarding(true);
            }}
          >
            Connect Agent
          </Button>
        </div>
      </div>
    );
  }

  // Show onboarding wizard for first-time users
  if (showOnboarding) {
    return (
      <OnboardingWizard
        initialStep={onboardingInitialStep}
        onComplete={() => {
          setShowOnboarding(false);
          setOnboardingInitialStep(undefined);
          setSearchParams({}, { replace: true });
          loadData();
        }}
      />
    );
  }

  if (loading && !hasData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <FaArrowsRotate className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <AppHeader
        left={
          <>
            <img
              src={publicAsset("dashboard-icon.png")}
              alt="Game-Servum"
              className="h-7 w-auto"
            />
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold">Game-Servum</h1>
              <span className="text-xs text-muted-foreground font-mono">
                v{APP_VERSION}
              </span>
            </div>
            <div className="h-7 w-px bg-border" />
            <AgentControlPanel />
          </>
        }
        right={
          <>
            {/* SteamCMD status indicator */}
            {steamcmd?.installed && (
              <Badge
                variant={steamcmd.loggedIn ? "success" : "secondary"}
                className={`gap-1.5 ${isConnected ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
                onClick={() => isConnected && setShowSteamAccount(true)}
                title="Steam Account"
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
            )}
            <Button
              onClick={loadData}
              variant="outline"
              size="icon"
              title="Refresh Data"
              disabled={!isConnected}
            >
              <FaArrowsRotate className="h-4 w-4" />
            </Button>
            <div className="relative">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowInfo(!showInfo)}
                title="About Game-Servum"
              >
                <FaCircleInfo className="h-4 w-4" />
              </Button>
              {showInfo && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowInfo(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-lg border bg-popover p-4 shadow-lg animate-in fade-in-0 zoom-in-95">
                    <div className="flex items-center gap-2.5 mb-3">
                      <img
                        src={publicAsset("dashboard-icon.png")}
                        alt=""
                        className="h-6 w-auto"
                      />
                      <div>
                        <p className="text-sm font-semibold leading-tight">
                          Game-Servum
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          v{APP_VERSION}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                      Open Source Game Server Manager powered by SteamCMD.
                    </p>
                    <div className="border-t border-border/50 pt-2.5 space-y-0.5">
                      <a
                        href="https://github.com/xscr33m/Game-Servum"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <FaGithub className="h-3.5 w-3.5" />
                        GitHub
                        <FaArrowUpRightFromSquare className="h-2.5 w-2.5 ml-auto opacity-40" />
                      </a>
                      <a
                        href="https://xscr33mlabs.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <FaGlobe className="h-3.5 w-3.5" />
                        Website
                        <FaArrowUpRightFromSquare className="h-2.5 w-2.5 ml-auto opacity-40" />
                      </a>
                      <a
                        href="https://ko-fi.com/xscr33m"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <FaHeart className="h-3.5 w-3.5" />
                        Donate
                        <FaArrowUpRightFromSquare className="h-2.5 w-2.5 ml-auto opacity-40" />
                      </a>
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate("/logs")}
              title="Application Logs"
            >
              <FaFileLines className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate("/settings")}
              title="Settings"
            >
              <FaGear className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <AgentStatusBanner />

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 py-4 space-y-8">
            {/* System Monitoring */}
            {monitoringEnabled && <SystemMonitor key={activeConnection?.id} />}

            {/* Servers */}
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
                      The agent is currently unreachable. Server list will load
                      automatically once the connection is restored.
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
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
