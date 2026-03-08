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

  // Subscribe to server status updates
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

      {/* Main Content with Tabs */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-6">
          <Tabs
            value={validTabs.includes(tab ?? "") ? tab : "overview"}
            onValueChange={(value) =>
              navigate(`/server/${id}/${value}`, { replace: true })
            }
            className="space-y-6"
          >
            <TabsList className="grid w-full grid-cols-6">
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
              <TabsTrigger value="players" className="gap-2">
                <FaUsers className="h-4 w-4 text-ring/70" />
                <span className="hidden sm:inline">Players</span>
              </TabsTrigger>
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

            <TabsContent value="players">
              <PlayersTab server={server} />
            </TabsContent>

            <TabsContent value="logs">
              <LogsTab server={server} />
            </TabsContent>

            <TabsContent value="settings">
              <SettingsTab server={server} onRefresh={loadServer} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
