/**
 * Game Adapter Registry
 *
 * Central registry for all game adapters. Provides:
 * - getGameAdapter(gameId) — returns the adapter for a game
 * - getAllGameAdapters() — returns all registered adapters
 * - getGameDefinition(gameId) — backward-compatible definition lookup
 * - GAME_DEFINITIONS — backward-compatible record of all definitions
 */

import type { GameAdapter, GameDefinition } from "./types.js";
import { DayZAdapter } from "./dayz.js";
import { ArkAdapter } from "./ark.js";
import { SevenDaysAdapter } from "./7dtd.js";

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
 * Get all registered game adapters.
 */
export function getAllGameAdapters(): GameAdapter[] {
  return Array.from(adapters.values());
}

/**
 * Get a game definition by ID (backward-compatible wrapper).
 */
export function getGameDefinition(gameId: string): GameDefinition | undefined {
  return adapters.get(gameId)?.definition;
}

/**
 * Get a game definition by Steam App ID.
 */
export function getGameDefinitionByAppId(
  appId: number,
): GameDefinition | undefined {
  for (const adapter of adapters.values()) {
    if (adapter.definition.appId === appId) {
      return adapter.definition;
    }
  }
  return undefined;
}

/**
 * Get all available game definitions (backward-compatible).
 */
export function getAllGameDefinitions(): GameDefinition[] {
  return Array.from(adapters.values()).map((a) => a.definition);
}

/**
 * Backward-compatible GAME_DEFINITIONS record.
 * Prefer getGameAdapter() / getGameDefinition() in new code.
 */
export const GAME_DEFINITIONS: Record<string, GameDefinition> =
  Object.fromEntries(
    Array.from(adapters.entries()).map(([id, adapter]) => [
      id,
      adapter.definition,
    ]),
  );

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

// ── Re-exports ─────────────────────────────────────────────────────

export type {
  GameAdapter,
  GameDefinition,
  RconConfig,
  PlayerFileConfig,
  PlayerListResult,
  EditableFileConfig,
  ModCopyResult,
  LogPaths,
} from "./types.js";
export { BaseGameAdapter } from "./base.js";
export { DayZAdapter } from "./dayz.js";
export { ArkAdapter } from "./ark.js";
export { SevenDaysAdapter } from "./7dtd.js";
