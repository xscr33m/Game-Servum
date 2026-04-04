/**
 * Telnet RCON Client (7 Days to Die)
 *
 * Implements a TCP-based Telnet RCON for 7DTD servers.
 * 7DTD uses a simple telnet protocol: connect → receive password prompt → send password → authenticated.
 * Commands and responses are newline-delimited plaintext.
 *
 * Player list command: `listplayers`
 * Broadcast command: `say "message"`
 */

import net from "net";
import { logger } from "../logger.js";
import type {
  RconClient,
  GenericRconPlayer,
  RconConnectionOptions,
} from "./types.js";

export class TelnetRcon implements RconClient {
  private socket: net.Socket | null = null;
  private host: string;
  private port: number;
  private password: string;

  private connected = false;
  private authenticated = false;

  private onDisconnectHandler: (() => void) | null = null;
  private onMessageHandler: ((message: string) => void) | null = null;

  private buffer = "";
  private pendingCommand: {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    lines: string[];
  } | null = null;

  private authCallback: {
    resolve: (value: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(options: RconConnectionOptions) {
    this.host = options.host;
    this.port = options.port;
    this.password = options.password;
  }

  async connect(): Promise<boolean> {
    if (this.connected && this.authenticated) return true;

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.authCallback = { resolve, reject };

      this.socket.on("data", (data) => this.handleData(data));

      this.socket.on("error", (err) => {
        logger.error("[RCON-Telnet] Socket error:", err.message);
        if (this.authCallback) {
          this.authCallback.reject(err);
          this.authCallback = null;
        }
        this.cleanup();
      });

      this.socket.on("close", () => {
        this.connected = false;
        this.authenticated = false;
        if (this.onDisconnectHandler) this.onDisconnectHandler();
      });

      this.socket.connect(this.port, this.host, () => {
        this.connected = true;
      });

      setTimeout(() => {
        if (this.authCallback) {
          this.authCallback.reject(
            new Error("Telnet RCON login timeout after 10s"),
          );
          this.authCallback = null;
          this.cleanup();
        }
      }, 10000);
    });
  }

  disconnect(): void {
    this.cleanup();
  }

  async sendCommand(command: string, timeoutMs = 10000): Promise<string> {
    if (!this.connected || !this.authenticated || !this.socket) {
      throw new Error("Not connected to Telnet RCON");
    }

    // If there is already a pending command, reject it
    if (this.pendingCommand) {
      throw new Error("A command is already pending");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCommand) {
          const lines = this.pendingCommand.lines;
          this.pendingCommand = null;
          // Return whatever we have so far on timeout
          resolve(lines.join("\n"));
        }
      }, timeoutMs);

      this.pendingCommand = {
        resolve,
        reject,
        timer,
        lines: [],
      };

      this.socket!.write(command + "\n");
    });
  }

  async getPlayers(): Promise<GenericRconPlayer[]> {
    const response = await this.sendCommand("listplayers");
    return parseTelnetPlayersResponse(response);
  }

  async broadcastMessage(message: string): Promise<void> {
    await this.sendCommand(`say "${message}"`);
  }

  onMessage(handler: (message: string) => void): void {
    this.onMessageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.onDisconnectHandler = handler;
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString("utf8");

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.substring(0, newlineIdx).replace(/\r$/, "");
      this.buffer = this.buffer.substring(newlineIdx + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    // Handle authentication phase
    if (!this.authenticated) {
      // 7DTD prompts "Please enter password:" or similar
      if (
        line.toLowerCase().includes("enter password") ||
        line.toLowerCase().includes("password")
      ) {
        this.socket?.write(this.password + "\n");
        return;
      }

      // Successful authentication
      if (
        line.toLowerCase().includes("logon successful") ||
        line.toLowerCase().includes("authenticated")
      ) {
        this.authenticated = true;
        if (this.authCallback) {
          this.authCallback.resolve(true);
          this.authCallback = null;
        }
        return;
      }

      // Failed authentication
      if (
        line.toLowerCase().includes("password incorrect") ||
        line.toLowerCase().includes("authentication failed")
      ) {
        if (this.authCallback) {
          this.authCallback.resolve(false);
          this.authCallback = null;
        }
        this.cleanup();
        return;
      }

      return;
    }

    // Handle command responses
    if (this.pendingCommand) {
      // 7DTD marks end of player list with a total count line
      // e.g., "Total of 2 in the game"
      if (/^Total of \d+ in the game/i.test(line)) {
        this.pendingCommand.lines.push(line);
        const pending = this.pendingCommand;
        clearTimeout(pending.timer);
        this.pendingCommand = null;
        pending.resolve(pending.lines.join("\n"));
        return;
      }

      this.pendingCommand.lines.push(line);
      return;
    }

    // Server-pushed messages (no pending command)
    if (this.onMessageHandler && line.trim()) {
      this.onMessageHandler(line);
    }
  }

  private cleanup(): void {
    if (this.pendingCommand) {
      clearTimeout(this.pendingCommand.timer);
      this.pendingCommand.reject(new Error("Telnet RCON connection closed"));
      this.pendingCommand = null;
    }

    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // Already closed
      }
      this.socket = null;
    }

    this.connected = false;
    this.authenticated = false;
    this.buffer = "";
  }
}

/**
 * Parse the response from the 7DTD `listplayers` command
 *
 * V1.0+ format:
 *   0. id=171, ⎝⧹ xscr33m ⧸⎠, pos=(-273.0, 61.0, 449.0), ..., pltfmid=Steam_76561198082430502, crossid=EOS_0002262a33b54246b2d2761969a6cf88, ..., ping=32
 * Legacy format:
 *   0. id=171, PlayerName, pos=(1234.5, 67.8, 910.1), ..., steamid=76561198012345678, ip=192.168.1.10, ping=32
 *   Total of 1 in the game
 */
function parseTelnetPlayersResponse(response: string): GenericRconPlayer[] {
  const players: GenericRconPlayer[] = [];
  const lines = response.split("\n");

  for (const line of lines) {
    // Match: index. id=X, Name, ...
    const idMatch = line.match(/^\d+\.\s+id=(\d+),\s+([^,]+),/);
    if (!idMatch) continue;

    // V1.0+: pltfmid=Steam_XXXXX (preferred)
    const pltfmMatch = line.match(/pltfmid=Steam_(\d+)/);
    // Legacy: steamid=XXXXX
    const steamIdMatch = line.match(/steamid=(\d+)/);
    const ipMatch = line.match(/ip=([\d.]+)/);
    const pingMatch = line.match(/ping=(\d+)/);

    players.push({
      id: pltfmMatch
        ? pltfmMatch[1]
        : steamIdMatch
          ? steamIdMatch[1]
          : idMatch[1],
      name: idMatch[2].trim(),
      ping: pingMatch ? parseInt(pingMatch[1], 10) : undefined,
      ip: ipMatch ? ipMatch[1] : undefined,
    });
  }

  return players;
}
