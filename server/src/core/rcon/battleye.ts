/**
 * BattlEye RCON Client (DayZ)
 *
 * Implements the BattlEye RCon protocol (UDP-based) for communicating with
 * DayZ game servers. Used for player tracking, scheduled messages, and server management.
 *
 * Protocol reference: https://www.battleye.com/downloads/ (BERConProtocol.txt)
 *
 * Packet structure:
 *   'B'(0x42) | 'E'(0x45) | CRC32 (4 bytes LE) | 0xFF | type | payload
 *
 * Packet types:
 *   0x00 - Login (password)
 *   0x01 - Command (seq + command string)
 *   0x02 - Server message (must ACK within 10s)
 *
 * Keep-alive: empty command packet every ≤45s
 */

import dgram from "dgram";
import { logger } from "../logger.js";
import type {
  RconClient,
  GenericRconPlayer,
  RconConnectionOptions,
} from "./types.js";

// CRC32 lookup table
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  crc32Table[i] = crc;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPacket(type: number, payload: Buffer): Buffer {
  const content = Buffer.alloc(2 + payload.length);
  content[0] = 0xff;
  content[1] = type;
  payload.copy(content, 2);

  const checksum = crc32(content);

  const packet = Buffer.alloc(6 + content.length);
  packet[0] = 0x42; // 'B'
  packet[1] = 0x45; // 'E'
  packet.writeUInt32LE(checksum, 2);
  content.copy(packet, 6);

  return packet;
}

function buildLoginPacket(password: string): Buffer {
  return buildPacket(0x00, Buffer.from(password, "ascii"));
}

function buildCommandPacket(seq: number, command: string): Buffer {
  const payload = Buffer.alloc(1 + Buffer.byteLength(command, "ascii"));
  payload[0] = seq & 0xff;
  Buffer.from(command, "ascii").copy(payload, 1);
  return buildPacket(0x01, payload);
}

function buildAckPacket(seq: number): Buffer {
  const payload = Buffer.alloc(1);
  payload[0] = seq & 0xff;
  return buildPacket(0x02, payload);
}

/** BattlEye-specific player info (superset of GenericRconPlayer) */
interface BattlEyePlayer {
  index: number;
  ip: string;
  port: number;
  ping: number;
  guid: string;
  name: string;
  verified: boolean;
}

type CommandCallback = {
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  parts: Map<number, string>;
  totalParts: number;
};

export class BattlEyeRcon implements RconClient {
  private socket: dgram.Socket | null = null;
  private host: string;
  private port: number;
  private password: string;

  private connected = false;
  private authenticated = false;
  private seq = 0;
  private pendingCommands = new Map<number, CommandCallback>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private loginCallback: {
    resolve: (value: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  private onServerMessage: ((message: string) => void) | null = null;
  private onDisconnect: (() => void) | null = null;

  constructor(options: RconConnectionOptions) {
    this.host = options.host;
    this.port = options.port;
    this.password = options.password;
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket("udp4");

      this.socket.on("message", (msg) => this.handleMessage(msg));

      this.socket.on("error", (err) => {
        logger.error("[RCON] Socket error:", err.message);
        if (this.loginCallback) {
          this.loginCallback.reject(err);
          this.loginCallback = null;
        }
        this.cleanup();
      });

      this.socket.on("close", () => {
        this.connected = false;
        this.authenticated = false;
        if (this.onDisconnect) this.onDisconnect();
      });

      this.loginCallback = { resolve, reject };
      const loginPacket = buildLoginPacket(this.password);

      this.socket.send(loginPacket, this.port, this.host, (err) => {
        if (err) {
          this.loginCallback = null;
          reject(err);
          return;
        }
      });

      setTimeout(() => {
        if (this.loginCallback) {
          this.loginCallback.reject(new Error("RCON login timeout after 10s"));
          this.loginCallback = null;
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
      throw new Error("Not connected to RCON");
    }

    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xff;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(seq);
        reject(new Error(`RCON command timeout: ${command}`));
      }, timeoutMs);

      this.pendingCommands.set(seq, {
        resolve,
        reject,
        timer,
        parts: new Map(),
        totalParts: -1,
      });

      const packet = buildCommandPacket(seq, command);
      this.socket!.send(packet, this.port, this.host, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingCommands.delete(seq);
          reject(err);
        }
      });
    });
  }

  async getPlayers(): Promise<GenericRconPlayer[]> {
    const response = await this.sendCommand("players");
    return parseBattlEyePlayersResponse(response).map((p) => ({
      id: p.guid,
      name: p.name,
      ping: p.ping,
      ip: p.ip,
    }));
  }

  async broadcastMessage(message: string): Promise<void> {
    await this.sendCommand(`say -1 ${message}`);
  }

  onMessage(handler: (message: string) => void): void {
    this.onServerMessage = handler;
  }

  onClose(handler: () => void): void {
    this.onDisconnect = handler;
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  private handleMessage(msg: Buffer): void {
    if (msg.length < 7 || msg[0] !== 0x42 || msg[1] !== 0x45) {
      return;
    }

    const receivedCrc = msg.readUInt32LE(2);
    const content = msg.subarray(6);
    const calculatedCrc = crc32(content);
    if (receivedCrc !== calculatedCrc) {
      logger.warn("[RCON] CRC32 mismatch, ignoring packet");
      return;
    }

    if (content[0] !== 0xff) return;

    const type = content[1];

    switch (type) {
      case 0x00:
        this.handleLoginResponse(content);
        break;
      case 0x01:
        this.handleCommandResponse(content);
        break;
      case 0x02:
        this.handleServerMessage(content);
        break;
    }
  }

  private handleLoginResponse(content: Buffer): void {
    const success = content[2] === 0x01;

    if (success) {
      this.connected = true;
      this.authenticated = true;

      this.keepAliveTimer = setInterval(() => {
        if (this.socket && this.connected) {
          const keepAlive = buildCommandPacket(this.seq, "");
          this.seq = (this.seq + 1) & 0xff;
          this.socket.send(keepAlive, this.port, this.host);
        }
      }, 30000);
    }

    if (this.loginCallback) {
      this.loginCallback.resolve(success);
      this.loginCallback = null;
    }
  }

  private handleCommandResponse(content: Buffer): void {
    const seq = content[2];
    const pending = this.pendingCommands.get(seq);

    if (!pending) return;

    if (content.length > 3 && content[3] === 0x00) {
      const totalParts = content[4];
      const partIndex = content[5];
      const body = content.subarray(6).toString("ascii");

      pending.totalParts = totalParts;
      pending.parts.set(partIndex, body);

      if (pending.parts.size >= totalParts) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(seq);

        let full = "";
        for (let i = 0; i < totalParts; i++) {
          full += pending.parts.get(i) || "";
        }
        pending.resolve(full);
      }
    } else {
      const body = content.subarray(3).toString("ascii");
      clearTimeout(pending.timer);
      this.pendingCommands.delete(seq);
      pending.resolve(body);
    }
  }

  private handleServerMessage(content: Buffer): void {
    const seq = content[2];
    const message = content.subarray(3).toString("ascii");

    if (this.socket && this.connected) {
      const ack = buildAckPacket(seq);
      this.socket.send(ack, this.port, this.host);
    }

    if (this.onServerMessage) {
      this.onServerMessage(message);
    }
  }

  private cleanup(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error("RCON connection closed"));
    }
    this.pendingCommands.clear();

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Already closed
      }
      this.socket = null;
    }

    this.connected = false;
    this.authenticated = false;
    this.seq = 0;
  }
}

/**
 * Parse the response from the BattlEye `players` command
 */
export function parseBattlEyePlayersResponse(
  response: string,
): BattlEyePlayer[] {
  const players: BattlEyePlayer[] = [];
  const lines = response.split("\n");

  for (const line of lines) {
    const match = line.match(
      /^\s*(\d+)\s+([\d.]+):(\d+)\s+(\d+)\s+([^\s(]+)\((\w+)\)\s+(.+?)\s*$/i,
    );
    if (match) {
      const rawName = match[7].trim().replace(/\s*\(Lobby\)\s*$/i, "");
      players.push({
        index: parseInt(match[1], 10),
        ip: match[2],
        port: parseInt(match[3], 10),
        ping: parseInt(match[4], 10),
        guid: match[5],
        name: rawName,
        verified: match[6].toUpperCase() === "OK",
      });
    }
  }

  return players;
}
