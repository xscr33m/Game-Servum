/**
 * Game Adapter Registry
 *
 * Central registry for all game adapters. Provides:
 * - getGameAdapter(gameId) — returns the adapter for a game
 * - getAllGameAdapters() — returns all registered adapters
 * - getGameDefinition(gameId) — definition lookup by game ID
 * - getAllGameDefinitions() — all game definitions
 */

import type { GameAdapter, GameDefinition } from "./types.js";
import { getQueryPortOffset, getConsecutivePortCount } from "./base.js";
import { DayZAdapter } from "./dayz/index.js";
import { ArkAdapter } from "./ark/index.js";
import { SevenDaysAdapter } from "./7dtd/index.js";

// ── Adapter Instances (singletons) ─────────────────────────────────

const adapters: Map<string, GameAdapter> = new Map();

function registerAdapter(adapter: GameAdapter): void {
  adapters.set(adapter.definition.id, adapter);
}

// Register all supported games
registerAdapter(new DayZAdapter());
registerAdapter(new ArkAdapter());
registerAdapter(new SevenDaysAdapter());

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get the game adapter for a specific game ID.
 */
export function getGameAdapter(gameId: string): GameAdapter | undefined {
  return adapters.get(gameId);
}

/**
 * Get a game definition by ID.
 */
export function getGameDefinition(gameId: string): GameDefinition | undefined {
  return adapters.get(gameId)?.definition;
}

/**
 * Get all available game definitions (backward-compatible).
 */
export function getAllGameDefinitions(): GameDefinition[] {
  return Array.from(adapters.values()).map((a) => a.definition);
}

/**
 * Run post-install hook for a game (if the adapter defines one).
 */
export async function runPostInstall(
  gameId: string,
  installPath: string,
  serverName: string,
  port: number,
): Promise<void> {
  const adapter = adapters.get(gameId);
  if (adapter) {
    await adapter.postInstall(installPath, serverName, port);
  }
}

/**
 * Compute ALL ports a server occupies based on its firewallRules.
 * Uses firewallRules as the single source of truth for port enumeration.
 * Falls back to consecutive port count + query port offset if no firewallRules are defined.
 */
export function getAllPortsFromRules(
  basePort: number,
  gameId: string,
): number[] {
  const gameDef = getGameDefinition(gameId);
  if (!gameDef) return [basePort];

  const ports = new Set<number>();

  if (gameDef.firewallRules && gameDef.firewallRules.length > 0) {
    for (const rule of gameDef.firewallRules) {
      for (let i = 0; i < rule.portCount; i++) {
        ports.add(basePort + rule.portOffset + i);
      }
    }
  } else {
    // Fallback: use consecutive port count + query port offset
    const portCount = getConsecutivePortCount(gameDef);
    for (let i = 0; i < portCount; i++) {
      ports.add(basePort + i);
    }
    const qpOffset = getQueryPortOffset(gameDef);
    if (qpOffset != null) {
      ports.add(basePort + qpOffset);
    }
  }

  return Array.from(ports).sort((a, b) => a - b);
}

// ── Re-exports ─────────────────────────────────────────────────────

export type { GameDefinition, LogPaths } from "./types.js";
export { getQueryPortOffset, getConsecutivePortCount } from "./base.js";
