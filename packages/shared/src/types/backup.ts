// Backup & Restore types

export type BackupStatus = "running" | "success" | "failed";

export type BackupTrigger =
  | "manual"
  | "pre-restart"
  | "pre-update"
  | "pre-restore";

export interface BackupMetadata {
  id: string;
  serverId: number;
  gameId: string;
  serverName: string;
  timestamp: string;
  tag: string | null;
  trigger: BackupTrigger;
  status: BackupStatus;
  sizeBytes: number | null;
  fileCount: number | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface BackupSettings {
  serverId: number;
  enabled: boolean;
  backupBeforeRestart: boolean;
  backupBeforeUpdate: boolean;
  retentionCount: number;
  retentionDays: number;
  customIncludePaths: string[];
  customExcludePaths: string[];
}

export interface BackupProgress {
  serverId: number;
  backupId: string;
  phase: "stopping" | "archiving" | "starting" | "cleanup";
  percent: number | null;
  message: string;
}
