import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  FaMagnifyingGlass,
  FaDownload,
  FaTextSlash,
  FaTextWidth,
  FaList,
} from "react-icons/fa6";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useBackend } from "@/hooks/useBackend";
import { useContentWidth } from "@/hooks/useContentWidth";
import { toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
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

function formatShortDateTime(isoString: string): string {
  const d = new Date(isoString);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
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
  const { contentClass } = useContentWidth();
  // State
  const [currentLogs, setCurrentLogs] = useState<LogFile[]>([]);
  const [archives, setArchives] = useState<ArchiveSession[]>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<string | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<LogFile[]>([]);
  const [logContent, setLogContent] = useState<string>("");
  const [totalLines, setTotalLines] = useState<number>(0);
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
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [wordWrap, setWordWrap] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const logContentRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<number | null>(null);
  const selectedLogRef = useRef(selectedLog);
  selectedLogRef.current = selectedLog;

  // Filter log content by search query
  const filteredContent = useMemo(() => {
    if (!searchQuery.trim() || !logContent) return logContent;
    const query = searchQuery.toLowerCase();
    return logContent
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query))
      .join("\n");
  }, [logContent, searchQuery]);

  const matchCount = useMemo(() => {
    if (!searchQuery.trim() || !logContent) return 0;
    const query = searchQuery.toLowerCase();
    return logContent
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query)).length;
  }, [logContent, searchQuery]);

  // Get selected file metadata
  const selectedFileMeta = useMemo(() => {
    if (!selectedLog) return null;
    if (viewingSource === "current") {
      return currentLogs.find((l) => l.name === selectedLog) ?? null;
    }
    return (
      archiveFiles.find(
        (f) => f.name === selectedLog && f.path.includes(viewingSource.archive),
      ) ?? null
    );
  }, [selectedLog, viewingSource, currentLogs, archiveFiles]);

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
          totalLines: number;
          returnedLines: number;
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
        setTotalLines(data.totalLines);
      } catch (err) {
        logger.error("Failed to load log content", err);
        setLogContent("");
        setTotalLines(0);
      } finally {
        setLoadingContent(false);
      }
    },
    [server.id, api.servers],
  );

  // Load log file list + archives
  const loadLogFiles = useCallback(async () => {
    try {
      const data = await api.servers.getLogs(server.id);
      setCurrentLogs(data.current);
      setArchives(data.archives);

      // Auto-select first current log if nothing selected
      if (data.current.length > 0 && !selectedLogRef.current) {
        setSelectedLog(data.current[0].name);
        setViewingSource("current");
        loadLogContent(data.current[0].name, "current");
      }
    } catch (err) {
      logger.error("Failed to load logs", err);
    } finally {
      setLoading(false);
    }
  }, [loadLogContent, server.id, api.servers]);

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
    setSearchQuery("");
    setSidebarOpen(false);
    loadLogContent(filename, "current", false);
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
    setSearchQuery("");
    setSidebarOpen(false);
    loadLogContent(filename, { archive: sessionName }, false);
  }

  async function executeDeleteArchive(sessionName: string) {
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
        setTotalLines(0);
        setViewingSource("current");
      }
    } catch (err) {
      logger.error("Failed to delete archive", err);
    }
  }

  // Draft settings state for the dialog
  const [draftSettings, setDraftSettings] = useState<
    Pick<LogSettings, "archiveOnStart" | "retentionDays">
  >({ archiveOnStart: true, retentionDays: 30 });

  function openSettingsDialog() {
    setDraftSettings({
      archiveOnStart: logSettings.archiveOnStart,
      retentionDays: logSettings.retentionDays,
    });
    setShowSettings(true);
  }

  async function handleSaveSettings() {
    setSettingsLoading(true);
    try {
      await api.servers.updateLogSettings(server.id, draftSettings);
      setLogSettings((prev) => ({ ...prev, ...draftSettings }));
      toastSuccess("Log settings saved");
      setShowSettings(false);
    } catch (err) {
      logger.error("Failed to update log settings", err);
    } finally {
      setSettingsLoading(false);
    }
  }

  function handleDownload() {
    if (!selectedLog || !logContent) return;
    const blob = new Blob([logContent], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedLog;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastSuccess("Log file downloaded");
  }

  function getArchiveFilesForSession(sessionName: string): LogFile[] {
    return archiveFiles.filter((f) => f.path.includes(sessionName));
  }

  // Build viewer description
  function getViewerDescription(): string {
    if (!selectedLog) return "Choose a log file from the list";
    const parts: string[] = [];
    if (selectedFileMeta) {
      parts.push(formatFileSize(selectedFileMeta.size));
    }
    if (totalLines > 0) {
      parts.push(`${totalLines.toLocaleString()} lines`);
    }
    if (selectedFileMeta) {
      parts.push(`Modified ${formatRelativeDate(selectedFileMeta.modified)}`);
    }
    if (viewingSource !== "current") {
      const archiveDate = archives.find(
        (a) =>
          typeof viewingSource !== "string" && a.name === viewingSource.archive,
      )?.date;
      if (archiveDate) {
        parts.push(`Archived ${formatDate(archiveDate)}`);
      }
    }
    return parts.length > 0 ? parts.join(" · ") : "Showing full file contents";
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <FaArrowsRotate className="h-6 w-6 animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading log files...</p>
        </div>
      </div>
    );
  }

  const totalFileCount =
    currentLogs.length + archives.reduce((sum, a) => sum + a.fileCount, 0);

  return (
    <div className="flex flex-col flex-1 min-h-0 pt-2">
      {/* ── Sticky Toolbar ── */}
      <div className="shrink-0 bg-background px-4">
        <div
          className={cn(
            "py-2 flex items-center justify-between gap-2 border-b",
            contentClass,
          )}
        >
          {/* Left: file info */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FaFileLines className="h-4 w-4 text-ring shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {selectedLog || "Select a log file"}
                </span>
                {viewingSource !== "current" && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    <FaBoxArchive className="h-3 w-3 mr-1" />
                    Archived
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {getViewerDescription()}
              </p>
            </div>
          </div>

          {/* Right: action buttons */}
          {selectedLog && (
            <div className="flex items-center gap-1.5 shrink-0">
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
                      setTotalLines(0);
                      setViewingSource("current");
                    }
                  }}
                >
                  <FaArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  <span className="hidden sm:inline">Current Logs</span>
                </Button>
              )}
              {viewingSource === "current" && (
                <Button
                  variant={autoRefresh ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                >
                  <FaArrowsRotate
                    className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`}
                  />
                  <span className="hidden sm:inline ml-1.5">
                    {autoRefresh ? "Auto-refresh ON" : "Auto-refresh"}
                  </span>
                </Button>
              )}
              <Tip content="Download log file">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  disabled={!logContent}
                >
                  <FaDownload className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip content="Refresh content">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadLogContent(selectedLog, viewingSource)}
                  disabled={loadingContent}
                >
                  <FaArrowsRotate className="h-3.5 w-3.5" />
                </Button>
              </Tip>
            </div>
          )}
        </div>
      </div>

      {/* ── Content: Sidebar + Viewer ── */}
      <div
        className={cn(
          "flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden px-4 pb-4 pt-2 gap-4",
          contentClass,
        )}
      >
        {/* Mobile file list toggle */}
        <button
          type="button"
          className="lg:hidden shrink-0 flex items-center justify-between w-full px-4 py-2.5 rounded-lg border bg-muted/30 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <div className="flex items-center gap-2">
            <FaList className="h-3.5 w-3.5 text-ring" />
            Log Files
            {totalFileCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalFileCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Tip content="Log settings">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  openSettingsDialog();
                }}
              >
                <FaGear className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            <Tip content="Refresh file list">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  loadLogFiles();
                }}
              >
                <FaArrowsRotate className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            {sidebarOpen ? (
              <FaChevronDown className="h-3.5 w-3.5" />
            ) : (
              <FaChevronRight className="h-3.5 w-3.5" />
            )}
          </div>
        </button>

        {/* File list sidebar */}
        <div
          className={`lg:w-72 shrink-0 flex flex-col bg-background rounded-lg border ${
            sidebarOpen ? "max-h-64 lg:max-h-none" : "hidden lg:block"
          }`}
        >
          {/* Desktop sidebar header */}
          <div className="hidden lg:flex items-center justify-between px-3 py-2.5 border-b shrink-0">
            <div className="flex items-center gap-2">
              <FaFileLines className="h-4 w-4 text-ring" />
              <span className="text-sm font-medium text-muted-foreground">
                Log Files
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Tip content="Log settings">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSettingsDialog()}
                >
                  <FaGear className="h-3.5 w-3.5" />
                </Button>
              </Tip>
              <Tip content="Refresh file list">
                <Button variant="ghost" size="sm" onClick={loadLogFiles}>
                  <FaArrowsRotate className="h-3.5 w-3.5" />
                </Button>
              </Tip>
            </div>
          </div>

          {/* Scrollable file list */}
          <div className="flex-1 overflow-y-auto">
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
                        <FaFileLines className="h-3.5 w-3.5 text-ring/70 shrink-0" />
                        <Tip content={log.name} side="right">
                          <span className="text-sm font-medium truncate">
                            {log.name}
                          </span>
                        </Tip>
                      </div>
                      <div className="flex items-center gap-3 mt-1 ml-[1.625rem] text-xs text-muted-foreground">
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
                <div className="divide-y">
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
                              <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            ) : (
                              <FaChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <FaFolderOpen className="h-3.5 w-3.5 text-ring/70 shrink-0" />
                            <Tip
                              content={formatDate(archive.date)}
                              side="right"
                            >
                              <span className="text-sm font-medium truncate">
                                {formatShortDateTime(archive.date)}
                              </span>
                            </Tip>
                          </div>
                          <div className="flex items-center gap-3 mt-1 ml-[3.25rem] text-xs text-muted-foreground">
                            <span>
                              {archive.fileCount} file
                              {archive.fileCount !== 1 ? "s" : ""}
                            </span>
                            <span>{formatFileSize(archive.totalSize)}</span>
                          </div>
                        </button>
                        <Tip content="Delete archive">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mr-2 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(archive.name)}
                          >
                            <FaTrashCan className="h-3.5 w-3.5" />
                          </Button>
                        </Tip>
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
                                    <FaFileLines className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    <Tip content={file.name} side="right">
                                      <span className="text-xs font-medium truncate">
                                        {file.name}
                                      </span>
                                    </Tip>
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
              <div className="text-center py-6 text-muted-foreground">
                <FaFileLines className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No log files found</p>
                <p className="text-xs mt-1">
                  Log files will appear after the server runs.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Log viewer column: search + content */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden gap-2">
          {/* Search + Word Wrap row */}
          {selectedLog && (
            <div className="shrink-0 flex items-center gap-2 px-1 py-1">
              <div className="relative flex-1">
                <FaMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search in log..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-9 text-sm"
                />
              </div>
              {searchQuery.trim() && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {matchCount} {matchCount === 1 ? "match" : "matches"}
                </Badge>
              )}
              <Tip
                content={wordWrap ? "Disable word wrap" : "Enable word wrap"}
              >
                <Button
                  variant={wordWrap ? "default" : "outline"}
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() => setWordWrap(!wordWrap)}
                >
                  {wordWrap ? (
                    <FaTextWidth className="h-3.5 w-3.5" />
                  ) : (
                    <FaTextSlash className="h-3.5 w-3.5" />
                  )}
                </Button>
              </Tip>
            </div>
          )}

          {/* Log content */}
          <div className="flex-1 flex flex-col min-h-0">
            {loadingContent ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <FaArrowsRotate className="h-6 w-6 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Loading log content...</p>
                </div>
              </div>
            ) : selectedLog ? (
              <div
                ref={logContentRef}
                className={`bg-terminal rounded-lg p-4 flex-1 min-h-[200px] font-mono text-xs text-green-400 ${
                  wordWrap
                    ? "whitespace-pre-wrap break-words overflow-y-auto overflow-x-hidden"
                    : "whitespace-pre overflow-auto"
                }`}
              >
                {filteredContent || (
                  <span className="text-muted-foreground">
                    {searchQuery.trim()
                      ? "No matching lines"
                      : "Log file is empty"}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <FaFileLines className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">
                    Select a log file to view its contents
                  </p>
                  <p className="text-xs mt-1">
                    Choose from the file list on the left
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FaGear className="h-5 w-5 text-ring" />
              Log Settings
            </DialogTitle>
            <DialogDescription>
              Configure log archiving and retention for this server.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="archive-on-start"
                className="text-sm cursor-pointer"
              >
                Archive logs on server start
              </Label>
              <Switch
                id="archive-on-start"
                checked={draftSettings.archiveOnStart}
                disabled={settingsLoading}
                onCheckedChange={(checked: boolean) =>
                  setDraftSettings((prev) => ({
                    ...prev,
                    archiveOnStart: checked,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Auto-delete archives after</Label>
              <Select
                value={String(draftSettings.retentionDays)}
                disabled={settingsLoading}
                onValueChange={(val) =>
                  setDraftSettings((prev) => ({
                    ...prev,
                    retentionDays: parseInt(val, 10),
                  }))
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
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowSettings(false)}
              disabled={settingsLoading}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSettings}
              disabled={settingsLoading}
              className="w-full sm:w-auto"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Archive Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FaTrashCan className="h-5 w-5 text-destructive" />
              Delete Archive
            </DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete the archive{" "}
            <span className="font-semibold text-foreground">
              {deleteTarget
                ? formatShortDateTime(
                    archives.find((a) => a.name === deleteTarget)?.date ??
                      deleteTarget,
                  )
                : ""}
            </span>
            ?
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  executeDeleteArchive(deleteTarget);
                  setDeleteTarget(null);
                }
              }}
              className="w-full sm:w-auto"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
