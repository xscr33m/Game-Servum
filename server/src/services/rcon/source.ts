/**
 * Source RCON Client (ARK: Survival Evolved)
 *
 * Implements the Valve Source RCON protocol (TCP-based) for ARK servers.
 *
 * Packet structure:
 *   Size (4 bytes LE, not including size field itself)
 *   Request ID (4 bytes LE)
 *   Type (4 bytes LE): 3 = SERVERDATA_AUTH, 2 = SERVERDATA_EXECCOMMAND
 *   Body (null-terminated string)
 *   Empty string (null byte)
 *
 * Response types:
 *   2 = SERVERDATA_AUTH_RESPONSE
 *   0 = SERVERDATA_RESPONSE_VALUE
 *
 * Player list command: `ListPlayers`
 * Broadcast command: `ServerChat message`
 */

import net from "net";
import { logger } from "../../index.js";
import type {
  RconClient,
  GenericRconPlayer,
  RconConnectionOptions,
} from "./types.js";

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

function encodePacket(requestId: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8");
  // Size = 4 (requestId) + 4 (type) + body.length + 1 (null terminator) + 1 (empty string null)
  const size = 4 + 4 + bodyBuf.length + 1 + 1;
  const packet = Buffer.alloc(4 + size);
  packet.writeInt32LE(size, 0);
  packet.writeInt32LE(requestId, 4);
  packet.writeInt32LE(type, 8);
  bodyBuf.copy(packet, 12);
  packet[12 + bodyBuf.length] = 0; // null terminator for body
  packet[12 + bodyBuf.length + 1] = 0; // empty string
  return packet;
}

interface DecodedPacket {
  size: number;
  requestId: number;
  type: number;
  body: string;
}

function decodePacket(buf: Buffer): DecodedPacket | null {
  if (buf.length < 14) return null; // minimum packet: 4 (size) + 4 (id) + 4 (type) + 1 (null) + 1 (null)

  const size = buf.readInt32LE(0);
  if (buf.length < 4 + size) return null; // incomplete packet

  const requestId = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);

  // Body is from byte 12 to the second-to-last null byte
  const bodyEnd = 4 + size - 2; // last two bytes are null terminators
  const body = buf.subarray(12, bodyEnd).toString("utf8");

  return { size, requestId, type, body };
}

export class SourceRcon implements RconClient {
  private socket: net.Socket | null = null;
  private host: string;
  private port: number;
  private password: string;

  private connected = false;
  private authenticated = false;
  private requestId = 1;

  private buffer = Buffer.alloc(0);
  private pendingRequests = new Map<
    number,
    {
      resolve: (response: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private authCallback: {
    resolve: (value: boolean) => void;
    reject: (error: Error) => void;
    authRequestId: number;
  } | null = null;

  private onDisconnectHandler: (() => void) | null = null;
  private onMessageHandler: ((message: string) => void) | null = null;

  constructor(options: RconConnectionOptions) {
    this.host = options.host;
    this.port = options.port;
    this.password = options.password;
  }

  async connect(): Promise<boolean> {
    if (this.connected && this.authenticated) return true;

    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      this.socket.on("data", (data) => this.handleData(data));

      this.socket.on("error", (err) => {
        logger.error("[RCON-Source] Socket error:", err.message);
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

        // Send auth packet
        const authId = this.nextRequestId();
        this.authCallback = { resolve, reject, authRequestId: authId };
        const packet = encodePacket(authId, SERVERDATA_AUTH, this.password);
        this.socket!.write(packet);
      });

      setTimeout(() => {
        if (this.authCallback) {
          this.authCallback.reject(
            new Error("Source RCON login timeout after 10s"),
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
      throw new Error("Not connected to Source RCON");
    }

    const reqId = this.nextRequestId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Source RCON command timeout: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timer });

      const packet = encodePacket(reqId, SERVERDATA_EXECCOMMAND, command);
      this.socket!.write(packet);
    });
  }

  async getPlayers(): Promise<GenericRconPlayer[]> {
    const response = await this.sendCommand("ListPlayers");
    return parseSourcePlayersResponse(response);
  }

  async broadcastMessage(message: string): Promise<void> {
    await this.sendCommand(`ServerChat ${message}`);
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

  private nextRequestId(): number {
    const id = this.requestId;
    this.requestId = (this.requestId + 1) & 0x7fffffff;
    return id;
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    // Process all complete packets in the buffer
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      const totalLength = 4 + size;

      if (this.buffer.length < totalLength) break; // incomplete

      const packetBuf = this.buffer.subarray(0, totalLength);
      this.buffer = this.buffer.subarray(totalLength);

      const packet = decodePacket(packetBuf);
      if (packet) {
        this.processPacket(packet);
      }
    }
  }

  private processPacket(packet: DecodedPacket): void {
    // Handle auth response
    if (this.authCallback) {
      if (packet.type === SERVERDATA_AUTH_RESPONSE) {
        if (packet.requestId === this.authCallback.authRequestId) {
          this.authenticated = true;
          this.authCallback.resolve(true);
          this.authCallback = null;
        } else if (packet.requestId === -1) {
          // Auth failed: Source RCON returns requestId=-1 on auth failure
          this.authCallback.resolve(false);
          this.authCallback = null;
          this.cleanup();
        }
        return;
      }

      // Some servers send an empty RESPONSE_VALUE before AUTH_RESPONSE — ignore
      if (packet.type === SERVERDATA_RESPONSE_VALUE && packet.body === "") {
        return;
      }
    }

    // Handle command responses
    if (packet.type === SERVERDATA_RESPONSE_VALUE) {
      const pending = this.pendingRequests.get(packet.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(packet.requestId);
        pending.resolve(packet.body);
        return;
      }

      // Unsolicited server message
      if (this.onMessageHandler && packet.body) {
        this.onMessageHandler(packet.body);
      }
    }
  }

  private cleanup(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Source RCON connection closed"));
    }
    this.pendingRequests.clear();

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
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * Parse the response from the ARK `ListPlayers` command
 *
 * Example response:
 *   0. PlayerName, 76561198012345678
 *   1. AnotherPlayer, 76561198087654321
 *
 * Or no players:
 *   No Players Connected
 */
export function parseSourcePlayersResponse(
  response: string,
): GenericRconPlayer[] {
  const players: GenericRconPlayer[] = [];
  const lines = response.split("\n");

  for (const line of lines) {
    // Match: index. PlayerName, SteamID
    const match = line.match(/^\s*\d+\.\s+(.+?),\s+(\d+)\s*$/);
    if (match) {
      players.push({
        id: match[2],
        name: match[1].trim(),
      });
    }
  }

  return players;
}
