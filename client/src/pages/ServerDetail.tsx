import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaPlay,
  FaStop,
  FaArrowsRotate,
  FaGear,
  FaCubes,
  FaUsers,
  FaFileLines,
  FaGauge,
  FaWrench,
  FaSpinner,
  FaTerminal,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "@/components/server/OverviewTab";
import { ConfigTab } from "@/components/server/ConfigTab";
import { ModsTab } from "@/components/server/ModsTab";
import { publicAsset } from "@/lib/assets";
import { PlayersTab } from "@/components/server/PlayersTab";
import { LogsTab } from "@/components/server/LogsTab";
import { SettingsTab } from "@/components/server/SettingsTab";
import { useBackend } from "@/hooks/useBackend";
import { useGameCapabilities } from "@/hooks/useGameCapabilities";
import { AgentControlPanel } from "@/components/agent/AgentControlPanel";
import { AppHeader } from "@/components/AppHeader";
import { AgentStatusBanner } from "@/components/AgentStatusBanner";
import {
  toastSuccess,
  toastError,
  toastInfo,
  showDependencyError,
} from "@/lib/toast";
import type { GameServer } from "@/types";

const statusConfig = {
  stopped: { label: "Stopped", variant: "secondary" as const },
  starting: { label: "Starting", variant: "warning" as const },
  running: { label: "Running", variant: "success" as const },
  stopping: { label: "Stopping", variant: "warning" as const },
  queued: { label: "Queued", variant: "secondary" as const },
  installing: { label: "Installing", variant: "warning" as const },
  updating: { label: "Updating", variant: "warning" as const },
  error: { label: "Error", variant: "destructive" as const },
};

const validTabs = ["overview", "config", "mods", "players", "logs", "settings"];

export function ServerDetail() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [server, setServer] = useState<GameServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [installProgress, setInstallProgress] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const { capabilities } = useGameCapabilities(server?.gameId ?? "");
  const hasPlayers = capabilities?.playerTracking !== false;
  const terminalRef = useRef<HTMLDivElement>(null);

  const { api, subscribe, isConnected, activeConnection } = useBackend();

  const loadServer = useCallback(
    async (showToast = false) => {
      if (!id) return;
      try {
        const data = await api.servers.getById(Number(id));
        setServer(data);
        setError(null);
        if (showToast) {
          toastSuccess("Server data refreshed");
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [id, api],
  );

  // Load server data (wait for connection)
  useEffect(() => {
    if (id && isConnected) {
      loadServer();
    }
  }, [id, loadServer, isConnected]);

  // Reload data when connection is (re-)established
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !prevConnected.current && id) {
      console.log("[ServerDetail] Connection restored, reloading data...");
      loadServer();
    }
    prevConnected.current = isConnected;
  }, [isConnected, id, loadServer]);

  // Redirect to dashboard when agent is switched on server detail page
  const initialAgentId = useRef(activeConnection?.id);
  useEffect(() => {
    // Store initial agent ID on first mount
    if (initialAgentId.current === undefined && activeConnection?.id) {
      initialAgentId.current = activeConnection.id;
      return;
    }

    // Redirect to dashboard if active agent changed
    if (
      activeConnection?.id &&
      initialAgentId.current !== activeConnection.id
    ) {
      console.log("[ServerDetail] Agent switched, redirecting to dashboard...");
      toastInfo("Agent switched - returning to dashboard");
      navigate("/");
    }
  }, [activeConnection?.id, navigate]);

  // Redirect to Dashboard when agent is not connected.
  // ServerDetail requires a live agent connection — all data and actions
  // depend on it.  When the agent restarts, updates, or drops, we redirect
  // so the Dashboard (with AgentStatusBanner) handles the reconnect UX.
  // Skip undefined status (initial state before BackendContext authenticates)
  // and "authenticating" (connection handshake in progress).
  useEffect(() => {
    if (
      activeConnection?.status &&
      activeConnection.status !== "connected" &&
      activeConnection.status !== "authenticating"
    ) {
      navigate("/", { replace: true });
    }
  }, [activeConnection?.status, navigate]);

  // Subscribe to server status updates and installation progress
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "server:status") {
        const payload = message.payload as {
          serverId: number;
          status: string;
          message?: string;
        };
        if (payload.serverId === Number(id)) {
          // Show error if server failed to start
          if (payload.status === "error" && payload.message) {
            showDependencyError(payload.message);
          }
          loadServer();
        }
      }
      if (message.type === "install:progress") {
        const payload = message.payload as {
          serverId: number;
          message: string;
        };
        if (payload.serverId === Number(id)) {
          setInstallProgress(payload.message);
        }
      }
      if (message.type === "steamcmd:output") {
        const payload = message.payload as {
          message: string;
          serverId: number;
        };
        if (payload.message && payload.serverId === Number(id)) {
          setTerminalOutput((prev) => [...prev.slice(-200), payload.message]);
        }
      }
      if (message.type === "install:complete") {
        const payload = message.payload as {
          serverId: number;
          success: boolean;
          message: string;
        };
        if (payload.serverId === Number(id)) {
          if (payload.success) {
            toastSuccess("Installation complete");
          } else {
            toastError(payload.message || "Installation failed");
          }
          setInstallProgress("");
          setTerminalOutput([]);
          loadServer();
        }
      }
      if (message.type === "install:error") {
        const payload = message.payload as {
          serverId: number;
          message: string;
        };
        if (payload.serverId === Number(id)) {
          toastError(payload.message || "Installation failed");
          setInstallProgress("");
          loadServer();
        }
      }
    });
    return unsubscribe;
  }, [subscribe, id, loadServer]);

  async function handleStart() {
    if (!server) return;
    setActionLoading(true);
    try {
      await api.servers.start(server.id);
      toastSuccess(`${server.name} is starting...`);
      await loadServer();
    } catch (err) {
      const errorMessage = (err as Error).message;
      showDependencyError(errorMessage);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    if (!server) return;
    setActionLoading(true);
    try {
      await api.servers.stop(server.id);
      toastSuccess(`${server.name} stopped`);
      await loadServer();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  // Auto-scroll terminal during installation
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  if (loading && !server) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <FaArrowsRotate className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <AppHeader
          left={
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <FaArrowLeft className="h-4 w-4 mr-2" />
              <img
                src={publicAsset("dashboard-icon.png")}
                alt=""
                className="h-7 w-auto mr-1"
              />
            </Button>
          }
          right={<AgentControlPanel />}
        />
        <AgentStatusBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto px-4 py-8">
            <div className="text-center text-destructive">
              {error || "Server not found"}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const status = statusConfig[server.status];
  const isRunning = server.status === "running";
  const isBusy =
    server.status === "queued" ||
    server.status === "installing" ||
    server.status === "updating" ||
    server.status === "starting" ||
    server.status === "stopping";

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <AppHeader
        left={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <FaArrowLeft className="h-4 w-4 mr-2" />
              <img
                src={publicAsset("dashboard-icon.png")}
                alt=""
                className="h-7 w-auto mr-1"
              />
            </Button>
            <div className="h-7 w-px bg-ring/30" />
            <AgentControlPanel />
          </>
        }
        right={
          <>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">{server.name}</h1>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            {isRunning ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStop}
                disabled={actionLoading || !isConnected}
              >
                <FaStop className="h-4 w-4 mr-2" />
                Stop Server
              </Button>
            ) : (
              <Button
                variant="success"
                size="sm"
                onClick={handleStart}
                disabled={actionLoading || isBusy || !isConnected}
              >
                <FaPlay className="h-4 w-4 mr-2" />
                Start Server
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadServer(true)}
              disabled={actionLoading || !isConnected}
            >
              <FaArrowsRotate className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <AgentStatusBanner />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-6">
          {server.status === "queued" ? (
            /* ── Queued View ── */
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="rounded-xl border bg-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <FaSpinner className="h-5 w-5 text-muted-foreground animate-spin" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">
                      Queued — {server.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Waiting for the current installation to finish.
                      Installation will start automatically.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : server.status === "installing" ? (
            /* ── Installation Progress View ── */
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="rounded-xl border bg-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
                    <FaSpinner className="h-5 w-5 text-warning animate-spin" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">
                      Installing {server.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {installProgress ||
                        "Starting installation via SteamCMD..."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-6 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <FaTerminal className="h-4 w-4" />
                  Installation Output
                </div>
                <div
                  ref={terminalRef}
                  className="bg-terminal rounded-lg p-4 h-[400px] overflow-y-auto font-mono text-xs text-green-400"
                >
                  {terminalOutput.length === 0 ? (
                    <span className="text-muted-foreground">
                      Waiting for output...
                    </span>
                  ) : (
                    terminalOutput.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Normal Tab View ── */
            <Tabs
              value={validTabs.includes(tab ?? "") ? tab : "overview"}
              onValueChange={(value) =>
                navigate(`/server/${id}/${value}`, { replace: true })
              }
              className="space-y-6"
            >
              <TabsList
                className={`grid w-full ${hasPlayers ? "grid-cols-6" : "grid-cols-5"}`}
              >
                <TabsTrigger value="overview" className="gap-2">
                  <FaGauge className="h-4 w-4 text-ring/70" />
                  <span className="hidden sm:inline">Overview</span>
                </TabsTrigger>
                <TabsTrigger value="config" className="gap-2">
                  <FaGear className="h-4 w-4 text-ring/70" />
                  <span className="hidden sm:inline">Configuration</span>
                </TabsTrigger>
                <TabsTrigger value="mods" className="gap-2">
                  <FaCubes className="h-4 w-4 text-ring/70" />
                  <span className="hidden sm:inline">Mods</span>
                </TabsTrigger>
                {hasPlayers && (
                  <TabsTrigger value="players" className="gap-2">
                    <FaUsers className="h-4 w-4 text-ring/70" />
                    <span className="hidden sm:inline">Players</span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="logs" className="gap-2">
                  <FaFileLines className="h-4 w-4 text-ring/70" />
                  <span className="hidden sm:inline">Logs</span>
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-2">
                  <FaWrench className="h-4 w-4 text-ring/70" />
                  <span className="hidden sm:inline">Settings</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <OverviewTab server={server} onRefresh={loadServer} />
              </TabsContent>

              <TabsContent value="config">
                <ConfigTab server={server} />
              </TabsContent>

              <TabsContent value="mods">
                <ModsTab server={server} />
              </TabsContent>

              {hasPlayers && (
                <TabsContent value="players">
                  <PlayersTab server={server} />
                </TabsContent>
              )}

              <TabsContent value="logs">
                <LogsTab server={server} />
              </TabsContent>

              <TabsContent value="settings">
                <SettingsTab server={server} onRefresh={loadServer} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </main>
    </div>
  );
}
