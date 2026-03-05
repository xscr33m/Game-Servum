// Log management settings
export interface LogSettings {
  serverId: number;
  archiveOnStart: boolean;
  retentionDays: number;
}

// Update restart settings (auto-restart on mod/game update)
export interface UpdateRestartSettings {
  serverId: number;
  enabled: boolean;
  delayMinutes: number;
  warningMinutes: number[];
  warningMessage: string;
  checkIntervalMinutes: number;
  checkGameUpdates: boolean;
}
