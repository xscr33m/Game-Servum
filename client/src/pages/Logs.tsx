import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaSpinner,
  FaDownload,
  FaTrash,
  FaRotate,
  FaMagnifyingGlass,
  FaGear,
  FaCircleInfo,
  FaServer,
  FaDesktop,
  FaCircle,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useBackend } from "@/hooks/useBackend";
import { publicAsset } from "@/lib/assets";
import { AppHeader } from "@/components/AppHeader";
import { toastSuccess, toastError } from "@/lib/toast";
import { logger } from "@/lib/logger";
import { LogLevel } from "@game-servum/shared";
import type { LoggerSettings } from "@game-servum/shared";

const STATUS_COLORS = {
  connected: "text-green-500",
  authenticating: "text-yellow-500",
  reconnecting: "text-yellow-500",
  disconnected: "text-red-400",
  error: "text-red-500",
} as const;

interface LogFile {
  name: string;
  size: number;
  modified: string;
}

interface LogViewerState {
  files: LogFile[];
  selectedFile: string | null;
  content: string;
  loading: boolean;
  settings: LoggerSettings;
}

export function Logs() {
  const navigate = useNavigate();
  const { api, connections, activeConnection } = useBackend();

  // Active agent/dashboard selection
  const [activeTab, setActiveTab] = useState<string>("dashboard");

  // Per-agent log viewer state
  const [logStates, setLogStates] = useState<Record<string, LogViewerState>>(
    {},
  );

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Get current active log state
  const currentLogs = logStates[activeTab] || {
    files: [],
    selectedFile: null,
    content: "",
    loading: false,
    settings: {
      enabled: true,
      minLevel: LogLevel.INFO,
      retentionDays: 30,
      maxFileSizeMB: 50,
      writeToConsole: false,
      includeStackTrace: true,
    },
  };

  // Load log files for an agent or dashboard
  const loadLogFiles = useCallback(
    async (agentId: string) => {
      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (!electronLogs) {
          logger.debug("[Logs] No Electron logs API available");
          return;
        }

        setLogStates((prev) => ({
          ...prev,
          [agentId]: { ...(prev[agentId] || {}), loading: true },
        }));

        try {
          const response = await electronLogs.listFiles();
          if (response.success) {
            const files = response.files;
            const mostRecent = files.length > 0 ? files[0].name : null;

            setLogStates((prev) => ({
              ...prev,
              [agentId]: {
                ...(prev[agentId] || {}),
                files,
                selectedFile: mostRecent,
                loading: false,
              },
            }));

            // Load content of most recent file
            if (mostRecent) {
              const contentRes = await electronLogs.getFileContent(mostRecent, {
                lines: 1000,
              });
              if (contentRes.success) {
                setLogStates((prev) => ({
                  ...prev,
                  [agentId]: {
                    ...(prev[agentId] || {}),
                    content: contentRes.content,
                  },
                }));
              }
            }
          }
        } catch (err) {
          logger.error("[Logs] Failed to load local log files:", err);
          setLogStates((prev) => ({
            ...prev,
            [agentId]: { ...(prev[agentId] || {}), loading: false },
          }));
        }
        return;
      }

      // For agents: check connection status
      const connection = connections.find((c) => c.id === agentId);
      if (!connection || connection.status !== "connected") {
        logger.debug(
          `[Logs] Skipping load for ${agentId} - connection not ready`,
        );
        return;
      }

      setLogStates((prev) => ({
        ...prev,
        [agentId]: { ...(prev[agentId] || {}), loading: true },
      }));

      try {
        const response = await api.logs.listFiles();
        if (response.success) {
          const files = response.files;
          const mostRecent = files.length > 0 ? files[0].name : null;

          setLogStates((prev) => ({
            ...prev,
            [agentId]: {
              ...(prev[agentId] || {}),
              files,
              selectedFile: mostRecent,
              loading: false,
            },
          }));

          // Load content of most recent file
          if (mostRecent) {
            await loadLogContent(agentId, mostRecent);
          }
        }
      } catch (err) {
        logger.error(`[Logs] Failed to load log files for ${agentId}:`, err);
        toastError("Failed to load log files");
        setLogStates((prev) => ({
          ...prev,
          [agentId]: { ...(prev[agentId] || {}), loading: false },
        }));
      }
    },
    // loadLogContent is called inside but doesn't need to be a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.logs, connections],
  );

  // Load log file content
  const loadLogContent = useCallback(
    async (agentId: string, filename: string) => {
      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (!electronLogs) return;

        try {
          const response = await electronLogs.getFileContent(filename, {
            lines: 1000,
          });
          if (response.success) {
            setLogStates((prev) => ({
              ...prev,
              [agentId]: {
                ...(prev[agentId] || {}),
                content: response.content,
                loading: false,
              },
            }));
          }
        } catch (err) {
          logger.error("[Logs] Failed to load local log content:", err);
        }
        return;
      }

      // For agents: use REST API
      setLogStates((prev) => ({
        ...prev,
        [agentId]: { ...(prev[agentId] || {}), loading: true },
      }));

      try {
        const response = await api.logs.getFileContent(filename, {
          lines: 1000,
          tail: true,
        });
        if (response.success) {
          setLogStates((prev) => ({
            ...prev,
            [agentId]: {
              ...(prev[agentId] || {}),
              content: response.content,
              loading: false,
            },
          }));
        }
      } catch (err) {
        logger.error(`[Logs] Failed to load log content for ${agentId}:`, err);
        toastError("Failed to load log content");
        setLogStates((prev) => ({
          ...prev,
          [agentId]: { ...(prev[agentId] || {}), loading: false },
        }));
      }
    },
    [api.logs],
  );

  // Load log settings for an agent or dashboard
  const loadLogSettings = useCallback(
    async (agentId: string) => {
      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (!electronLogs) return;

        try {
          const response = await electronLogs.getSettings();
          if (response.success) {
            setLogStates((prev) => ({
              ...prev,
              [agentId]: {
                ...(prev[agentId] || {}),
                settings: response.settings,
              },
            }));
          }
        } catch (err) {
          logger.error("[Logs] Failed to load local log settings:", err);
        }
        return;
      }

      // For agents: check connection status
      const connection = connections.find((c) => c.id === agentId);
      if (!connection || connection.status !== "connected") {
        logger.debug(
          `[Logs] Skipping settings load for ${agentId} - connection not ready`,
        );
        return;
      }

      try {
        const response = await api.logs.getSettings();
        if (response.success) {
          setLogStates((prev) => ({
            ...prev,
            [agentId]: {
              ...(prev[agentId] || {}),
              settings: response.settings,
            },
          }));
        }
      } catch (err) {
        logger.error(`[Logs] Failed to load log settings for ${agentId}:`, err);
      }
    },
    [api.logs, connections],
  );

  // Initialize log states for all agents/dashboard - only on mount
  useEffect(() => {
    const initialStates: Record<string, LogViewerState> = {};

    // Always include dashboard
    initialStates["dashboard"] = {
      files: [],
      selectedFile: null,
      content: "",
      loading: false,
      settings: {
        enabled: true,
        minLevel: LogLevel.INFO,
        retentionDays: 30,
        maxFileSizeMB: 50,
        writeToConsole: false,
        includeStackTrace: true,
      },
    };

    // Add connected agents
    connections.forEach((conn) => {
      initialStates[conn.id] = {
        files: [],
        selectedFile: null,
        content: "",
        loading: false,
        settings: {
          enabled: true,
          minLevel: LogLevel.INFO,
          retentionDays: 30,
          maxFileSizeMB: 50,
          writeToConsole: false,
          includeStackTrace: true,
        },
      };
    });

    setLogStates(initialStates);

    // Set active tab to current connection if available
    if (activeConnection) {
      setActiveTab(activeConnection.id);
    }
    // Only run on mount - connections array reference changes shouldn't re-initialize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load data when active tab changes - only trigger on tab change
  const [hasLoadedTab, setHasLoadedTab] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Skip if already loaded this tab
    if (hasLoadedTab.has(activeTab)) return;

    // For dashboard tab: Always load (local Electron IPC)
    if (activeTab === "dashboard") {
      setHasLoadedTab((prev) => new Set(prev).add(activeTab));
      loadLogFiles(activeTab);
      loadLogSettings(activeTab);
      return;
    }

    // For agent tabs: Only load if connected AND token is available
    const connection = connections.find((c) => c.id === activeTab);
    if (
      connection &&
      connection.status === "connected" &&
      connection.sessionToken
    ) {
      setHasLoadedTab((prev) => new Set(prev).add(activeTab));
      loadLogFiles(activeTab);
      loadLogSettings(activeTab);
    }
    // Only depend on activeTab and connection status, not on callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connections]);

  // Handle settings update
  async function handleUpdateSettings(
    agentId: string,
    updates: Partial<LoggerSettings>,
  ) {
    setSavingSettings(true);
    try {
      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (electronLogs) {
          const response = await electronLogs.updateSettings(updates);
          if (response.success) {
            setLogStates((prev) => ({
              ...prev,
              [agentId]: {
                ...(prev[agentId] || {}),
                settings: { ...(prev[agentId]?.settings || {}), ...updates },
              },
            }));
            toastSuccess("Log settings updated");
          }
        }
        setSavingSettings(false);
        return;
      }

      // For agents: use REST API
      const response = await api.logs.updateSettings(updates);
      if (response.success) {
        setLogStates((prev) => ({
          ...prev,
          [agentId]: {
            ...(prev[agentId] || {}),
            settings: { ...(prev[agentId]?.settings || {}), ...updates },
          },
        }));
        toastSuccess("Log settings updated");
      }
    } catch (err) {
      logger.error("[Logs] Failed to update settings:", err);
      toastError("Failed to update settings");
    } finally {
      setSavingSettings(false);
    }
  }

  // Handle log cleanup
  async function handleCleanup(agentId: string) {
    const state = logStates[agentId];
    if (!state) return;

    try {
      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (electronLogs) {
          const response = await electronLogs.cleanup(
            state.settings.retentionDays,
          );
          if (response.success) {
            toastSuccess(
              response.deletedCount > 0
                ? `Deleted ${response.deletedCount} old log files`
                : "No old log files to delete",
            );
            setHasLoadedTab((prev) => {
              const next = new Set(prev);
              next.delete(agentId);
              return next;
            });
            loadLogFiles(agentId);
          }
        }
        return;
      }

      // For agents: use REST API
      const response = await api.logs.cleanup(state.settings.retentionDays);
      if (response.success) {
        toastSuccess(
          response.deletedCount > 0
            ? `Deleted ${response.deletedCount} old log files`
            : "No old log files to delete",
        );
        setHasLoadedTab((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
        loadLogFiles(agentId);
      }
    } catch (err) {
      logger.error("[Logs] Failed to cleanup logs:", err);
      toastError("Failed to cleanup logs");
    }
  }

  // Handle file download
  async function handleDownload(agentId: string) {
    const state = logStates[agentId];
    if (!state?.selectedFile) return;

    try {
      let content: string;

      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (!electronLogs) return;
        const response = await electronLogs.getFileContent(state.selectedFile);
        if (!response.success) return;
        content = response.content;
      } else {
        // For agents: use REST API
        const response = await api.logs.getFileContent(state.selectedFile);
        if (!response.success) return;
        content = response.content;
      }

      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = state.selectedFile;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toastSuccess("Log file downloaded");
    } catch (err) {
      logger.error("[Logs] Failed to download log:", err);
      toastError("Failed to download log file");
    }
  }

  // Handle file deletion
  async function handleDelete(agentId: string) {
    const state = logStates[agentId];
    if (!state?.selectedFile) return;

    if (
      !confirm(
        `Delete log file "${state.selectedFile}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      // For dashboard: use local IPC
      if (agentId === "dashboard") {
        const electronLogs = window.electronAPI?.logs;
        if (electronLogs) {
          const response = await electronLogs.deleteFile(state.selectedFile);
          if (response.success) {
            toastSuccess("Log file deleted");
            setHasLoadedTab((prev) => {
              const next = new Set(prev);
              next.delete(agentId);
              return next;
            });
            loadLogFiles(agentId);
          }
        }
        return;
      }

      // For agents: use REST API
      const response = await api.logs.deleteFile(state.selectedFile);
      if (response.success) {
        toastSuccess("Log file deleted");
        setHasLoadedTab((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
        loadLogFiles(agentId);
      }
    } catch (err) {
      logger.error("[Logs] Failed to delete log:", err);
      toastError("Failed to delete log file");
    }
  }

  // Handle refresh
  async function handleRefresh(agentId: string) {
    setRefreshing(true);
    setHasLoadedTab((prev) => {
      const next = new Set(prev);
      next.delete(agentId);
      return next;
    });
    await loadLogFiles(agentId);
    await loadLogSettings(agentId);
    setRefreshing(false);
    toastSuccess("Logs refreshed");
  }

  // Filter log content
  function filterLogs(content: string): string {
    let lines = content.split("\n");

    // Filter by log level
    if (levelFilter !== "all") {
      const level = levelFilter.toUpperCase();
      lines = lines.filter((line) => line.includes(` ${level} `));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      lines = lines.filter((line) => line.toLowerCase().includes(query));
    }

    return lines.join("\n");
  }

  // Format helpers
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString();
  }

  // Get agent name
  function getAgentName(agentId: string): string {
    if (agentId === "dashboard") return "Dashboard";
    const conn = connections.find((c) => c.id === agentId);
    return conn?.name || agentId;
  }

  // Check if current tab is connected/available
  function isTabConnected(): boolean {
    if (activeTab === "dashboard") {
      // Dashboard is always "connected" if Electron logs API is available
      return !!window.electronAPI?.logs;
    }
    const connection = connections.find((c) => c.id === activeTab);
    return connection?.status === "connected";
  }

  const selectedFile = currentLogs.files.find(
    (f) => f.name === currentLogs.selectedFile,
  );

  // Helper to get connection status
  function getConnectionStatus(agentId: string): keyof typeof STATUS_COLORS {
    if (agentId === "dashboard") return "connected";
    const connection = connections.find((c) => c.id === agentId);
    return (connection?.status as keyof typeof STATUS_COLORS) || "disconnected";
  }

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
            <div className="h-7 w-px bg-border" />
            <h1 className="text-xl font-bold">Logs</h1>
          </>
        }
        center={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden md:inline">
              File:
            </span>
            <Select
              value={currentLogs.selectedFile || ""}
              onValueChange={(value) => {
                setLogStates((prev) => ({
                  ...prev,
                  [activeTab]: {
                    ...prev[activeTab],
                    selectedFile: value,
                  },
                }));
                loadLogContent(activeTab, value);
              }}
              disabled={!isTabConnected()}
            >
              <SelectTrigger className="w-auto h-9">
                <SelectValue placeholder="Select log file" />
              </SelectTrigger>
              <SelectContent>
                {currentLogs.files.map((file) => (
                  <SelectItem key={file.name} value={file.name}>
                    <div className="flex items-center gap-4">
                      <span className="truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0 me-1">
                        {formatFileSize(file.size)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        right={
          <>
            <span className="text-sm text-muted-foreground hidden md:inline">
              Source:
            </span>
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-auto h-9">
                <div className="flex items-center gap-2 min-w-0 me-1">
                  {activeTab === "dashboard" ? (
                    <>
                      <FaDesktop className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">Dashboard</span>
                      <FaCircle className="h-2 w-2 text-green-500 shrink-0 ml-auto" />
                    </>
                  ) : (
                    <>
                      <FaServer className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {getAgentName(activeTab)}
                      </span>
                      <FaCircle
                        className={`h-2 w-2 shrink-0 ml-auto ${STATUS_COLORS[getConnectionStatus(activeTab)]}`}
                      />
                    </>
                  )}
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dashboard">
                  <div className="flex items-center gap-2">
                    <FaDesktop className="h-4 w-4 text-muted-foreground" />
                    <span>Dashboard</span>
                    <FaCircle className="h-2 w-2 text-green-500 ml-auto" />
                  </div>
                </SelectItem>
                {connections.map((conn) => (
                  <SelectItem key={conn.id} value={conn.id}>
                    <div className="flex items-center gap-2">
                      <FaServer className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{conn.name}</span>
                      <FaCircle
                        className={`h-2 w-2 ml-auto ${STATUS_COLORS[(conn.status as keyof typeof STATUS_COLORS) || "disconnected"]}`}
                      />
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Settings Button */}
            <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon">
                  <FaGear className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[360px] sm:w-[400px]">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <FaGear className="h-4 w-4" />
                    Log Settings
                  </SheetTitle>
                  <SheetDescription>
                    Configure logging behavior for {getAgentName(activeTab)}
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  {/* Log Level */}
                  <div className="space-y-2">
                    <Label
                      htmlFor="sheet-log-level"
                      className="text-sm font-medium"
                    >
                      Log Level
                    </Label>
                    <Select
                      value={currentLogs.settings.minLevel.toString()}
                      onValueChange={(value) => {
                        const level = parseInt(value) as LogLevel;
                        handleUpdateSettings(activeTab, { minLevel: level });
                      }}
                      disabled={savingSettings || !isTabConnected()}
                    >
                      <SelectTrigger id="sheet-log-level" className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={LogLevel.DEBUG.toString()}>
                          DEBUG - All messages
                        </SelectItem>
                        <SelectItem value={LogLevel.INFO.toString()}>
                          INFO - Information and above
                        </SelectItem>
                        <SelectItem value={LogLevel.WARN.toString()}>
                          WARN - Warnings and errors
                        </SelectItem>
                        <SelectItem value={LogLevel.ERROR.toString()}>
                          ERROR - Errors only
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Controls which messages are written to log files
                    </p>
                  </div>

                  {/* Retention Days */}
                  <div className="space-y-2">
                    <Label
                      htmlFor="sheet-retention"
                      className="text-sm font-medium"
                    >
                      Retention (days)
                    </Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="sheet-retention"
                        type="number"
                        min="0"
                        max="365"
                        value={currentLogs.settings.retentionDays}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === "") {
                            setLogStates((prev) => ({
                              ...prev,
                              [activeTab]: {
                                ...prev[activeTab],
                                settings: {
                                  ...prev[activeTab].settings,
                                  retentionDays: 0,
                                },
                              },
                            }));
                            return;
                          }
                          const days = Math.max(
                            0,
                            Math.min(365, parseInt(value) || 0),
                          );
                          setLogStates((prev) => ({
                            ...prev,
                            [activeTab]: {
                              ...prev[activeTab],
                              settings: {
                                ...prev[activeTab].settings,
                                retentionDays: days,
                              },
                            },
                          }));
                        }}
                        onBlur={() =>
                          handleUpdateSettings(activeTab, {
                            retentionDays: currentLogs.settings.retentionDays,
                          })
                        }
                        className="h-10 w-28"
                        disabled={savingSettings || !isTabConnected()}
                      />
                      {currentLogs.settings.retentionDays === 0 && (
                        <span className="text-sm text-muted-foreground">
                          (keep forever)
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Set to 0 to keep logs forever
                    </p>
                  </div>

                  {/* Cleanup Button */}
                  <Button
                    variant="outline"
                    className="w-full h-10"
                    onClick={() => handleCleanup(activeTab)}
                    disabled={!isTabConnected()}
                  >
                    <FaTrash className="h-4 w-4 mr-2" />
                    Cleanup Old Logs
                  </Button>

                  {/* Info Box */}
                  <div className="rounded-lg border bg-muted/20 p-4 mt-6">
                    <div className="flex items-start gap-3">
                      <FaCircleInfo className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          <strong className="text-foreground">
                            {getAgentName(activeTab)}
                          </strong>{" "}
                          logs to:
                        </p>
                        <code className="text-xs bg-muted px-2 py-1 rounded block">
                          Documents/Game Servum/Logs/
                        </code>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Files rotate daily and are managed independently per
                          service.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </>
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Main Content - Log Viewer */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Toolbar */}
          <div className="border-b bg-card/50 px-4 py-3 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              {/* Level Filter */}
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger className="h-9 w-[130px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  <SelectItem value="debug">DEBUG</SelectItem>
                  <SelectItem value="info">INFO</SelectItem>
                  <SelectItem value="warn">WARN</SelectItem>
                  <SelectItem value="error">ERROR</SelectItem>
                </SelectContent>
              </Select>

              {/* Search */}
              <div className="flex-1 min-w-[200px] max-w-md relative">
                <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-10"
                />
              </div>

              {/* File Info */}
              {selectedFile && (
                <div className="hidden lg:flex items-center gap-4 text-sm text-muted-foreground shrink-0">
                  <span>
                    <strong className="text-foreground">Size:</strong>{" "}
                    {formatFileSize(selectedFile.size)}
                  </span>
                  <span>
                    <strong className="text-foreground">Modified:</strong>{" "}
                    {formatDate(selectedFile.modified)}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    Last 1000 lines
                  </Badge>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1 hidden md:block" />

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRefresh(activeTab)}
                  disabled={
                    refreshing || currentLogs.loading || !isTabConnected()
                  }
                  className="h-9 gap-2"
                >
                  <FaRotate
                    className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(activeTab)}
                  disabled={!currentLogs.selectedFile || !isTabConnected()}
                  className="h-9 gap-2"
                >
                  <FaDownload className="h-4 w-4" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(activeTab)}
                  disabled={!currentLogs.selectedFile || !isTabConnected()}
                  className="h-9 gap-2 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50"
                >
                  <FaTrash className="h-4 w-4" />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Log Content */}
          <div className="flex-1 overflow-auto p-5 min-h-0 bg-muted/5">
            {(() => {
              // Check if agent is disconnected
              if (activeTab !== "dashboard") {
                const connection = connections.find((c) => c.id === activeTab);
                if (!connection || connection.status !== "connected") {
                  return (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center space-y-4 max-w-md">
                        <FaCircleInfo className="h-10 w-10 mx-auto text-yellow-500" />
                        <div>
                          <p className="text-base font-medium text-foreground mb-2">
                            Agent Disconnected
                          </p>
                          <p className="text-sm text-muted-foreground">
                            The selected agent is not currently connected. Logs
                            can only be viewed when the agent connection is
                            active.
                          </p>
                        </div>
                        {connection?.status === "reconnecting" && (
                          <div className="flex items-center justify-center gap-2 text-sm">
                            <FaSpinner className="h-4 w-4 animate-spin" />
                            <span>Reconnecting...</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
              }

              // Normal content rendering
              if (currentLogs.loading) {
                return (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center space-y-3">
                      <FaSpinner className="h-8 w-8 animate-spin mx-auto" />
                      <p className="text-base">Loading logs...</p>
                    </div>
                  </div>
                );
              }

              if (currentLogs.content) {
                return (
                  <pre className="text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                    {filterLogs(currentLogs.content)}
                  </pre>
                );
              }

              return (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center space-y-3">
                    <FaCircleInfo className="h-8 w-8 mx-auto" />
                    <p className="text-base">
                      No log content available. Select a file to view logs.
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        </main>
      </div>
    </div>
  );
}
