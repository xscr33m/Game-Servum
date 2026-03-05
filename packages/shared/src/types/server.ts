// Server status types
export type ServerStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "installing"
  | "updating"
  | "error";

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
  installing?: boolean; // Set by API when install is in progress
}
