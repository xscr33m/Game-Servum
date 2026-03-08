import type {
  SteamCMDStatus,
  GameServer,
  GameDefinition,
  CreateServerRequest,
  SteamLoginRequest,
  SteamGuardRequest,
  ServerMod,
  LogFile,
  ArchiveSession,
  LogSettings,
  SystemMetrics,
  SystemSettings,
  AgentSettings,
  UpdateState,
  AgentSystemInfo,
} from "@/types";
import type { BackendConnection } from "./config";
import { getApiBase } from "./config";

// ── Types for the API client ──

export type FetchApiFn = <T>(
  endpoint: string,
  options?: RequestInit,
) => Promise<T>;

export interface SteamcmdApiClient {
  getStatus: () => Promise<SteamCMDStatus>;
  install: () => Promise<{ success: boolean; message: string }>;
  login: (data: SteamLoginRequest) => Promise<{
    success: boolean;
    requiresGuard: boolean;
    requiresPassword: boolean;
    message: string;
  }>;
  submitGuardCode: (
    data: SteamGuardRequest,
  ) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<{ success: boolean; message: string }>;
}

export interface ServersApiClient {
  getAll: () => Promise<GameServer[]>;
  getById: (id: number) => Promise<GameServer>;
  getAvailableGames: () => Promise<GameDefinition[]>;
  getUsedPorts: () => Promise<
    Array<{
      id: number;
      name: string;
      gameId: string;
      port: number;
      queryPort: number | null;
    }>
  >;
  suggestPorts: (gameId: string) => Promise<{
    port: number;
    queryPort: number | null;
    portsUsed: number[];
  }>;
  checkRequirements: (id: number) => Promise<{
    ready: boolean;
    checks: Array<{
      name: string;
      status: "ok" | "warning" | "error";
      message: string;
      link?: string;
    }>;
  }>;
  create: (
    data: CreateServerRequest,
  ) => Promise<{ server: GameServer; message: string }>;
  start: (id: number) => Promise<{ success: boolean; message: string }>;
  stop: (id: number) => Promise<{ success: boolean; message: string }>;
  updateLaunchParams: (
    id: number,
    launchParams: string,
  ) => Promise<{ success: boolean; message: string }>;
  updateProfilesPath: (
    id: number,
    profilesPath: string,
  ) => Promise<{ success: boolean; message: string }>;
  updatePorts: (
    id: number,
    port: number,
    queryPort: number | null,
  ) => Promise<{ success: boolean; message: string }>;
  updateName: (
    id: number,
    name: string,
  ) => Promise<{ success: boolean; message: string }>;
  updateAutoRestart: (
    id: number,
    autoRestart: boolean,
  ) => Promise<{ success: boolean; message: string }>;
  getSchedule: (
    id: number,
  ) => Promise<{ schedule: import("@/types").ServerSchedule | null }>;
  updateSchedule: (
    id: number,
    schedule: {
      intervalHours: number;
      warningMinutes: number[];
      warningMessage: string;
      enabled: boolean;
    },
  ) => Promise<{
    success: boolean;
    message: string;
    schedule: import("@/types").ServerSchedule;
  }>;
  deleteSchedule: (
    id: number,
  ) => Promise<{ success: boolean; message: string }>;
  getMessages: (
    id: number,
  ) => Promise<{ messages: import("@/types").ServerMessage[] }>;
  createMessage: (
    id: number,
    data: { message: string; intervalMinutes: number; enabled: boolean },
  ) => Promise<{
    success: boolean;
    message: string;
    serverMessage: import("@/types").ServerMessage;
  }>;
  updateMessage: (
    serverId: number,
    messageId: number,
    data: { message: string; intervalMinutes: number; enabled: boolean },
  ) => Promise<{
    success: boolean;
    message: string;
    serverMessage: import("@/types").ServerMessage;
  }>;
  deleteMessage: (
    serverId: number,
    messageId: number,
  ) => Promise<{ success: boolean; message: string }>;
  getBuiltinVariables: () => Promise<{
    variables: Array<{ name: string; description: string }>;
  }>;
  getVariables: (
    id: number,
  ) => Promise<{ variables: import("@/types").ServerVariable[] }>;
  upsertVariable: (
    id: number,
    name: string,
    value: string,
  ) => Promise<{
    success: boolean;
    message: string;
    variable: import("@/types").ServerVariable;
  }>;
  deleteVariable: (
    serverId: number,
    variableId: number,
  ) => Promise<{ success: boolean; message: string }>;
  getUpdateRestart: (
    id: number,
  ) => Promise<import("@/types").UpdateRestartSettings>;
  updateUpdateRestart: (
    id: number,
    settings: Partial<import("@/types").UpdateRestartSettings>,
  ) => Promise<{
    success: boolean;
    message: string;
    settings: import("@/types").UpdateRestartSettings;
  }>;
  checkUpdates: (id: number) => Promise<{
    success: boolean;
    message: string;
    updatedMods: Array<{
      modId: number;
      workshopId: string;
      name: string;
    }>;
    gameUpdateAvailable: boolean;
    latestBuildId?: string;
    steamcmdOutput?: string;
    loginRequired?: boolean;
  }>;
  getDirectories: (id: number) => Promise<{ directories: string[] }>;
  getDiskUsage: (
    id: number,
  ) => Promise<{ sizeBytes: number; sizeFormatted: string }>;
  openFolder: (id: number) => Promise<{ success: boolean; message: string }>;
  cancelInstall: (id: number) => Promise<{ success: boolean; message: string }>;
  delete: (
    id: number,
    confirmName: string,
  ) => Promise<{ success: boolean; message: string }>;
  getConfig: (
    id: number,
  ) => Promise<{ fileName: string; path: string; content: string }>;
  saveConfig: (
    id: number,
    content: string,
  ) => Promise<{ success: boolean; message: string }>;
  getFile: (
    id: number,
    filename: string,
  ) => Promise<{ content: string; exists: boolean }>;
  saveFile: (
    id: number,
    filename: string,
    content: string,
  ) => Promise<{ success: boolean; message: string }>;
  getLogs: (
    id: number,
  ) => Promise<{ current: LogFile[]; archives: ArchiveSession[] }>;
  getLogContent: (
    id: number,
    filename: string,
  ) => Promise<{
    name: string;
    content: string;
    totalLines: number;
    returnedLines: number;
  }>;
  getArchiveFiles: (id: number, session: string) => Promise<LogFile[]>;
  getArchivedLogContent: (
    id: number,
    session: string,
    filename: string,
  ) => Promise<{
    name: string;
    content: string;
    totalLines: number;
    returnedLines: number;
  }>;
  deleteArchive: (
    id: number,
    session: string,
  ) => Promise<{ success: boolean; message: string }>;
  getLogSettings: (id: number) => Promise<LogSettings>;
  updateLogSettings: (
    id: number,
    settings: Partial<Pick<LogSettings, "archiveOnStart" | "retentionDays">>,
  ) => Promise<{ success: boolean; message: string }>;
  getMods: (id: number) => Promise<{
    mods: ServerMod[];
    modParam: string;
    serverModParam: string;
  }>;
  addMod: (
    id: number,
    workshopInput: string,
    isServerMod?: boolean,
  ) => Promise<{ success: boolean; message: string; modId: number }>;
  updateMod: (
    serverId: number,
    modId: number,
    data: { enabled?: boolean; loadOrder?: number },
  ) => Promise<{ success: boolean; message: string }>;
  reinstallMod: (
    serverId: number,
    modId: number,
  ) => Promise<{ success: boolean; message: string }>;
  removeMod: (
    serverId: number,
    modId: number,
  ) => Promise<{ success: boolean; message: string }>;
  reorderMods: (
    serverId: number,
    modIds: number[],
  ) => Promise<{ success: boolean; message: string }>;
  getPlayers: (serverId: number) => Promise<{
    online: Array<{
      steamId: string;
      playerName: string;
      characterId: string | null;
      connectedAt: string;
    }>;
    players: import("@/types").PlayerSummary[];
    onlineCount: number;
  }>;
  addToWhitelist: (
    serverId: number,
    characterId: string,
    playerName?: string,
  ) => Promise<{ success: boolean; message: string }>;
  removeFromWhitelist: (
    serverId: number,
    characterId: string,
  ) => Promise<{ success: boolean; message: string }>;
  addToBanList: (
    serverId: number,
    characterId: string,
    playerName?: string,
  ) => Promise<{ success: boolean; message: string }>;
  removeFromBanList: (
    serverId: number,
    characterId: string,
  ) => Promise<{ success: boolean; message: string }>;
}

export interface SystemApiClient {
  getMetrics: () => Promise<SystemMetrics>;
  getSettings: () => Promise<SystemSettings>;
  updateSettings: (
    settings: Partial<SystemSettings>,
  ) => Promise<{ success: boolean; message: string }>;
  getInfo: () => Promise<AgentSystemInfo>;
  getAgentSettings: () => Promise<AgentSettings>;
  updateAgentSettings: (
    settings: Partial<AgentSettings>,
  ) => Promise<{ success: boolean; message: string }>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<{ success: boolean; message: string }>;
  downloadUpdate: () => Promise<{ success: boolean; message: string }>;
  installUpdate: () => Promise<{ success: boolean; message: string }>;
  restart: () => Promise<{ success: boolean; message: string }>;
  shutdown: () => Promise<{ success: boolean; message: string }>;
}

export interface HealthApiClient {
  check: () => Promise<{ status: string; timestamp: string }>;
}

export interface AuthApiClient {
  connect: (
    apiKey: string,
    password: string,
  ) => Promise<{ token: string; expiresIn: number; message?: string }>;
  refresh: () => Promise<{ token: string; expiresIn: number }>;
}

export interface LogsApiClient {
  getSettings: () => Promise<{
    success: boolean;
    settings: import("@game-servum/shared").LoggerSettings;
  }>;
  updateSettings: (
    settings: Partial<import("@game-servum/shared").LoggerSettings>,
  ) => Promise<{
    success: boolean;
    message: string;
    settings: import("@game-servum/shared").LoggerSettings;
  }>;
  listFiles: () => Promise<{
    success: boolean;
    files: Array<{ name: string; size: number; modified: string }>;
  }>;
  getFileContent: (
    filename: string,
    options?: { lines?: number; tail?: boolean },
  ) => Promise<{ success: boolean; filename: string; content: string }>;
  cleanup: (
    retentionDays: number,
  ) => Promise<{ success: boolean; message: string; deletedCount: number }>;
  deleteFile: (
    filename: string,
  ) => Promise<{ success: boolean; message: string }>;
}

export interface ApiClient {
  steamcmd: SteamcmdApiClient;
  servers: ServersApiClient;
  system: SystemApiClient;
  health: HealthApiClient;
  auth: AuthApiClient;
  logs: LogsApiClient;
}

// ── API Client Factory ──

/**
 * Creates a fetch function scoped to a backend connection.
 * In embedded mode (no connection), falls back to same-origin.
 */
function createFetchApi(
  connection?: BackendConnection | null,
  getToken?: () => string | undefined,
): FetchApiFn {
  const baseUrl = getApiBase(connection);

  return async function fetchApi<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Use dynamic token getter if provided, otherwise fall back to connection snapshot
    const token = getToken ? getToken() : connection?.sessionToken;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
          ...headers,
          ...(options?.headers as Record<string, string>),
        },
      });
    } catch {
      // Network-level failure (agent unreachable, DNS failure, CORS, etc.)
      throw new Error("Agent not reachable — check connection");
    }

    if (response.status === 401) {
      throw new ApiAuthError("Invalid or expired session token");
    }

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  };
}

export class ApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiAuthError";
  }
}

function createSteamcmdApi(fetchApi: FetchApiFn): SteamcmdApiClient {
  return {
    getStatus: () => fetchApi<SteamCMDStatus>("/steamcmd/status"),
    install: () =>
      fetchApi<{ success: boolean; message: string }>("/steamcmd/install", {
        method: "POST",
      }),
    login: (data: SteamLoginRequest) =>
      fetchApi<{
        success: boolean;
        requiresGuard: boolean;
        requiresPassword: boolean;
        message: string;
      }>("/steamcmd/login", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    submitGuardCode: (data: SteamGuardRequest) =>
      fetchApi<{ success: boolean; message: string }>("/steamcmd/steam-guard", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    logout: () =>
      fetchApi<{ success: boolean; message: string }>("/steamcmd/logout", {
        method: "POST",
      }),
  };
}

function createServersApi(fetchApi: FetchApiFn): ServersApiClient {
  return {
    getAll: () => fetchApi<GameServer[]>("/servers"),
    getById: (id: number) => fetchApi<GameServer>(`/servers/${id}`),
    getAvailableGames: () => fetchApi<GameDefinition[]>("/servers/games"),
    getUsedPorts: () =>
      fetchApi<
        Array<{
          id: number;
          name: string;
          gameId: string;
          port: number;
          queryPort: number | null;
        }>
      >("/servers/used-ports"),
    suggestPorts: (gameId: string) =>
      fetchApi<{
        port: number;
        queryPort: number | null;
        portsUsed: number[];
      }>(`/servers/suggest-ports?gameId=${gameId}`),
    checkRequirements: (id: number) =>
      fetchApi<{
        ready: boolean;
        checks: Array<{
          name: string;
          status: "ok" | "warning" | "error";
          message: string;
          link?: string;
        }>;
      }>(`/servers/${id}/check`),
    create: (data: CreateServerRequest) =>
      fetchApi<{ server: GameServer; message: string }>("/servers", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    start: (id: number) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}/start`, {
        method: "POST",
      }),
    stop: (id: number) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}/stop`, {
        method: "POST",
      }),
    updateLaunchParams: (id: number, launchParams: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/launch-params`,
        {
          method: "PUT",
          body: JSON.stringify({ launchParams }),
        },
      ),
    updateProfilesPath: (id: number, profilesPath: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/profiles-path`,
        {
          method: "PUT",
          body: JSON.stringify({ profilesPath }),
        },
      ),
    updatePorts: (id: number, port: number, queryPort: number | null) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}/ports`, {
        method: "PUT",
        body: JSON.stringify({ port, queryPort }),
      }),
    updateName: (id: number, name: string) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}/name`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    updateAutoRestart: (id: number, autoRestart: boolean) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/auto-restart`,
        {
          method: "PUT",
          body: JSON.stringify({ autoRestart }),
        },
      ),
    getSchedule: (id: number) =>
      fetchApi<{ schedule: import("@/types").ServerSchedule | null }>(
        `/servers/${id}/schedule`,
      ),
    updateSchedule: (
      id: number,
      schedule: {
        intervalHours: number;
        warningMinutes: number[];
        warningMessage: string;
        enabled: boolean;
      },
    ) =>
      fetchApi<{
        success: boolean;
        message: string;
        schedule: import("@/types").ServerSchedule;
      }>(`/servers/${id}/schedule`, {
        method: "PUT",
        body: JSON.stringify(schedule),
      }),
    deleteSchedule: (id: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/schedule`,
        {
          method: "DELETE",
        },
      ),
    getMessages: (id: number) =>
      fetchApi<{ messages: import("@/types").ServerMessage[] }>(
        `/servers/${id}/messages`,
      ),
    createMessage: (
      id: number,
      data: { message: string; intervalMinutes: number; enabled: boolean },
    ) =>
      fetchApi<{
        success: boolean;
        message: string;
        serverMessage: import("@/types").ServerMessage;
      }>(`/servers/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateMessage: (
      serverId: number,
      messageId: number,
      data: { message: string; intervalMinutes: number; enabled: boolean },
    ) =>
      fetchApi<{
        success: boolean;
        message: string;
        serverMessage: import("@/types").ServerMessage;
      }>(`/servers/${serverId}/messages/${messageId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    deleteMessage: (serverId: number, messageId: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/messages/${messageId}`,
        { method: "DELETE" },
      ),
    getBuiltinVariables: () =>
      fetchApi<{
        variables: Array<{ name: string; description: string }>;
      }>("/servers/variables/builtins"),
    getVariables: (id: number) =>
      fetchApi<{ variables: import("@/types").ServerVariable[] }>(
        `/servers/${id}/variables`,
      ),
    upsertVariable: (id: number, name: string, value: string) =>
      fetchApi<{
        success: boolean;
        message: string;
        variable: import("@/types").ServerVariable;
      }>(`/servers/${id}/variables`, {
        method: "PUT",
        body: JSON.stringify({ name, value }),
      }),
    deleteVariable: (serverId: number, variableId: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/variables/${variableId}`,
        { method: "DELETE" },
      ),
    getUpdateRestart: (id: number) =>
      fetchApi<import("@/types").UpdateRestartSettings>(
        `/servers/${id}/update-restart`,
      ),
    updateUpdateRestart: (
      id: number,
      settings: Partial<import("@/types").UpdateRestartSettings>,
    ) =>
      fetchApi<{
        success: boolean;
        message: string;
        settings: import("@/types").UpdateRestartSettings;
      }>(`/servers/${id}/update-restart`, {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
    checkUpdates: (id: number) =>
      fetchApi<{
        success: boolean;
        message: string;
        updatedMods: Array<{
          modId: number;
          workshopId: string;
          name: string;
        }>;
        gameUpdateAvailable: boolean;
        latestBuildId?: string;
        steamcmdOutput?: string;
        loginRequired?: boolean;
      }>(`/servers/${id}/check-updates`, {
        method: "POST",
      }),
    getDirectories: (id: number) =>
      fetchApi<{ directories: string[] }>(`/servers/${id}/directories`),
    getDiskUsage: (id: number) =>
      fetchApi<{ sizeBytes: number; sizeFormatted: string }>(
        `/servers/${id}/disk-usage`,
      ),
    openFolder: (id: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/open-folder`,
        { method: "POST" },
      ),
    cancelInstall: (id: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/cancel-install`,
        {
          method: "POST",
        },
      ),
    delete: (id: number, confirmName: string) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName }),
      }),
    getConfig: (id: number) =>
      fetchApi<{ fileName: string; path: string; content: string }>(
        `/servers/${id}/config`,
      ),
    saveConfig: (id: number, content: string) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}/config`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    getFile: (id: number, filename: string) =>
      fetchApi<{ content: string; exists: boolean }>(
        `/servers/${id}/files/${filename}`,
      ),
    saveFile: (id: number, filename: string, content: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/files/${filename}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      ),
    getLogs: (id: number) =>
      fetchApi<{ current: LogFile[]; archives: ArchiveSession[] }>(
        `/servers/${id}/logs`,
      ),
    getLogContent: (id: number, filename: string) =>
      fetchApi<{
        name: string;
        content: string;
        totalLines: number;
        returnedLines: number;
      }>(`/servers/${id}/logs/content/${filename}`),
    getArchiveFiles: (id: number, session: string) =>
      fetchApi<LogFile[]>(`/servers/${id}/logs/archive/${session}`),
    getArchivedLogContent: (id: number, session: string, filename: string) =>
      fetchApi<{
        name: string;
        content: string;
        totalLines: number;
        returnedLines: number;
      }>(`/servers/${id}/logs/archive/${session}/${filename}`),
    deleteArchive: (id: number, session: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/logs/archive/${session}`,
        { method: "DELETE" },
      ),
    getLogSettings: (id: number) =>
      fetchApi<LogSettings>(`/servers/${id}/logs/settings`),
    updateLogSettings: (
      id: number,
      settings: Partial<Pick<LogSettings, "archiveOnStart" | "retentionDays">>,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/logs/settings`,
        {
          method: "PUT",
          body: JSON.stringify(settings),
        },
      ),
    getMods: (id: number) =>
      fetchApi<{
        mods: ServerMod[];
        modParam: string;
        serverModParam: string;
      }>(`/servers/${id}/mods`),
    addMod: (id: number, workshopInput: string, isServerMod = false) =>
      fetchApi<{ success: boolean; message: string; modId: number }>(
        `/servers/${id}/mods`,
        {
          method: "POST",
          body: JSON.stringify({ workshopInput, isServerMod }),
        },
      ),
    updateMod: (
      serverId: number,
      modId: number,
      data: { enabled?: boolean; loadOrder?: number },
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/mods/${modId}`,
        {
          method: "PUT",
          body: JSON.stringify(data),
        },
      ),
    reinstallMod: (serverId: number, modId: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/mods/${modId}/reinstall`,
        {
          method: "POST",
        },
      ),
    removeMod: (serverId: number, modId: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/mods/${modId}`,
        {
          method: "DELETE",
        },
      ),
    reorderMods: (serverId: number, modIds: number[]) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/mods/reorder`,
        {
          method: "POST",
          body: JSON.stringify({ modIds }),
        },
      ),
    getPlayers: (serverId: number) =>
      fetchApi<{
        online: Array<{
          steamId: string;
          playerName: string;
          characterId: string | null;
          connectedAt: string;
        }>;
        players: import("@/types").PlayerSummary[];
        onlineCount: number;
      }>(`/servers/${serverId}/players`),
    addToWhitelist: (
      serverId: number,
      characterId: string,
      playerName?: string,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/whitelist`,
        {
          method: "POST",
          body: JSON.stringify({ characterId, playerName }),
        },
      ),
    removeFromWhitelist: (serverId: number, characterId: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/whitelist`,
        {
          method: "DELETE",
          body: JSON.stringify({ characterId }),
        },
      ),
    addToBanList: (
      serverId: number,
      characterId: string,
      playerName?: string,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/ban`,
        {
          method: "POST",
          body: JSON.stringify({ characterId, playerName }),
        },
      ),
    removeFromBanList: (serverId: number, characterId: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/ban`,
        {
          method: "DELETE",
          body: JSON.stringify({ characterId }),
        },
      ),
  };
}

function createSystemApi(fetchApi: FetchApiFn): SystemApiClient {
  return {
    getMetrics: () => fetchApi<SystemMetrics>("/system/metrics"),
    getSettings: () => fetchApi<SystemSettings>("/system/settings"),
    updateSettings: (settings: Partial<SystemSettings>) =>
      fetchApi<{ success: boolean; message: string }>("/system/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
    getInfo: () => fetchApi<AgentSystemInfo>("/system/info"),
    getAgentSettings: () => fetchApi<AgentSettings>("/system/agent-settings"),
    updateAgentSettings: (settings: Partial<AgentSettings>) =>
      fetchApi<{ success: boolean; message: string }>(
        "/system/agent-settings",
        {
          method: "PUT",
          body: JSON.stringify(settings),
        },
      ),
    getUpdateState: () => fetchApi<UpdateState>("/system/updater/status"),
    checkForUpdates: () =>
      fetchApi<{ success: boolean; message: string }>("/system/updater/check", {
        method: "POST",
      }),
    downloadUpdate: () =>
      fetchApi<{ success: boolean; message: string }>(
        "/system/updater/download",
        {
          method: "POST",
        },
      ),
    installUpdate: () =>
      fetchApi<{ success: boolean; message: string }>(
        "/system/updater/install",
        {
          method: "POST",
        },
      ),
    restart: () =>
      fetchApi<{ success: boolean; message: string }>("/system/restart", {
        method: "POST",
      }),
    shutdown: () =>
      fetchApi<{ success: boolean; message: string }>("/system/shutdown", {
        method: "POST",
      }),
  };
}

function createHealthApi(fetchApi: FetchApiFn): HealthApiClient {
  return {
    check: () => fetchApi<{ status: string; timestamp: string }>("/health"),
  };
}

function createAuthApi(fetchApi: FetchApiFn): AuthApiClient {
  return {
    connect: (apiKey: string, password: string) =>
      fetchApi<{ token: string; expiresIn: number; message?: string }>(
        "/auth/connect",
        {
          method: "POST",
          body: JSON.stringify({ apiKey, password }),
        },
      ),
    refresh: () =>
      fetchApi<{ token: string; expiresIn: number }>("/auth/refresh", {
        method: "POST",
      }),
  };
}

function createLogsApi(fetchApi: FetchApiFn): LogsApiClient {
  return {
    getSettings: () =>
      fetchApi<{
        success: boolean;
        settings: import("@game-servum/shared").LoggerSettings;
      }>("/logs/settings"),
    updateSettings: (
      settings: Partial<import("@game-servum/shared").LoggerSettings>,
    ) =>
      fetchApi<{
        success: boolean;
        message: string;
        settings: import("@game-servum/shared").LoggerSettings;
      }>("/logs/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
    listFiles: () =>
      fetchApi<{
        success: boolean;
        files: Array<{ name: string; size: number; modified: string }>;
      }>("/logs/files"),
    getFileContent: (
      filename: string,
      options?: { lines?: number; tail?: boolean },
    ) => {
      const params = new URLSearchParams();
      if (options?.lines) params.append("lines", options.lines.toString());
      if (options?.tail) params.append("tail", "true");
      const query = params.toString();
      return fetchApi<{ success: boolean; filename: string; content: string }>(
        `/logs/files/${filename}${query ? `?${query}` : ""}`,
      );
    },
    cleanup: (retentionDays: number) =>
      fetchApi<{ success: boolean; message: string; deletedCount: number }>(
        "/logs/cleanup",
        {
          method: "POST",
          body: JSON.stringify({ retentionDays }),
        },
      ),
    deleteFile: (filename: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/logs/files/${filename}`,
        {
          method: "DELETE",
        },
      ),
  };
}

/**
 * Create a complete API client for a specific backend connection.
 * In embedded mode, pass null/undefined for same-origin behavior.
 * @param connection - The backend connection (optional for embedded mode)
 * @param getToken - Optional callback to dynamically get the current token
 */
export function createApiClient(
  connection?: BackendConnection | null,
  getToken?: () => string | undefined,
): ApiClient {
  const fetchApi = createFetchApi(connection, getToken);
  return {
    steamcmd: createSteamcmdApi(fetchApi),
    servers: createServersApi(fetchApi),
    system: createSystemApi(fetchApi),
    health: createHealthApi(fetchApi),
    auth: createAuthApi(fetchApi),
    logs: createLogsApi(fetchApi),
  };
}

// ── Backward-compatible static exports ──
// These use the default (same-origin) API client.
// Components should migrate to useBackend() context hook over time.

const defaultClient = createApiClient();

export const steamcmdApi = defaultClient.steamcmd;
export const serversApi = defaultClient.servers;
export const systemApi = defaultClient.system;
export const healthApi = defaultClient.health;
