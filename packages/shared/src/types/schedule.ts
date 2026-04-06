// Scheduled restart configuration
export interface ServerSchedule {
  id: number;
  serverId: number;
  intervalHours: number;
  /** Optional time-of-day anchor in "HH:mm" format (e.g. "06:00"). When set,
   *  restarts occur at fixed clock times starting from this time, repeating
   *  every `intervalHours`. When null, restarts are purely interval-based. */
  restartTime: string | null;
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
