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
} from "react-icons/fa6";
import { Card, CardContent } from "@/components/ui/card";
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

  // Create backup dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
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
      await api.servers.createBackup(server.id, createTag || undefined);
      setShowCreateDialog(false);
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
      }
      toastSuccess("Backup settings saved");
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FaBoxArchive className="h-4 w-4 text-ring/70" />
            Backups
          </h2>
          <p className="text-sm text-muted-foreground">
            {successfulBackups.length} backup
            {successfulBackups.length !== 1 ? "s" : ""}
            {totalSize > 0 && ` · ${formatFileSize(totalSize)} total`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowSettings(true);
              loadSettings();
            }}
            disabled={!isConnected}
          >
            <FaGear className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadBackups()}
            disabled={!isConnected}
          >
            <FaArrowsRotate className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            disabled={!isConnected || !!activeProgress}
          >
            <FaPlus className="h-4 w-4 mr-2" />
            Create Backup
          </Button>
        </div>
      </div>

      {/* Active backup progress */}
      {activeProgress && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <FaSpinner className="h-5 w-5 text-primary animate-spin" />
              <div className="flex-1">
                <p className="text-sm font-medium">Backup in progress</p>
                <p className="text-xs text-muted-foreground">
                  {activeProgress.message}
                </p>
              </div>
              <Badge variant="secondary">{activeProgress.phase}</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <FaArrowsRotate className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : backups.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FaBoxArchive className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">No backups yet</p>
              <p className="text-sm mt-1">
                Create your first backup to protect your server data.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {backups.map((backup) => (
            <Card key={backup.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Status icon */}
                    {backup.status === "success" ? (
                      <FaCircleCheck className="h-5 w-5 text-green-500 shrink-0" />
                    ) : backup.status === "running" ? (
                      <FaSpinner className="h-5 w-5 text-primary animate-spin shrink-0" />
                    ) : (
                      <FaCircleXmark className="h-5 w-5 text-destructive shrink-0" />
                    )}

                    {/* Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-medium truncate"
                          title={formatDate(backup.timestamp)}
                        >
                          {formatDate(backup.timestamp)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {triggerLabels[backup.trigger] || backup.trigger}
                        </Badge>
                        {backup.tag && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <FaTag className="h-3 w-3" />
                            {backup.tag}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
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
                    </div>
                  </div>

                  {/* Actions */}
                  {backup.status === "success" && (
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRestoreTarget(backup);
                          setPreRestoreBackup(true);
                        }}
                        disabled={
                          !isConnected ||
                          server.status === "running" ||
                          !!activeProgress
                        }
                        title={
                          server.status === "running"
                            ? "Stop the server before restoring"
                            : "Restore this backup"
                        }
                      >
                        <FaRotateLeft className="h-4 w-4 mr-2" />
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(backup)}
                        disabled={!isConnected}
                      >
                        <FaTrashCan className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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

      {/* ── Settings Dialog ── */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Backup Settings</DialogTitle>
            <DialogDescription>
              Configure automatic backup triggers and retention policies.
            </DialogDescription>
          </DialogHeader>
          {settingsLoading || !settings ? (
            <div className="flex items-center justify-center py-8">
              <FaSpinner className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6 py-2">
              {/* Automatic triggers */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Automatic Backups</h3>
                <div className="flex items-center justify-between">
                  <Label htmlFor="backup-before-restart" className="text-sm">
                    Backup before scheduled restart
                  </Label>
                  <Switch
                    id="backup-before-restart"
                    checked={settings.backupBeforeRestart}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, backupBeforeRestart: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="backup-before-update" className="text-sm">
                    Backup before auto-update
                  </Label>
                  <Switch
                    id="backup-before-update"
                    checked={settings.backupBeforeUpdate}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, backupBeforeUpdate: checked })
                    }
                  />
                </div>
              </div>

              {/* Retention */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Retention</h3>
                <div className="grid grid-cols-2 gap-4">
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

              {/* Custom paths */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Custom Paths</h3>
                <div className="space-y-2">
                  <Label className="text-sm">
                    Additional include paths (one per line)
                  </Label>
                  <textarea
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">
                    Additional exclude patterns (one per line)
                  </Label>
                  <textarea
                    className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    rows={3}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSettings}
              disabled={settingsSaving || settingsLoading}
            >
              {settingsSaving ? (
                <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FaFloppyDisk className="h-4 w-4 mr-2" />
              )}
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
