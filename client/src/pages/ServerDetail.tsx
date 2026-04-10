import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  useContext,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaPlay,
  FaStop,
  FaArrowsRotate,
  FaSpinner,
  FaTerminal,
  FaTrashCan,
  FaXmark,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useContentWidth } from "@/hooks/useContentWidth";
import { OverviewTab } from "@/components/server-details/OverviewTab";
import { ConfigTab } from "@/components/server-details/ConfigTab";
import { ModsTab } from "@/components/server-details/ModsTab";
import { publicAsset } from "@/lib/assets";
import { PlayersTab } from "@/components/server-details/PlayersTab";
import { LogsTab } from "@/components/server-details/LogsTab";
import { SettingsTab } from "@/components/server-details/SettingsTab";
import { BackupsTab } from "@/components/server-details/BackupsTab";
import { FilesTab } from "@/components/server-details/FilesTab";
import { ServerDetailSidebar } from "@/components/server-details/ServerDetailSidebar";
import type { ServerSection } from "@/components/server-details/ServerDetailSidebar";
import { useBackend } from "@/hooks/useBackend";
import { useGameCapabilities } from "@/hooks/useGameCapabilities";
import { UnsavedChangesContext } from "@/contexts/UnsavedChangesContextDef";
import { AgentControlPanel } from "@/components/agent/AgentControlPanel";
import { MobileAgentSection } from "@/components/agent/MobileAgentSection";
import { AppHeader } from "@/components/AppHeader";
import { AgentStatusBanner } from "@/components/agent/AgentStatusBanner";
import { DeleteServerDialog } from "@/components/server-details/dialogs/DeleteServerDialog";
import { CancelInstallDialog } from "@/components/server-details/dialogs/CancelInstallDialog";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
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
  installing: { label: "Installing", variant: "success" as const },
  updating: { label: "Updating", variant: "warning" as const },
  deleting: { label: "Deleting", variant: "destructive" as const },
  error: { label: "Error", variant: "destructive" as const },
};

const validSections: ServerSection[] = [
  "overview",
  "config",
  "files",
  "mods",
  "players",
  "logs",
  "backups",
  "settings",
];

export function ServerDetail() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { contentClass } = useContentWidth();
  const [server, setServer] = useState<GameServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [installProgress, setInstallProgress] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const { capabilities } = useGameCapabilities(server?.gameId ?? "");
  const hasPlayers = capabilities?.playerTracking !== false;
  // Track whether files tab has ever been visited to keep it mounted
  const filesTabVisited = useRef(false);

  // Sidebar navigation
  const activeSection: ServerSection = validSections.includes(
    tab as ServerSection,
  )
    ? (tab as ServerSection)
    : "overview";
  const hiddenSections = useMemo(
    () => (hasPlayers ? undefined : new Set(["players"])),
    [hasPlayers],
  );

  // Keep FilesTab mounted once it has been visited to preserve its state
  if (activeSection === "files") {
    filesTabVisited.current = true;
  }
  const showFilesTab = filesTabVisited.current;

  const terminalRef = useRef<HTMLDivElement>(null);
  const hasFetchedInstallOutput = useRef(false);

  const unsavedCtx = useContext(UnsavedChangesContext);
  const { api, subscribe, isConnected, activeConnection, connections } =
    useBackend();

  function handleSectionChange(section: ServerSection) {
    unsavedCtx?.requestNavigation(() =>
      navigate(`/server/${id}/${section}`, { replace: true }),
    );
  }

  // Redirect to home when no agents are configured
  useEffect(() => {
    if (connections.length === 0) {
      navigate("/", { replace: true });
    }
  }, [connections.length, navigate]);

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

  // Load server data (wait for connection) — also refresh on tab switch
  // so that changes made in one tab (e.g. Config → launch params) are
  // reflected when navigating to another tab (e.g. Overview).
  useEffect(() => {
    if (id && isConnected) {
      loadServer();
    }
  }, [id, tab, loadServer, isConnected]);

  // Reload data when connection is (re-)established
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !prevConnected.current && id) {
      console.log("[ServerDetail] Connection restored, reloading data...");
      loadServer();
    }
    prevConnected.current = isConnected;
  }, [isConnected, id, loadServer]);

  // Redirect to home when agent is switched on server detail page
  const initialAgentId = useRef(activeConnection?.id);

  // Fetch buffered installation output when opening page during an active install
  const serverStatus = server?.status;
  const serverId = server?.id;
  useEffect(() => {
    if (
      serverStatus === "installing" &&
      serverId &&
      !hasFetchedInstallOutput.current &&
      isConnected
    ) {
      hasFetchedInstallOutput.current = true;
      api.servers
        .getInstallStatus(serverId)
        .then((data) => {
          if (data.installing) {
            if (data.output.length > 0) {
              setTerminalOutput(data.output);
            }
            if (data.message) {
              setInstallProgress(data.message);
            }
          }
        })
        .catch(() => {
          // Non-critical — live WS will still deliver updates
        });
    }
    // Reset the flag when server stops installing so a future install can fetch again
    if (serverStatus && serverStatus !== "installing") {
      hasFetchedInstallOutput.current = false;
    }
  }, [serverStatus, serverId, isConnected, api.servers]);

  useEffect(() => {
    // Store initial agent ID on first mount
    if (initialAgentId.current === undefined && activeConnection?.id) {
      initialAgentId.current = activeConnection.id;
      return;
    }

    // Redirect to home if active agent changed
    if (
      activeConnection?.id &&
      initialAgentId.current !== activeConnection.id
    ) {
      console.log("[ServerDetail] Agent switched, redirecting to home...");
      toastInfo("Agent switched - returning to home");
      navigate("/");
    }
  }, [activeConnection?.id, navigate]);

  // Redirect to home when agent is not connected.
  // ServerDetail requires a live agent connection — all data and actions
  // depend on it.  When the agent restarts, updates, or drops, we redirect
  // so the home page (with AgentStatusBanner) handles the reconnect UX.
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
      if (message.type === "server:deleted") {
        const payload = message.payload as { serverId: number };
        if (payload.serverId === Number(id)) {
          toastInfo("Server has been deleted");
          navigate("/", { replace: true });
        }
      }
    });
    return unsubscribe;
  }, [subscribe, id, loadServer, navigate]);

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

  async function confirmDeleteServer(
    serverToDelete: GameServer,
    deleteBackups: boolean,
  ) {
    try {
      await api.servers.delete(
        serverToDelete.id,
        serverToDelete.name,
        deleteBackups,
      );
      toastSuccess(`${serverToDelete.name} is being deleted...`);
      await loadServer();
    } catch (err) {
      toastError((err as Error).message);
      throw err;
    }
  }

  async function confirmCancelInstall(serverToCancel: GameServer) {
    try {
      await api.servers.cancelInstall(serverToCancel.id);
      toastSuccess(`Cancelling installation of ${serverToCancel.name}...`);
      // server:status WS event updates to "deleting",
      // server:deleted WS event will navigate to home
      await loadServer();
    } catch (err) {
      toastError((err as Error).message);
      throw err;
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
                src={publicAsset("commander-icon.png")}
                alt=""
                className="h-7 w-auto mr-1"
              />
            </Button>
          }
          right={<AgentControlPanel />}
          mobileMenu={
            <div className="space-y-5">
              <MobileAgentSection />
            </div>
          }
        />
        <AgentStatusBanner />
        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
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
    server.status === "stopping" ||
    server.status === "deleting";

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <AppHeader
        left={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <FaArrowLeft className="h-4 w-4 mr-2" />
              <img
                src={publicAsset("commander-icon.png")}
                alt=""
                className="h-7 w-auto mr-1"
              />
            </Button>
            <div className="h-7 w-px bg-ring/30 hidden md:block" />
            <div className="hidden md:flex">
              <AgentControlPanel />
            </div>
            {/* Mobile: show server name + status inline */}
            <div className="flex items-center gap-2 md:hidden min-w-0">
              <h1 className="text-sm font-bold truncate">{server.name}</h1>
              <Badge
                variant={status.variant}
                className="text-[10px] px-1.5 shrink-0"
              >
                {status.label}
              </Badge>
            </div>
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
            {server.status === "installing" || server.status === "queued" ? (
              <Tip content="Cancel Installation">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setShowCancelDialog(true)}
                  disabled={!isConnected}
                >
                  <FaXmark className="h-4 w-4" />
                </Button>
              </Tip>
            ) : (
              <Tip content="Delete Server">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isRunning || isBusy || !isConnected}
                >
                  <FaTrashCan className="h-4 w-4" />
                </Button>
              </Tip>
            )}
          </>
        }
        mobileMenuTitle={server.name}
        mobileMenu={
          <div className="space-y-5">
            {/* Server info */}
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold truncate flex-1">
                  {server.name}
                </h2>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            </div>

            {/* Server actions */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">
                Actions
              </div>
              {isRunning ? (
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={handleStop}
                  disabled={actionLoading || !isConnected}
                >
                  <FaStop className="h-4 w-4 mr-2" />
                  Stop Server
                </Button>
              ) : (
                <Button
                  variant="success"
                  className="w-full justify-start"
                  onClick={handleStart}
                  disabled={actionLoading || isBusy || !isConnected}
                >
                  <FaPlay className="h-4 w-4 mr-2" />
                  Start Server
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => loadServer(true)}
                disabled={actionLoading || !isConnected}
              >
                <FaArrowsRotate className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              {server.status === "installing" || server.status === "queued" ? (
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:text-destructive"
                  onClick={() => setShowCancelDialog(true)}
                  disabled={!isConnected}
                >
                  <FaXmark className="h-4 w-4 mr-2" />
                  Cancel Installation
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isRunning || isBusy || !isConnected}
                >
                  <FaTrashCan className="h-4 w-4 mr-2" />
                  Delete Server
                </Button>
              )}
            </div>

            <div className="border-t" />

            {/* Agent section */}
            <MobileAgentSection />
          </div>
        }
      />

      <AgentStatusBanner />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {server.status === "queued" ? (
          /* ── Queued View ── */
          <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className="container mx-auto px-4 py-6">
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
            </div>
          </div>
        ) : server.status === "installing" ? (
          /* ── Installation Progress View ── */
          <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className="container mx-auto px-4 py-6">
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
            </div>
          </div>
        ) : (
          /* ── Normal Sidebar + Content View ── */
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
            <ServerDetailSidebar
              active={activeSection}
              onChange={handleSectionChange}
              hiddenSections={hiddenSections}
              gameId={server.gameId}
            />
            <div
              className={`flex-1 min-w-0 min-h-0 [scrollbar-gutter:stable] ${activeSection === "config" || activeSection === "files" || activeSection === "players" || activeSection === "logs" ? "flex flex-col" : "overflow-y-auto"}`}
            >
              {activeSection === "config" && (
                <ConfigTab server={server} onRefresh={loadServer} />
              )}
              {showFilesTab && (
                <div
                  className={
                    activeSection === "files"
                      ? "flex flex-col flex-1 min-h-0"
                      : "hidden"
                  }
                >
                  <FilesTab server={server} />
                </div>
              )}
              {activeSection === "players" && hasPlayers && (
                <PlayersTab server={server} />
              )}
              {activeSection === "logs" && <LogsTab server={server} />}
              {activeSection !== "config" &&
                activeSection !== "files" &&
                activeSection !== "players" &&
                activeSection !== "logs" && (
                  <div
                    className={cn(
                      "px-4 pt-4 pb-6 min-h-full flex flex-col",
                      contentClass,
                    )}
                  >
                    {activeSection === "overview" && (
                      <OverviewTab server={server} onRefresh={loadServer} />
                    )}
                    {activeSection === "mods" && <ModsTab server={server} />}
                    {activeSection === "backups" && (
                      <BackupsTab server={server} />
                    )}
                    {activeSection === "settings" && (
                      <SettingsTab server={server} onRefresh={loadServer} />
                    )}
                  </div>
                )}
            </div>
          </div>
        )}
      </main>

      <DeleteServerDialog
        server={server}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={confirmDeleteServer}
      />

      <CancelInstallDialog
        server={server}
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        onConfirm={confirmCancelInstall}
      />
    </div>
  );
}
