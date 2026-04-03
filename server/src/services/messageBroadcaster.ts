/**
 * Scheduled Message Broadcaster Service
 *
 * Sends recurring RCON messages to players at configurable intervals.
 * Use cases: server name reminders, rules links, Discord invites, etc.
 *
 * Each server can have multiple messages, each with its own interval.
 * Messages are sent via the game-specific broadcast command (e.g. `#broadcast` for DayZ).
 * Timers are started when a server starts and cleared when it stops.
 */

import { logger } from "../core/logger.js";
import {
  getEnabledMessagesByServerId,
  getServerById,
  getAllServers,
} from "../db/index.js";
import { resolveVariables } from "./variableResolver.js";
import { getRconConnection } from "./playerTracker.js";
import { getGameDefinition } from "../games/index.js";

// Active message timers per server: Map<serverId, Map<messageId, timer>>
const messageTimers = new Map<
  number,
  Map<number, ReturnType<typeof setInterval>>
>();

/**
 * Start broadcasting all enabled messages for a server
 */
export function startMessageBroadcaster(serverId: number): void {
  // Clear any existing timers for this server
  stopMessageBroadcaster(serverId);

  const server = getServerById(serverId);
  if (!server || server.status !== "running") {
    return;
  }

  const messages = getEnabledMessagesByServerId(serverId);
  if (messages.length === 0) {
    return;
  }

  const timers = new Map<number, ReturnType<typeof setInterval>>();

  for (const msg of messages) {
    const intervalMs = msg.intervalMinutes * 60 * 1000;

    // Start the interval — first message fires after the interval, not immediately
    const timer = setInterval(() => {
      sendMessage(serverId, msg.message);
    }, intervalMs);

    timers.set(msg.id, timer);

    logger.info(
      `[MessageBroadcaster] Server ${serverId}: scheduled message #${msg.id} every ${msg.intervalMinutes} min`,
    );
  }

  messageTimers.set(serverId, timers);

  logger.info(
    `[MessageBroadcaster] Server ${serverId}: ${messages.length} message(s) active`,
  );
}

/**
 * Stop all message timers for a server
 */
export function stopMessageBroadcaster(serverId: number): void {
  const timers = messageTimers.get(serverId);
  if (timers) {
    for (const timer of timers.values()) {
      clearInterval(timer);
    }
    messageTimers.delete(serverId);
  }
}

/**
 * Reload messages for a server (called after add/edit/delete)
 */
export function reloadMessageBroadcaster(serverId: number): void {
  const server = getServerById(serverId);
  if (server && server.status === "running") {
    startMessageBroadcaster(serverId);
  }
}

/**
 * Send a single RCON message
 */
async function sendMessage(
  serverId: number,
  messageTemplate: string,
): Promise<void> {
  // Resolve all template variables
  const message = resolveVariables(serverId, messageTemplate);

  const sent = await sendGameBroadcast(serverId, message);
  if (sent) {
    logger.info(`[MessageBroadcaster] Server ${serverId}: sent "${message}"`);
  } else {
    logger.warn(
      `[MessageBroadcaster] Server ${serverId}: RCON not connected, skipping message`,
    );
  }
}

/**
 * Initialize message broadcasters for all running servers (called on app startup)
 */
export function initializeMessageBroadcasters(): void {
  const servers = getAllServers();
  let count = 0;

  for (const server of servers) {
    if (server.status === "running") {
      const messages = getEnabledMessagesByServerId(server.id);
      if (messages.length > 0) {
        startMessageBroadcaster(server.id);
        count++;
      }
    }
  }

  logger.info(
    `[MessageBroadcaster] Initialized broadcasters for ${count} server(s)`,
  );
}

/**
 * Send a broadcast message using the game-specific command.
 * Uses the adapter's `broadcastCommand` template (e.g. `#broadcast` for DayZ),
 * falling back to the RCON protocol's default `broadcastMessage` if not defined.
 * Returns true if sent, false if RCON is not connected.
 */
export async function sendGameBroadcast(
  serverId: number,
  message: string,
): Promise<boolean> {
  const rcon = getRconConnection(serverId);
  if (!rcon || !rcon.isConnected()) return false;

  const server = getServerById(serverId);
  const definition = server ? getGameDefinition(server.gameId) : undefined;

  if (definition?.broadcastCommand) {
    const command = definition.broadcastCommand.replace("{MESSAGE}", message);
    await rcon.sendCommand(command);
  } else {
    await rcon.broadcastMessage(message);
  }

  return true;
}
