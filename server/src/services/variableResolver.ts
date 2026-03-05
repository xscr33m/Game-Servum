/**
 * Message Variable Resolver
 *
 * Resolves template variables in RCON messages and restart warnings.
 *
 * Built-in variables (auto-resolved):
 *   {SERVER_NAME}   — Server name from database
 *   {PORT}          — Server port
 *   {PLAYER_COUNT}  — Current online player count
 *   {NEXT_RESTART}  — Next scheduled restart time (or "N/A")
 *   {MINUTES}       — Minutes until restart (only in restart warnings)
 *
 * Custom variables (user-defined per server):
 *   {DISCORD}, {WEBSITE}, {TEAMSPEAK}, etc.
 */

import {
  getServerById,
  getOnlinePlayers,
  getScheduleByServerId,
  getVariablesByServerId,
} from "../db/index.js";

/**
 * Resolve all template variables in a message for a given server
 */
export function resolveVariables(
  serverId: number,
  message: string,
  extraVars?: Record<string, string>,
): string {
  let resolved = message;

  // 1. Built-in variables
  const server = getServerById(serverId);
  if (server) {
    resolved = resolved.replace(/\{SERVER_NAME\}/g, server.name);
    resolved = resolved.replace(/\{PORT\}/g, server.port.toString());
  }

  // Player count
  try {
    const onlinePlayers = getOnlinePlayers(serverId);
    resolved = resolved.replace(
      /\{PLAYER_COUNT\}/g,
      onlinePlayers.length.toString(),
    );
  } catch {
    resolved = resolved.replace(/\{PLAYER_COUNT\}/g, "0");
  }

  // Next restart time
  const schedule = getScheduleByServerId(serverId);
  if (schedule?.nextRestart && schedule.enabled) {
    const nextTime = new Date(schedule.nextRestart).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    resolved = resolved.replace(/\{NEXT_RESTART\}/g, nextTime);
  } else {
    resolved = resolved.replace(/\{NEXT_RESTART\}/g, "N/A");
  }

  // 2. Extra variables (e.g. {MINUTES} from scheduler)
  if (extraVars) {
    for (const [key, value] of Object.entries(extraVars)) {
      const pattern = new RegExp(`\\{${key}\\}`, "g");
      resolved = resolved.replace(pattern, value);
    }
  }

  // 3. Custom user-defined variables
  const customVars = getVariablesByServerId(serverId);
  for (const v of customVars) {
    const pattern = new RegExp(`\\{${v.name}\\}`, "g");
    resolved = resolved.replace(pattern, v.value);
  }

  return resolved;
}

/**
 * List of built-in variable names with descriptions (for UI display)
 */
export const BUILTIN_VARIABLES = [
  { name: "SERVER_NAME", description: "Server name" },
  { name: "PORT", description: "Server port" },
  { name: "PLAYER_COUNT", description: "Current online player count" },
  { name: "NEXT_RESTART", description: "Next scheduled restart time" },
  {
    name: "MINUTES",
    description: "Minutes until restart (restart warnings only)",
  },
  {
    name: "MOD_NAME",
    description: "Name of updating mod(s) (update restart warnings only)",
  },
  {
    name: "MOD_COUNT",
    description: "Number of mods updating (update restart warnings only)",
  },
  {
    name: "MOD_NAMES",
    description:
      "Comma-separated list of all updating mod names (update restart warnings only)",
  },
] as const;
