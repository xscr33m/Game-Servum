// Re-export all shared types
export type {
  GameServer,
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
  SteamCMDStatus,
  WSMessage,
  SystemMetrics,
  SystemSettings,
  AgentSettings,
  UpdateState,
  FirewallStatus,
  GameCapabilities,
  BackupMetadata,
  BackupSettings,
  BackupProgress,
} from "@game-servum/shared";

// Used via inline import("@/types").FirewallResult in api.ts — fallow can't trace dynamic type references
export type { FirewallResult } from "@game-servum/shared";

// Client-only types

// Backend connection model for multi-agent support
export interface BackendConnection {
  id: string;
  name: string;
  url: string; // z.B. "http://192.168.1.100:3001"
  apiKey: string;
  password: string; // stored in plaintext locally
  sessionToken?: string;
  tokenExpiresAt?: number;
  isActive: boolean;
  status?:
    | "connected"
    | "disconnected"
    | "error"
    | "authenticating"
    | "reconnecting"
    | "updating"
    | "restarting";
  reconnectAttempts?: number; // Track number of reconnection attempts
  lastError?: string; // Last error message for UI display
  statusUpdatedAt?: number; // Timestamp when status was last set (for stale status detection)
  agentInfo?: {
    version: string;
    hostname: string;
    platform: string;
    serverCount: number;
    compatibilityWarning?: string;
  };
}

// Agent system info (from /api/v1/system/info)
export interface AgentSystemInfo {
  version: string;
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  uptime: number;
  osUptime: number;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  freeMemory: number;
}

// Log management
export interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export interface ArchiveSession {
  name: string;
  date: string;
  fileCount: number;
  totalSize: number;
}

// Game definition (for available games list)
export interface GameDefinition {
  id: string;
  name: string;
  logo: string;
  appId: number;
  workshopAppId?: number;
  defaultPort: number;
  portCount: number;
  portStride?: number;
  queryPortOffset?: number;
  requiresLogin: boolean;
  description: string;
  defaultLaunchParams: string;
  firewallRules?: import("@game-servum/shared").FirewallRuleDefinition[];
  capabilities: import("@game-servum/shared").GameCapabilities;
}
