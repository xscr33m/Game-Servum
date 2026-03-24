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
  AgentSettings,
  UpdateState,
  ApiResponse,
  FirewallRuleDefinition,
  FirewallRuleStatus,
  FirewallStatus,
  FirewallResult,
  GameCapabilities,
  RconProtocol,
  BackupMetadata,
  BackupSettings,
  BackupProgress,
  BackupStatus,
  BackupTrigger,
} from "@game-servum/shared";

// Client-only types

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
