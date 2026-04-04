// Re-export all shared types
export type {
  GameServer,
  SteamConfig,
  ServerMod,
  PlayerSummary,
  LogSettings,
  ServerSchedule,
  ServerMessage,
  ServerVariable,
  UpdateRestartSettings,
  CreateServerRequest,
  SteamCMDStatus,
  BackupMetadata,
  BackupSettings,
  BackupTrigger,
} from "@game-servum/shared";

// Augment IncomingMessage so both Express (req) and WS (info.req) see agentSession
declare module "http" {
  interface IncomingMessage {
    agentSession?: { keyId: number; name: string };
  }
}

// Server-only types (not exposed to client)

export interface PlayerSession {
  id: number;
  serverId: number;
  steamId: string;
  playerName: string;
  characterId: string | null;
  steam64Id: string | null;
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
