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
import type { BackendConnection } from "@/types";
import { getApiBase } from "./config";

// ── Types for the API client ──

export interface BrowseTreeEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  editable?: boolean;
  children?: BrowseTreeEntry[];
}

export interface BrowseListEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  editable?: boolean;
  hasChildren?: boolean;
}

type FetchApiFn = <T>(endpoint: string, options?: RequestInit) => Promise<T>;

interface SteamcmdApiClient {
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

interface ServersApiClient {
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
      restartTime?: string | null;
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
  getInstallStatus: (id: number) => Promise<{
    installing: boolean;
    percent: number;
    status: string;
    message: string;
    output: string[];
  }>;
  getFirewallStatus: (id: number) => Promise<import("@/types").FirewallStatus>;
  addFirewallRules: (id: number) => Promise<import("@/types").FirewallResult>;
  removeFirewallRules: (
    id: number,
  ) => Promise<import("@/types").FirewallResult>;
  delete: (
    id: number,
    confirmName: string,
    deleteBackups?: boolean,
  ) => Promise<{ success: boolean; message: string }>;
  getConfig: (
    id: number,
    file?: string,
  ) => Promise<{
    fileName: string;
    path: string;
    content: string;
    configFiles?: string[];
  }>;
  getConfigStatus: (id: number) => Promise<{
    configGenerated: boolean;
    configFiles: string[];
    existingFiles: string[];
  }>;
  saveInitialSettings: (
    id: number,
    settings: {
      sessionName?: string;
      adminPassword?: string;
      serverPassword?: string;
      maxPlayers?: number;
      map?: string;
    },
  ) => Promise<{ success: boolean; message: string }>;
  saveConfig: (
    id: number,
    content: string,
    file?: string,
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
  cancelModInstall: (
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
  exportModList: (
    serverId: number,
    includeDisabled?: boolean,
  ) => Promise<{
    success: boolean;
    message: string;
    modListWritten: boolean;
    serverModListWritten: boolean;
    backups: { modList: string | null; serverModList: string | null };
  }>;
  importModList: (serverId: number) => Promise<{
    success: boolean;
    message: string;
    imported: number;
    skipped: number;
  }>;
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
  getWhitelistContent: (serverId: number) => Promise<{ content: string }>;
  getBanContent: (serverId: number) => Promise<{ content: string }>;
  addToPriority: (
    serverId: number,
    steamId: string,
    playerName?: string,
  ) => Promise<{ success: boolean; message: string }>;
  removeFromPriority: (
    serverId: number,
    steamId: string,
  ) => Promise<{ success: boolean; message: string }>;
  getPriorityContent: (serverId: number) => Promise<{ content: string }>;
  sendDirectMessage: (
    serverId: number,
    playerId: string,
    playerName: string,
    message: string,
  ) => Promise<{ success: boolean; message: string }>;
  // File browser
  browseRoots: (
    id: number,
  ) => Promise<{ roots: Array<{ key: string; label: string }> }>;
  browseTree: (
    id: number,
    rootKey: string,
  ) => Promise<{
    root: string;
    tree: BrowseTreeEntry[];
  }>;
  browseList: (
    id: number,
    rootKey: string,
    dirPath?: string,
  ) => Promise<{
    path: string;
    entries: BrowseListEntry[];
  }>;
  browseReadFile: (
    id: number,
    rootKey: string,
    filePath: string,
  ) => Promise<{ content: string; size: number; path: string }>;
  browseWriteFile: (
    id: number,
    rootKey: string,
    filePath: string,
    content: string,
  ) => Promise<{ success: boolean; message: string }>;
  browseCreateFile: (
    id: number,
    rootKey: string,
    filePath: string,
    content?: string,
  ) => Promise<{ success: boolean; message: string }>;
  browseDeleteFile: (
    id: number,
    rootKey: string,
    filePath: string,
  ) => Promise<{ success: boolean; message: string }>;
  browseCreateDirectory: (
    id: number,
    rootKey: string,
    dirPath: string,
  ) => Promise<{ success: boolean; message: string }>;
  browseDeleteDirectory: (
    id: number,
    rootKey: string,
    dirPath: string,
  ) => Promise<{ success: boolean; message: string }>;
  browseRename: (
    id: number,
    rootKey: string,
    from: string,
    to: string,
  ) => Promise<{ success: boolean; message: string }>;
  browseDownloadUrl: (id: number, rootKey: string, filePath: string) => string;
  browseDownload: (
    id: number,
    rootKey: string,
    filePath: string,
  ) => Promise<void>;
  browseUpload: (
    id: number,
    rootKey: string,
    targetPath: string,
    files: File[],
  ) => Promise<{
    success: boolean;
    message: string;
    files: string[];
    warnings?: string[];
  }>;
  // Backups
  getBackups: (
    id: number,
  ) => Promise<{ backups: import("@/types").BackupMetadata[] }>;
  createBackup: (
    id: number,
    name?: string,
    tag?: string,
  ) => Promise<{ success: boolean; message: string }>;
  deleteBackup: (
    serverId: number,
    backupId: string,
  ) => Promise<{ success: boolean; message: string }>;
  updateBackup: (
    serverId: number,
    backupId: string,
    updates: { name?: string | null; tag?: string | null },
  ) => Promise<{ success: boolean }>;
  restoreBackup: (
    serverId: number,
    backupId: string,
    preRestoreBackup?: boolean,
  ) => Promise<{ success: boolean; message: string }>;
  downloadBackup: (serverId: number, backupId: string) => Promise<void>;
  getBackupSettings: (id: number) => Promise<{
    settings: import("@/types").BackupSettings;
    defaultPaths: {
      savePaths: string[];
      configPaths: string[];
      excludePatterns: string[];
    };
  }>;
  updateBackupSettings: (
    id: number,
    settings: Partial<import("@/types").BackupSettings>,
  ) => Promise<{
    success: boolean;
    settings: import("@/types").BackupSettings;
  }>;
}

interface SystemApiClient {
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
  getStatsSettings: () => Promise<{ enabled: boolean; agentId: string | null }>;
  updateStatsSettings: (settings: {
    enabled: boolean;
  }) => Promise<{ success: boolean; message: string }>;
}

interface HealthApiClient {
  check: () => Promise<{ status: string; timestamp: string }>;
}

interface AuthApiClient {
  connect: (
    apiKey: string,
    password: string,
  ) => Promise<{ token: string; expiresIn: number; message?: string }>;
  refresh: () => Promise<{ token: string; expiresIn: number }>;
}

interface LogsApiClient {
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
      await handleUnauthorized(response);
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

class ApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/**
 * Handle a 401 response — distinguishes Commander session expiry from Agent token expiry
 * in web/Docker mode, and throws the appropriate ApiAuthError.
 */
async function handleUnauthorized(response: Response): Promise<never> {
  if (import.meta.env.VITE_WEB_MODE === "true") {
    try {
      const body = await response.clone().json();
      const msg = body?.message || "";
      if (msg === "Not authenticated" || msg === "Invalid or expired session") {
        window.dispatchEvent(new CustomEvent("commander:session-expired"));
        throw new ApiAuthError(
          "Commander session expired — please log in again",
        );
      }
    } catch (e) {
      if (e instanceof ApiAuthError) throw e;
    }
  }
  throw new ApiAuthError("Invalid or expired session token");
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

function createServersApi(
  fetchApi: FetchApiFn,
  baseUrl: string,
  getToken?: () => string | undefined,
): ServersApiClient {
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
        restartTime?: string | null;
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
    getInstallStatus: (id: number) =>
      fetchApi<{
        installing: boolean;
        percent: number;
        status: string;
        message: string;
        output: string[];
      }>(`/servers/${id}/install-status`),
    getFirewallStatus: (id: number) =>
      fetchApi<import("@/types").FirewallStatus>(`/servers/${id}/firewall`),
    addFirewallRules: (id: number) =>
      fetchApi<import("@/types").FirewallResult>(`/servers/${id}/firewall`, {
        method: "POST",
      }),
    removeFirewallRules: (id: number) =>
      fetchApi<import("@/types").FirewallResult>(`/servers/${id}/firewall`, {
        method: "DELETE",
      }),
    delete: (id: number, confirmName: string, deleteBackups?: boolean) =>
      fetchApi<{ success: boolean; message: string }>(`/servers/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmName, deleteBackups }),
      }),
    getConfig: (id: number, file?: string) =>
      fetchApi<{
        fileName: string;
        path: string;
        content: string;
        configFiles?: string[];
      }>(
        `/servers/${id}/config${file ? `?file=${encodeURIComponent(file)}` : ""}`,
      ),
    getConfigStatus: (id: number) =>
      fetchApi<{
        configGenerated: boolean;
        configFiles: string[];
        existingFiles: string[];
      }>(`/servers/${id}/config-status`),
    saveInitialSettings: (
      id: number,
      settings: {
        sessionName?: string;
        adminPassword?: string;
        serverPassword?: string;
        maxPlayers?: number;
        map?: string;
      },
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/initial-settings`,
        {
          method: "PUT",
          body: JSON.stringify(settings),
        },
      ),
    saveConfig: (id: number, content: string, file?: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/config${file ? `?file=${encodeURIComponent(file)}` : ""}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      ),
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
    cancelModInstall: (serverId: number, modId: number) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/mods/${modId}/cancel`,
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
    exportModList: (serverId: number, includeDisabled?: boolean) =>
      fetchApi<{
        success: boolean;
        message: string;
        modListWritten: boolean;
        serverModListWritten: boolean;
        backups: { modList: string | null; serverModList: string | null };
      }>(`/servers/${serverId}/mods/export-modlist`, {
        method: "POST",
        body: JSON.stringify({ includeDisabled: includeDisabled ?? false }),
      }),
    importModList: (serverId: number) =>
      fetchApi<{
        success: boolean;
        message: string;
        imported: number;
        skipped: number;
      }>(`/servers/${serverId}/mods/import-modlist`, {
        method: "POST",
      }),
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
    getWhitelistContent: (serverId: number) =>
      fetchApi<{ content: string }>(
        `/servers/${serverId}/players/whitelist-content`,
      ),
    getBanContent: (serverId: number) =>
      fetchApi<{ content: string }>(`/servers/${serverId}/players/ban-content`),
    addToPriority: (serverId: number, steamId: string, playerName?: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/priority`,
        {
          method: "POST",
          body: JSON.stringify({ steamId, playerName }),
        },
      ),
    removeFromPriority: (serverId: number, steamId: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/priority`,
        {
          method: "DELETE",
          body: JSON.stringify({ steamId }),
        },
      ),
    getPriorityContent: (serverId: number) =>
      fetchApi<{ content: string }>(
        `/servers/${serverId}/players/priority-content`,
      ),
    sendDirectMessage: (
      serverId: number,
      playerId: string,
      playerName: string,
      message: string,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/players/${encodeURIComponent(playerId)}/message`,
        {
          method: "POST",
          body: JSON.stringify({ message, playerName }),
        },
      ),
    // File browser
    browseRoots: (id: number) =>
      fetchApi<{ roots: Array<{ key: string; label: string }> }>(
        `/servers/${id}/browse/roots`,
      ),
    browseTree: (id: number, rootKey: string) =>
      fetchApi<{ root: string; tree: BrowseTreeEntry[] }>(
        `/servers/${id}/browse/tree?root=${encodeURIComponent(rootKey)}`,
      ),
    browseList: (id: number, rootKey: string, dirPath: string = ".") =>
      fetchApi<{ path: string; entries: BrowseListEntry[] }>(
        `/servers/${id}/browse/list?root=${encodeURIComponent(rootKey)}&path=${encodeURIComponent(dirPath)}`,
      ),
    browseReadFile: (id: number, rootKey: string, filePath: string) =>
      fetchApi<{ content: string; size: number; path: string }>(
        `/servers/${id}/browse/file?root=${encodeURIComponent(rootKey)}&path=${encodeURIComponent(filePath)}`,
      ),
    browseWriteFile: (
      id: number,
      rootKey: string,
      filePath: string,
      content: string,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/browse/file`,
        {
          method: "PUT",
          body: JSON.stringify({ root: rootKey, path: filePath, content }),
        },
      ),
    browseCreateFile: (
      id: number,
      rootKey: string,
      filePath: string,
      content?: string,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/browse/file`,
        {
          method: "POST",
          body: JSON.stringify({
            root: rootKey,
            path: filePath,
            content: content ?? "",
          }),
        },
      ),
    browseDeleteFile: (id: number, rootKey: string, filePath: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/browse/file?root=${encodeURIComponent(rootKey)}&path=${encodeURIComponent(filePath)}`,
        { method: "DELETE" },
      ),
    browseCreateDirectory: (id: number, rootKey: string, dirPath: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/browse/directory`,
        {
          method: "POST",
          body: JSON.stringify({ root: rootKey, path: dirPath }),
        },
      ),
    browseDeleteDirectory: (id: number, rootKey: string, dirPath: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/browse/directory?root=${encodeURIComponent(rootKey)}&path=${encodeURIComponent(dirPath)}`,
        { method: "DELETE" },
      ),
    browseRename: (id: number, rootKey: string, from: string, to: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/browse/rename`,
        {
          method: "POST",
          body: JSON.stringify({ root: rootKey, from, to }),
        },
      ),
    browseDownloadUrl: (
      id: number,
      rootKey: string,
      filePath: string,
    ): string => {
      const token = getToken?.();
      const params = new URLSearchParams({
        root: rootKey,
        path: filePath,
      });
      if (token) params.set("token", token);
      return `${baseUrl}/servers/${id}/browse/download?${params.toString()}`;
    },
    browseDownload: async (
      id: number,
      rootKey: string,
      filePath: string,
    ): Promise<void> => {
      const url = `${baseUrl}/servers/${id}/browse/download`;
      const params = new URLSearchParams({
        root: rootKey,
        path: filePath,
      });

      const headers: Record<string, string> = {};
      const token = getToken?.();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(`${url}?${params.toString()}`, { headers });
      } catch {
        throw new Error("Agent not reachable \u2014 check connection");
      }

      if (response.status === 401) {
        await handleUnauthorized(response);
      }

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      let filename = filePath.split("/").pop() ?? "download";
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    },
    browseUpload: async (
      id: number,
      rootKey: string,
      targetPath: string,
      files: File[],
    ) => {
      const formData = new FormData();
      formData.append("root", rootKey);
      formData.append("path", targetPath);
      for (const file of files) {
        formData.append("files", file);
      }

      const headers: Record<string, string> = {};
      const token = getToken?.();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/servers/${id}/browse/upload`, {
          method: "POST",
          headers,
          body: formData,
        });
      } catch {
        throw new Error("Agent not reachable — check connection");
      }

      if (response.status === 401) {
        await handleUnauthorized(response);
      }

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return response.json();
    },
    // Backups
    getBackups: (id: number) =>
      fetchApi<{ backups: import("@/types").BackupMetadata[] }>(
        `/servers/${id}/backups`,
      ),
    createBackup: (id: number, name?: string, tag?: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${id}/backups`,
        {
          method: "POST",
          body: JSON.stringify({ name, tag }),
        },
      ),
    deleteBackup: (serverId: number, backupId: string) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/backups/${backupId}`,
        { method: "DELETE" },
      ),
    updateBackup: (
      serverId: number,
      backupId: string,
      updates: { name?: string | null; tag?: string | null },
    ) =>
      fetchApi<{ success: boolean }>(
        `/servers/${serverId}/backups/${backupId}`,
        {
          method: "PATCH",
          body: JSON.stringify(updates),
        },
      ),
    restoreBackup: (
      serverId: number,
      backupId: string,
      preRestoreBackup?: boolean,
    ) =>
      fetchApi<{ success: boolean; message: string }>(
        `/servers/${serverId}/backups/${backupId}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ preRestoreBackup }),
        },
      ),
    downloadBackup: async (
      serverId: number,
      backupId: string,
    ): Promise<void> => {
      const url = `${baseUrl}/servers/${serverId}/backups/${backupId}/download`;

      const headers: Record<string, string> = {};
      const token = getToken?.();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(url, { headers });
      } catch {
        throw new Error("Agent not reachable \u2014 check connection");
      }

      if (response.status === 401) {
        await handleUnauthorized(response);
      }

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      let filename = `backup-${backupId}.zip`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    },
    getBackupSettings: (id: number) =>
      fetchApi<{
        settings: import("@/types").BackupSettings;
        defaultPaths: {
          savePaths: string[];
          configPaths: string[];
          excludePatterns: string[];
        };
      }>(`/servers/${id}/backup-settings`),
    updateBackupSettings: (
      id: number,
      settings: Partial<import("@/types").BackupSettings>,
    ) =>
      fetchApi<{
        success: boolean;
        settings: import("@/types").BackupSettings;
      }>(`/servers/${id}/backup-settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
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
    getStatsSettings: () =>
      fetchApi<{ enabled: boolean; agentId: string | null }>(
        "/system/stats-settings",
      ),
    updateStatsSettings: (settings: { enabled: boolean }) =>
      fetchApi<{ success: boolean; message: string }>(
        "/system/stats-settings",
        {
          method: "PUT",
          body: JSON.stringify(settings),
        },
      ),
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
  const baseUrl = getApiBase(connection);
  return {
    steamcmd: createSteamcmdApi(fetchApi),
    servers: createServersApi(fetchApi, baseUrl, getToken),
    system: createSystemApi(fetchApi),
    health: createHealthApi(fetchApi),
    auth: createAuthApi(fetchApi),
    logs: createLogsApi(fetchApi),
  };
}
