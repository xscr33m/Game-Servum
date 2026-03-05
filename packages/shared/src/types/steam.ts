// SteamCMD login state machine
export type LoginState =
  | "idle"
  | "started"
  | "awaiting_guard"
  | "success"
  | "failed";

// SteamCMD status
export interface SteamCMDStatus {
  installed: boolean;
  path: string | null;
  loggedIn: boolean;
  username: string | null;
  loginState?: LoginState;
}

// API Request types
export interface SteamLoginRequest {
  username: string;
  password?: string;
}

export interface SteamGuardRequest {
  code: string;
}
