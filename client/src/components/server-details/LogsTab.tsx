import { useState, useEffect, useRef, useCallback } from "react";
import {
  FaFileLines,
  FaArrowsRotate,
  FaClock,
  FaHardDrive,
  FaBoxArchive,
  FaTrashCan,
  FaGear,
  FaFolderOpen,
  FaChevronRight,
  FaChevronDown,
  FaArrowLeft,
} from "react-icons/fa6";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess } from "@/lib/toast";
import { logger } from "@/lib/logger";
import type { GameServer, LogFile, ArchiveSession, LogSettings } from "@/types";

interface LogsTabProps {
  server: GameServer;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString();
}

function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

const RETENTION_OPTIONS = [
  { value: 0, label: "Keep forever" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

export function LogsTab({ server }: LogsTabProps) {
  const { api, isConnected } = useBackend();
  // State
  const [currentLogs, setCurrentLogs] = useState<LogFile[]>([]);
  const [archives, setArchives] = useState<ArchiveSession[]>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<string | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<LogFile[]>([]);
  const [logContent, setLogContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [logSettings, setLogSettings] = useState<LogSettings>({
    serverId: server.id,
    archiveOnStart: true,
    retentionDays: 30,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [expandedArchives, setExpandedArchives] = useState<Set<string>>(
    new Set(),
  );
  const [viewingSource, setViewingSource] = useState<
    "current" | { archive: string }
  >("current");

  const logContentRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<number | null>(null);

  // Load current log content
  const loadLogContent = useCallback(
    async (
      filename: string,
      source: "current" | { archive: string },
      showLoading = true,
    ) => {
      if (showLoading) setLoadingContent(true);
      try {
        let data: {
          content: string;
        };
        if (source === "current") {
          data = await api.servers.getLogContent(server.id, filename);
        } else {
          data = await api.servers.getArchivedLogContent(
            server.id,
            source.archive,
            filename,
          );
        }
        setLogContent(data.content);
      } catch (err) {
        logger.error("Failed to load log content", err);
        setLogContent("");
      } finally {
        setLoadingContent(false);
      }
    },
    [server.id, api.servers],
  );

  // Load log file list + archives
  const loadLogFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.servers.getLogs(server.id);
      setCurrentLogs(data.current);
      setArchives(data.archives);

      // Auto-select first current log if nothing selected
      if (data.current.length > 0 && !selectedLog) {
        setSelectedLog(data.current[0].name);
        setViewingSource("current");
        loadLogContent(data.current[0].name, "current");
      }
    } catch (err) {
      logger.error("Failed to load logs", err);
    } finally {
      setLoading(false);
    }
  }, [loadLogContent, selectedLog, server.id, api.servers]);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const settings = await api.servers.getLogSettings(server.id);
      setLogSettings(settings);
    } catch (err) {
      logger.error("Failed to load log settings", err);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadLogFiles();
    loadSettings();
  }, [loadLogFiles, loadSettings, isConnected]);

  // Auto-refresh effect
  useEffect(() => {
    if (
      autoRefresh &&
      selectedLog &&
      viewingSource === "current" &&
      isConnected
    ) {
      intervalRef.current = window.setInterval(() => {
        loadLogContent(selectedLog, "current", false);
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, selectedLog, viewingSource, loadLogContent, isConnected]);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (logContentRef.current && autoRefresh) {
      logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
    }
  }, [logContent, autoRefresh]);

  function handleSelectLog(filename: string) {
    setSelectedLog(filename);
    setSelectedArchive(null);
    setViewingSource("current");
    setAutoRefresh(false);
    loadLogContent(filename, "current");
  }

  async function handleToggleArchive(sessionName: string) {
    const newExpanded = new Set(expandedArchives);
    if (newExpanded.has(sessionName)) {
      newExpanded.delete(sessionName);
    } else {
      newExpanded.add(sessionName);
      // Load archive files
      try {
        const files = await api.servers.getArchiveFiles(server.id, sessionName);
        setArchiveFiles((prev) => {
          const otherFiles = prev.filter((f) => !f.path.includes(sessionName));
          return [...otherFiles, ...files];
        });
      } catch (err) {
        logger.error("Failed to load archive files", err);
      }
    }
    setExpandedArchives(newExpanded);
  }

  function handleSelectArchivedLog(sessionName: string, filename: string) {
    setSelectedLog(filename);
    setSelectedArchive(sessionName);
    setViewingSource({ archive: sessionName });
    setAutoRefresh(false);
    loadLogContent(filename, { archive: sessionName });
  }

  async function handleDeleteArchive(sessionName: string) {
    try {
      await api.servers.deleteArchive(server.id, sessionName);
      toastSuccess("Archive deleted");
      setArchives((prev) => prev.filter((a) => a.name !== sessionName));
      if (
        viewingSource !== "current" &&
        viewingSource.archive === sessionName
      ) {
        setSelectedLog(null);
        setLogContent("");
        setViewingSource("current");
      }
    } catch (err) {
      logger.error("Failed to delete archive", err);
    }
  }

  async function handleUpdateSettings(
    updates: Partial<Pick<LogSettings, "archiveOnStart" | "retentionDays">>,
  ) {
    setSettingsLoading(true);
    try {
      await api.servers.updateLogSettings(server.id, updates);
      setLogSettings((prev) => ({ ...prev, ...updates }));
      toastSuccess("Log settings saved");
    } catch (err) {
      logger.error("Failed to update log settings", err);
    } finally {
      setSettingsLoading(false);
    }
  }

  function getArchiveFilesForSession(sessionName: string): LogFile[] {
    return archiveFiles.filter((f) => f.path.includes(sessionName));
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading log files...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4 h-[calc(100vh-14rem)] min-h-[400px]">
      {/* Sidebar: Log files list */}
      <Card className="lg:col-span-1 overflow-hidden flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Log Files</CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
                title="Log settings"
              >
                <FaGear className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={loadLogFiles}>
                <FaArrowsRotate className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Settings panel */}
        {showSettings && (
          <div className="px-4 pb-3 border-b space-y-3">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="archive-on-start"
                className="text-sm cursor-pointer"
              >
                Archive logs on server start
              </Label>
              <Switch
                id="archive-on-start"
                checked={logSettings.archiveOnStart}
                disabled={settingsLoading}
                onCheckedChange={(checked: boolean) =>
                  handleUpdateSettings({ archiveOnStart: checked })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Auto-delete archives after</Label>
              <Select
                value={String(logSettings.retentionDays)}
                disabled={settingsLoading}
                onValueChange={(val) =>
                  handleUpdateSettings({
                    retentionDays: parseInt(val, 10),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <CardContent className="p-0 flex-1 overflow-y-auto min-h-0">
          {/* Current logs section */}
          {currentLogs.length > 0 && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 border-b">
                Current Session
              </div>
              <div className="divide-y">
                {currentLogs.map((log) => (
                  <button
                    key={log.name}
                    onClick={() => handleSelectLog(log.name)}
                    className={`w-full p-3 text-left hover:bg-muted/50 transition-colors ${
                      selectedLog === log.name && viewingSource === "current"
                        ? "bg-muted"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FaFileLines className="h-4 w-4 text-ring/70 flex-shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {log.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FaHardDrive className="h-3 w-3" />
                        {formatFileSize(log.size)}
                      </span>
                      <span className="flex items-center gap-1">
                        <FaClock className="h-3 w-3" />
                        {formatRelativeDate(log.modified)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Archives section */}
          {archives.length > 0 && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-t">
                <div className="flex items-center gap-1.5">
                  <FaBoxArchive className="h-3 w-3 text-ring/70" />
                  Archives
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 ml-auto"
                  >
                    {archives.length}
                  </Badge>
                </div>
              </div>
              <div className="divide-y max-h-[300px] overflow-y-auto">
                {archives.map((archive) => (
                  <div key={archive.name}>
                    {/* Archive session header */}
                    <div className="flex items-center hover:bg-muted/50 transition-colors">
                      <button
                        onClick={() => handleToggleArchive(archive.name)}
                        className="flex-1 p-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          {expandedArchives.has(archive.name) ? (
                            <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <FaChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <FaFolderOpen className="h-4 w-4 text-ring/70 flex-shrink-0" />
                          <span className="text-sm font-medium truncate">
                            {formatDate(archive.date).split(",")[0]}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 ml-[3.25rem] text-xs text-muted-foreground">
                          <span>
                            {archive.fileCount} file
                            {archive.fileCount !== 1 ? "s" : ""}
                          </span>
                          <span>{formatFileSize(archive.totalSize)}</span>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mr-2 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteArchive(archive.name)}
                        title="Delete archive"
                      >
                        <FaTrashCan className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Expanded archive files */}
                    {expandedArchives.has(archive.name) && (
                      <div className="bg-muted/20">
                        {getArchiveFilesForSession(archive.name).length ===
                        0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground ml-8">
                            Loading...
                          </div>
                        ) : (
                          getArchiveFilesForSession(archive.name).map(
                            (file) => (
                              <button
                                key={`${archive.name}/${file.name}`}
                                onClick={() =>
                                  handleSelectArchivedLog(
                                    archive.name,
                                    file.name,
                                  )
                                }
                                className={`w-full p-2 pl-12 text-left hover:bg-muted/50 transition-colors border-t border-border/30 ${
                                  selectedLog === file.name &&
                                  viewingSource !== "current" &&
                                  selectedArchive === archive.name
                                    ? "bg-muted border-l-2 border-l-ring"
                                    : ""
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <FaFileLines className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                  <span className="text-xs font-medium truncate">
                                    {file.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 ml-[1.625rem] text-[11px] text-muted-foreground">
                                  <span>{formatFileSize(file.size)}</span>
                                </div>
                              </button>
                            ),
                          )
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {currentLogs.length === 0 && archives.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No log files found
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main: Log content viewer */}
      <Card className="lg:col-span-3 flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FaFileLines className="h-5 w-5 text-ring" />
                {selectedLog || "Select a log file"}
                {viewingSource !== "current" && (
                  <Badge variant="secondary" className="text-xs">
                    <FaBoxArchive className="h-3 w-3 mr-1" />
                    Archived
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {selectedLog
                  ? viewingSource === "current"
                    ? "Showing full file contents"
                    : `Archived session: ${formatDate(
                        archives.find(
                          (a) =>
                            typeof viewingSource !== "string" &&
                            a.name === viewingSource.archive,
                        )?.date ||
                          (typeof viewingSource !== "string"
                            ? viewingSource.archive
                            : ""),
                      )}`
                  : "Choose a log file from the list"}
              </CardDescription>
            </div>
            {selectedLog && (
              <div className="flex items-center gap-2">
                {viewingSource !== "current" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (currentLogs.length > 0) {
                        handleSelectLog(currentLogs[0].name);
                      } else {
                        setSelectedLog(null);
                        setLogContent("");
                        setViewingSource("current");
                      }
                    }}
                  >
                    <FaArrowLeft className="h-4 w-4 mr-1" />
                    Current Logs
                  </Button>
                )}
                {viewingSource === "current" && (
                  <Button
                    variant={autoRefresh ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAutoRefresh(!autoRefresh)}
                  >
                    <FaArrowsRotate
                      className={`h-4 w-4 mr-2 ${autoRefresh ? "animate-spin" : ""}`}
                    />
                    {autoRefresh ? "Auto-refresh ON" : "Auto-refresh"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadLogContent(selectedLog, viewingSource)}
                  disabled={loadingContent}
                >
                  <FaArrowsRotate className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          {loadingContent ? (
            <div className="py-8 text-center text-muted-foreground">
              Loading log content...
            </div>
          ) : selectedLog ? (
            <div
              ref={logContentRef}
              className="bg-terminal rounded-md p-3 flex-1 min-h-[200px] overflow-auto font-mono text-xs text-green-400 whitespace-pre-wrap"
            >
              {logContent || (
                <span className="text-muted-foreground">Log file is empty</span>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Select a log file to view its contents
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
