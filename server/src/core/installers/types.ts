/**
 * Game Installer Types
 *
 * Defines the contract for game server installation backends.
 * Currently only SteamCMD is implemented, but this abstraction allows
 * future support for non-Steam games (e.g. Minecraft Java downloads).
 */

// ── Install Options ────────────────────────────────────────────────

export interface InstallOptions {
  serverId: number;
  gameId: string;
  appId: number;
  installPath: string;
  serverName: string;
  port: number;
  /** Use anonymous SteamCMD login (no credentials required) */
  useAnonymous: boolean;
  username?: string;
  password?: string;
}

// ── Install Result ─────────────────────────────────────────────────

export interface InstallResult {
  success: boolean;
  message: string;
}

// ── Install Progress ───────────────────────────────────────────────

export type InstallPhase =
  | "starting"
  | "downloading"
  | "validating"
  | "post-install"
  | "cancelled";

export interface InstallProgress {
  serverId: number;
  gameId: string;
  phase: InstallPhase;
  message: string;
  /** 0-100 percentage, or -1 if indeterminate */
  percent: number;
}

// ── Update Check Result ────────────────────────────────────────────

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentBuildId?: string;
  latestBuildId?: string;
}

// ── Game Installer Interface ───────────────────────────────────────

export interface GameInstaller {
  /** Installer backend type (e.g. "steamcmd", "direct-download") */
  readonly type: string;

  /**
   * Install or update a game server.
   * Reports progress via WebSocket broadcasts.
   */
  install(options: InstallOptions): Promise<InstallResult>;

  /**
   * Cancel an in-progress installation.
   * Returns true if an installation was running and was cancelled.
   */
  cancel(serverId: number): boolean;

  /**
   * Check whether a server is currently being installed.
   */
  isInstalling(serverId: number): boolean;

  /**
   * Check for available updates.
   * Returns null if update checking is not supported for this installer type.
   */
  checkForUpdates(
    appId: number,
    installPath: string,
  ): Promise<UpdateCheckResult | null>;
}
