// Scheduled restart configuration
export interface ServerSchedule {
  id: number;
  serverId: number;
  intervalHours: number;
  warningMinutes: number[];
  warningMessage: string;
  enabled: boolean;
  lastRestart: string | null;
  nextRestart: string | null;
}

// Scheduled RCON messages
export interface ServerMessage {
  id: number;
  serverId: number;
  message: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
}

// Custom template variables for messages
export interface ServerVariable {
  id: number;
  serverId: number;
  name: string;
  value: string;
}
