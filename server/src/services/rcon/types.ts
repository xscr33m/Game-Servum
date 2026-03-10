/**
 * Generic RCON client interface for game server communication.
 * Implementations: BattlEye (DayZ), Telnet (7DTD), Source RCON (ARK)
 */
export interface RconClient {
  connect(): Promise<boolean>;
  disconnect(): void;
  isConnected(): boolean;
  sendCommand(command: string, timeoutMs?: number): Promise<string>;
  getPlayers(): Promise<GenericRconPlayer[]>;
  broadcastMessage(message: string): Promise<void>;
  onMessage?(handler: (message: string) => void): void;
  onClose(handler: () => void): void;
}

export interface GenericRconPlayer {
  id: string; // Game-specific ID (GUID, SteamID, etc.)
  name: string;
  ping?: number;
  ip?: string;
}

export interface RconConnectionOptions {
  host: string;
  port: number;
  password: string;
}
