/**
 * Frontend Game UI Registry
 *
 * Central registry of all game UI plugins. Provides:
 * - getGamePlugin(gameId) — full plugin (config editor + metadata)
 * - getGameName(gameId) — display name with fallback
 * - getGameLogo(gameId) — logo path or null
 * - getConfigEditor(gameId) — config editor component or undefined
 *
 * To add a new game: create a `client/src/games/{id}/index.ts` with
 * a default-exported GameUIPlugin, then register it below.
 */

import type { ComponentType } from "react";
import type { GameUIPlugin, ConfigEditorProps } from "./types";

import dayz from "./dayz";
import ark from "./ark";
import sevenDays from "./7dtd";

// ── Plugin Registration ────────────────────────────────────────────

const plugins = new Map<string, GameUIPlugin>();

function register(plugin: GameUIPlugin): void {
  plugins.set(plugin.id, plugin);
}

register(dayz);
register(ark);
register(sevenDays);

// ── Public API ─────────────────────────────────────────────────────

/** Get display name for a game. Falls back to gameId if not registered. */
export function getGameName(gameId: string, fallback?: string): string {
  return plugins.get(gameId)?.metadata.name ?? fallback ?? gameId;
}

/** Get logo path for a game, or null if not registered. */
export function getGameLogo(gameId: string): string | null {
  return plugins.get(gameId)?.metadata.logo ?? null;
}

/** Get the config editor component for a game, or undefined. */
export function getConfigEditor(
  gameId: string,
): ComponentType<ConfigEditorProps> | undefined {
  return plugins.get(gameId)?.ConfigEditor;
}

/**
 * Build a Steam Workshop URL for a game.
 * Uses workshopAppId if provided, otherwise falls back to appId.
 */
export function getWorkshopUrl(
  workshopAppId: number | undefined,
  appId: number,
): string {
  const id = workshopAppId || appId;
  return `https://steamcommunity.com/app/${id}/workshop/`;
}
