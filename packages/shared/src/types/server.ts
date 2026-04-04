// Server status types
export type ServerStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "queued"
  | "installing"
  | "updating"
  | "deleting"
  | "error";

// RCON protocol types supported by game servers
export type RconProtocol = "battleye" | "telnet" | "source";

// Capabilities that a game server supports — drives UI and backend feature branching
export interface GameCapabilities {
  /** RCON protocol type, or false if not supported */
  rcon: RconProtocol | false;
  /** Whether game supports Steam Workshop mods */
  workshopMods: boolean;
  /** Whether a form-based config editor exists for this game */
  configEditor: boolean;
  /** Whether player tracking is available (requires RCON) */
  playerTracking: boolean;
  /** Whether scheduled RCON messages are supported (requires RCON) */
  scheduledMessages: boolean;
  /** How whitelist management works: 'file' = text file, 'rcon' = RCON commands, false = not supported */
  whitelist: "file" | "rcon" | false;
  /** How ban list management works: 'file' = text file, 'rcon' = RCON commands, false = not supported */
  banList: "file" | "rcon" | false;
  /** Which player identifier is used for whitelist/ban file operations */
  playerIdentifier: "battleye-guid" | "steam-id";
  /** Whether game-specific log parsing is available (e.g., DayZ ADM logs for character IDs) */
  logParsing: boolean;
  /** Whether whitelist/ban content can be directly edited as plain text (false for XML-based formats like 7DTD) */
  playerListEditable: boolean;
  /** Whether this game uses a configurable profiles path (e.g., DayZ -profiles= parameter) */
  profilesPath: boolean;
  /** Whether direct messages to individual players are supported via RCON */
  directMessage: boolean;
}

// Database models
export interface SteamConfig {
  id: number;
  username: string | null;
  isLoggedIn: boolean;
  lastLogin: string | null;
}

export interface GameServer {
  id: number;
  gameId: string;
  name: string;
  appId: number;
  installPath: string;
  executable: string;
  launchParams: string | null;
  port: number;
  queryPort: number | null;
  profilesPath: string;
  autoRestart: boolean;
  status: ServerStatus;
  pid: number | null;
  createdAt: string;
  startedAt: string | null;
  installing?: boolean; // Set by API when install is in progress
  hasPendingUpdateRestart?: boolean; // Set by API when auto-update restart is pending
}
