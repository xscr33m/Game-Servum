import { useState, useEffect, useCallback } from "react";
import {
  FaBoxArchive,
  FaPlus,
  FaTrashCan,
  FaArrowsRotate,
  FaRotateLeft,
  FaGear,
  FaFloppyDisk,
  FaSpinner,
  FaClock,
  FaHardDrive,
  FaTag,
  FaCircleCheck,
  FaCircleXmark,
  FaTriangleExclamation,
  FaDownload,
  FaPen,
  FaChevronDown,
  FaChevronRight,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess, toastError } from "@/lib/toast";
import { logger } from "@/lib/logger";
import type {
  GameServer,
  BackupMetadata,
  BackupSettings,
  BackupProgress,
} from "@/types";

interface BackupsTabProps {
  server: GameServer;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
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

const triggerLabels: Record<string, string> = {
  manual: "Manual",
  "pre-start": "Pre-Start",
  "pre-restart": "Pre-Restart",
  "pre-update": "Pre-Update",
  "pre-restore": "Pre-Restore",
};

export function BackupsTab({ server }: BackupsTabProps) {
  const { api, isConnected, subscribe } = useBackend();

  // Backups list
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  // Active backup progress
  const [activeProgress, setActiveProgress] = useState<BackupProgress | null>(
    null,
  );

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [savedSettings, setSavedSettings] = useState<BackupSettings | null>(
    null,
  );
  const [defaultPaths, setDefaultPaths] = useState<{
    savePaths: string[];
    configPaths: string[];
    excludePatterns: string[];
  } | null>(null);

  // Create backup dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createTag, setCreateTag] = useState("");
  const [creating, setCreating] = useState(false);

  // Restore dialog
  const [restoreTarget, setRestoreTarget] = useState<BackupMetadata | null>(
    null,
  );
  const [preRestoreBackup, setPreRestoreBackup] = useState(true);
  const [restoring, setRestoring] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<BackupMetadata | null>(null);

  // Edit backup dialog
  const [editTarget, setEditTarget] = useState<BackupMetadata | null>(null);
  const [editName, setEditName] = useState("");
  const [editTag, setEditTag] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // ── Data loading ──

  const loadBackups = useCallback(async () => {
    try {
      const data = await api.servers.getBackups(server.id);
      setBackups(data.backups);
    } catch (err) {
      logger.error("Failed to load backups", err);
    } finally {
      setLoading(false);
    }
  }, [server.id, api.servers]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const data = await api.servers.getBackupSettings(server.id);
      setSettings(data.settings);
      setSavedSettings(data.settings);
      setDefaultPaths(data.defaultPaths);
    } catch (err) {
      logger.error("Failed to load backup settings", err);
    } finally {
      setSettingsLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (isConnected) {
      loadBackups();
      loadSettings();
    }
  }, [isConnected, loadBackups, loadSettings]);

  // ── WebSocket events ──

  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      const payload = message.payload as Record<string, unknown>;
      if (payload?.serverId !== server.id) return;

      switch (message.type) {
        case "backup:started":
          setActiveProgress({
            serverId: server.id,
            backupId: payload.backupId as string,
            phase: "stopping",
            percent: null,
            message: "Backup started...",
          });
          break;
        case "backup:progress":
          setActiveProgress(payload as unknown as BackupProgress);
          break;
        case "backup:complete":
          setActiveProgress(null);
          toastSuccess("Backup completed successfully");
          loadBackups();
          break;
        case "backup:failed":
          setActiveProgress(null);
          toastError((payload.error as string) || "Backup failed");
          loadBackups();
          break;
        case "restore:started":
          toastSuccess("Restore started...");
          break;
        case "restore:complete":
          toastSuccess("Restore completed successfully");
          loadBackups();
          break;
      }
    });
    return unsubscribe;
  }, [subscribe, server.id, loadBackups]);

  // ── Handlers ──

  async function handleCreateBackup() {
    setCreating(true);
    try {
      await api.servers.createBackup(
        server.id,
        createName || undefined,
        createTag || undefined,
      );
      setShowCreateDialog(false);
      setCreateName("");
      setCreateTag("");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteBackup() {
    if (!deleteTarget) return;
    try {
      await api.servers.deleteBackup(server.id, deleteTarget.id);
      toastSuccess("Backup deleted");
      setDeleteTarget(null);
      loadBackups();
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const result = await api.servers.restoreBackup(
        server.id,
        restoreTarget.id,
        preRestoreBackup,
      );
      if (result.success) {
        toastSuccess(result.message || "Restore initiated");
      }
      setRestoreTarget(null);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  async function handleDownloadBackup(backup: BackupMetadata) {
    try {
      await api.servers.downloadBackup(server.id, backup.id);
      toastSuccess("Download started");
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      await api.servers.updateBackup(server.id, editTarget.id, {
        name: editName.trim() || null,
        tag: editTag.trim() || null,
      });
      setBackups((prev) =>
        prev.map((b) =>
          b.id === editTarget.id
            ? {
                ...b,
                name: editName.trim() || null,
                tag: editTag.trim() || null,
              }
            : b,
        ),
      );
      setEditTarget(null);
      toastSuccess("Backup updated");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSaveSettings() {
    if (!settings) return;
    setSettingsSaving(true);
    try {
      const result = await api.servers.updateBackupSettings(
        server.id,
        settings,
      );
      if (result.settings) {
        setSettings(result.settings);
        setSavedSettings(result.settings);
      }
      toastSuccess("Backup settings saved");
      setShowSettings(false);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSettingsSaving(false);
    }
  }

  // ── Summary stats ──

  const successfulBackups = backups.filter((b) => b.status === "success");
  const totalSize = successfulBackups.reduce(
    (sum, b) => sum + (b.sizeBytes ?? 0),
    0,
  );

  return (
    <div className="space-y-0">
      {/* ── Header ── */}
      <div className="pb-4 border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <FaBoxArchive className="h-4 w-4 text-ring" />
            <span className="text-sm font-medium text-muted-foreground">
              Backups
            </span>
            {successfulBackups.length > 0 && (
              <Badge variant="secondary">{successfulBackups.length}</Badge>
            )}
            {totalSize > 0 && (
              <span className="text-xs text-muted-foreground">
                · {formatFileSize(totalSize)} total
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadBackups()}
              disabled={!isConnected}
            >
              <FaArrowsRotate className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              disabled={
                !isConnected || !!activeProgress || server.status !== "stopped"
              }
            >
              <FaPlus className="h-3.5 w-3.5 mr-1.5" />
              Create Backup
            </Button>
          </div>
        </div>
      </div>

      {/* ── Settings (collapsible) ── */}
      <div className="py-6 border-b">
        <button
          type="button"
          className="flex items-center justify-between w-full text-left cursor-pointer group"
          onClick={() => {
            setShowSettings((prev) => !prev);
            if (!showSettings) loadSettings();
          }}
        >
          <div className="flex items-center gap-2">
            <FaGear className="h-4 w-4 text-ring" />
            <span className="text-sm font-medium text-muted-foreground">
              Backup Settings
            </span>
          </div>
          {showSettings ? (
            <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <FaChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
        </button>

        {showSettings && (
          <div className="mt-4 space-y-6">
            {settingsLoading || !settings ? (
              <div className="flex items-center justify-center py-6">
                <FaSpinner className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Automatic Backups + Retention side by side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Automatic triggers */}
                  <div className="space-y-3 rounded-lg border p-4">
                    <h3 className="text-sm font-medium border-b pb-2">
                      Automatic Backups
                    </h3>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="backup-before-start" className="text-sm">
                        Before server start
                      </Label>
                      <Switch
                        id="backup-before-start"
                        checked={settings.backupBeforeStart}
                        onCheckedChange={(checked) =>
                          setSettings({
                            ...settings,
                            backupBeforeStart: checked,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="backup-before-restart"
                        className="text-sm"
                      >
                        Before scheduled restart
                      </Label>
                      <Switch
                        id="backup-before-restart"
                        checked={settings.backupBeforeRestart}
                        onCheckedChange={(checked) =>
                          setSettings({
                            ...settings,
                            backupBeforeRestart: checked,
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="backup-before-update" className="text-sm">
                        Before auto-update
                      </Label>
                      <Switch
                        id="backup-before-update"
                        checked={settings.backupBeforeUpdate}
                        onCheckedChange={(checked) =>
                          setSettings({
                            ...settings,
                            backupBeforeUpdate: checked,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Retention */}
                  <div className="space-y-3 rounded-lg border p-4">
                    <h3 className="text-sm font-medium border-b pb-2">
                      Retention
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="retention-count" className="text-sm">
                          Max backup count
                        </Label>
                        <Input
                          id="retention-count"
                          type="number"
                          min={0}
                          value={settings.retentionCount}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              retentionCount: parseInt(e.target.value) || 0,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          0 = unlimited
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="retention-days" className="text-sm">
                          Max age (days)
                        </Label>
                        <Input
                          id="retention-days"
                          type="number"
                          min={0}
                          value={settings.retentionDays}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              retentionDays: parseInt(e.target.value) || 0,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          0 = keep forever
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Backup Paths */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="text-sm font-medium">Backup Paths</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => {
                        if (!defaultPaths) return;
                        setSettings({
                          ...settings,
                          fullBackup: false,
                          customIncludePaths: [
                            ...defaultPaths.savePaths,
                            ...defaultPaths.configPaths,
                          ],
                          customExcludePaths: [...defaultPaths.excludePatterns],
                        });
                      }}
                      disabled={!defaultPaths}
                    >
                      <FaArrowsRotate className="h-3 w-3 mr-1" />
                      Reset to Defaults
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label
                        htmlFor="full-backup"
                        className="text-sm cursor-pointer"
                      >
                        Full backup (entire server directory)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Backs up everything in the server directory. Exclude
                        patterns still apply.
                      </p>
                    </div>
                    <Switch
                      id="full-backup"
                      checked={settings.fullBackup}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, fullBackup: checked })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Include paths</Label>
                      <textarea
                        className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={settings.customIncludePaths.join("\n")}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            customIncludePaths: e.target.value
                              .split("\n")
                              .filter((p) => p.trim()),
                          })
                        }
                        placeholder="e.g. myCustomData/"
                        rows={5}
                        disabled={settings.fullBackup}
                      />
                      <p className="text-xs text-muted-foreground">
                        {settings.fullBackup
                          ? "Disabled — full backup includes all files"
                          : "One path per line, relative to the server directory"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Exclude patterns</Label>
                      <textarea
                        className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={settings.customExcludePaths.join("\n")}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            customExcludePaths: e.target.value
                              .split("\n")
                              .filter((p) => p.trim()),
                          })
                        }
                        placeholder="e.g. **/*.tmp"
                        rows={5}
                      />
                      <p className="text-xs text-muted-foreground">
                        Glob patterns — ** for any depth, * within a segment
                      </p>
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleSaveSettings}
                    disabled={
                      settingsSaving ||
                      JSON.stringify(settings) === JSON.stringify(savedSettings)
                    }
                  >
                    {settingsSaving ? (
                      <FaSpinner className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Save Settings
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Active backup progress ── */}
      {activeProgress && (
        <div className="py-6 border-b">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <FaSpinner className="h-5 w-5 text-primary animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Backup in progress</p>
              <p className="text-xs text-muted-foreground">
                {activeProgress.message}
              </p>
            </div>
            <Badge variant="secondary">{activeProgress.phase}</Badge>
          </div>
        </div>
      )}

      {/* ── Backup list ── */}
      <div className="py-6">
        <div className="flex items-center gap-2 mb-3">
          <FaBoxArchive className="h-4 w-4 text-ring" />
          <span className="text-sm font-medium text-muted-foreground">
            Backup History
          </span>
          {backups.length > 0 && (
            <Badge variant="secondary">{backups.length}</Badge>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <FaArrowsRotate className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : backups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FaBoxArchive className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No backups yet</p>
            <p className="text-xs mt-1">
              Create your first backup to protect your server data.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg border ${
                  backup.status === "failed"
                    ? "bg-destructive/5 border-destructive/30"
                    : backup.status === "success" && backup.fileExists === false
                      ? "bg-yellow-500/5 border-yellow-500/30"
                      : "bg-muted/50 border-border"
                }`}
              >
                {/* Row 1: Status + Info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Status icon */}
                  {backup.status === "success" &&
                  backup.fileExists === false ? (
                    <FaTriangleExclamation className="h-4 w-4 text-yellow-500 shrink-0" />
                  ) : backup.status === "success" ? (
                    <FaCircleCheck className="h-4 w-4 text-green-500 shrink-0" />
                  ) : backup.status === "running" ? (
                    <FaSpinner className="h-4 w-4 text-primary animate-spin shrink-0" />
                  ) : (
                    <FaCircleXmark className="h-4 w-4 text-destructive shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {backup.name ? (
                        <span
                          className="text-sm font-medium truncate"
                          title={backup.name}
                        >
                          {backup.name}
                        </span>
                      ) : (
                        <span
                          className="text-sm font-medium truncate"
                          title={formatDate(backup.timestamp)}
                        >
                          {formatDate(backup.timestamp)}
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {triggerLabels[backup.trigger] || backup.trigger}
                      </Badge>
                      {backup.tag && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0"
                        >
                          <FaTag className="h-2.5 w-2.5" />
                          {backup.tag}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {backup.name && (
                        <span>{formatDate(backup.timestamp)}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <FaClock className="h-3 w-3" />
                        {formatRelativeDate(backup.timestamp)}
                      </span>
                      {backup.sizeBytes != null && (
                        <span className="flex items-center gap-1">
                          <FaHardDrive className="h-3 w-3" />
                          {formatFileSize(backup.sizeBytes)}
                        </span>
                      )}
                      {backup.durationMs != null && (
                        <span>{formatDuration(backup.durationMs)}</span>
                      )}
                      {backup.fileCount != null && (
                        <span>{backup.fileCount} files</span>
                      )}
                    </div>
                    {backup.status === "failed" && backup.errorMessage && (
                      <p className="text-xs text-destructive mt-1">
                        {backup.errorMessage}
                      </p>
                    )}
                    {backup.status === "success" &&
                      backup.fileExists === false && (
                        <p className="text-xs text-yellow-500 mt-1">
                          Backup file missing from disk — deleted externally?
                        </p>
                      )}
                  </div>
                </div>

                {/* Row 2 (mobile) / right side (desktop): Actions */}
                {backup.status === "success" && (
                  <div className="flex items-center gap-1 sm:shrink-0 justify-end sm:justify-start pl-7 sm:pl-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        setRestoreTarget(backup);
                        setPreRestoreBackup(true);
                      }}
                      disabled={
                        !isConnected ||
                        server.status === "running" ||
                        !!activeProgress ||
                        backup.fileExists === false
                      }
                      title={
                        backup.fileExists === false
                          ? "Backup file missing from disk"
                          : server.status === "running"
                            ? "Stop the server before restoring"
                            : "Restore this backup"
                      }
                    >
                      <FaRotateLeft className="h-3 w-3 mr-1" />
                      Restore
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleDownloadBackup(backup)}
                      disabled={!isConnected || backup.fileExists === false}
                      title={
                        backup.fileExists === false
                          ? "Backup file missing from disk"
                          : "Download backup"
                      }
                    >
                      <FaDownload className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditTarget(backup);
                        setEditName(backup.name ?? "");
                        setEditTag(backup.tag ?? "");
                      }}
                      disabled={!isConnected}
                      title="Edit name & tag"
                    >
                      <FaPen className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(backup)}
                      disabled={!isConnected}
                    >
                      <FaTrashCan className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit Backup Dialog ── */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Backup</DialogTitle>
            <DialogDescription>
              Change the display name and tag for this backup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                placeholder={editTarget ? formatDate(editTarget.timestamp) : ""}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                A custom display name. Leave empty to show the timestamp.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tag">Tag</Label>
              <Input
                id="edit-tag"
                placeholder="e.g. before-wipe, stable-v2"
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                A short label to categorize this backup.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? (
                <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FaFloppyDisk className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Backup Dialog ── */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>
              Creates a full backup of saves and configuration files.
              {server.status === "running" &&
                " The server will be stopped during backup and restarted afterwards."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="backup-name">Name (optional)</Label>
              <Input
                id="backup-name"
                placeholder="e.g. Before mod update"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                A descriptive name for this backup.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-tag">Tag (optional)</Label>
              <Input
                id="backup-tag"
                placeholder="e.g. before-wipe, stable-v2"
                value={createTag}
                onChange={(e) => setCreateTag(e.target.value)}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                A short label to identify this backup.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateBackup} disabled={creating}>
              {creating ? (
                <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FaPlus className="h-4 w-4 mr-2" />
              )}
              Create Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Restore Dialog ── */}
      <Dialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Backup</DialogTitle>
            <DialogDescription>
              This will overwrite current server files with the selected backup.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {restoreTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  {formatDate(restoreTarget.timestamp)}
                </p>
                {restoreTarget.tag && (
                  <p>
                    <span className="text-muted-foreground">Tag:</span>{" "}
                    {restoreTarget.tag}
                  </p>
                )}
                {restoreTarget.sizeBytes != null && (
                  <p>
                    <span className="text-muted-foreground">Size:</span>{" "}
                    {formatFileSize(restoreTarget.sizeBytes)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="pre-restore-backup"
                  checked={preRestoreBackup}
                  onCheckedChange={setPreRestoreBackup}
                />
                <Label htmlFor="pre-restore-backup" className="text-sm">
                  Create a safety backup before restoring
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreTarget(null)}
              disabled={restoring}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={restoring}
            >
              {restoring ? (
                <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FaRotateLeft className="h-4 w-4 mr-2" />
              )}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Backup</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this backup? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Date:</span>{" "}
                {formatDate(deleteTarget.timestamp)}
              </p>
              {deleteTarget.tag && (
                <p>
                  <span className="text-muted-foreground">Tag:</span>{" "}
                  {deleteTarget.tag}
                </p>
              )}
              {deleteTarget.sizeBytes != null && (
                <p>
                  <span className="text-muted-foreground">Size:</span>{" "}
                  {formatFileSize(deleteTarget.sizeBytes)}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteBackup}>
              <FaTrashCan className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
