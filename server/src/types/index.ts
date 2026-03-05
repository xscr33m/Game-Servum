// Re-export all shared types
export type {
  ServerStatus,
  GameServer,
  SteamConfig,
  ModStatus,
  ServerMod,
  PlayerSummary,
  LogSettings,
  ServerSchedule,
  ServerMessage,
  ServerVariable,
  UpdateRestartSettings,
  CreateServerRequest,
  SteamLoginRequest,
  SteamGuardRequest,
  LoginState,
  SteamCMDStatus,
  WSMessageType,
  WSMessage,
  SystemMetrics,
  SystemSettings,
  ApiResponse,
} from "@game-servum/shared";

// Server-only types (not exposed to client)

export interface PlayerSession {
  id: number;
  serverId: number;
  steamId: string;
  playerName: string;
  characterId: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  isOnline: boolean;
}

// App configuration (server-side only)
export interface AppConfig {
  steamcmdPath: string;
  serversPath: string;
  dataPath: string;
  logsPath: string;
  port: number;
  host: string;
  corsOrigins: string;
  authEnabled: boolean;
  jwtSecret: string;
}
