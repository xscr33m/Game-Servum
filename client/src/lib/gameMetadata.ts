/**
 * Centralized game metadata — single source of truth for display names, logos, and URLs.
 * Used across ServerCard, OverviewTab, AddServerDialog, and ModsTab.
 */

export const GAME_NAMES: Record<string, string> = {
  dayz: "DayZ",
  "7dtd": "7 Days to Die",
  ark: "ARK: Survival Evolved",
};

export const GAME_LOGOS: Record<string, string> = {
  dayz: "game-logos/dayz.png",
  "7dtd": "game-logos/7daystodie.png",
  ark: "game-logos/ark.png",
};

export function getGameName(gameId: string, fallback?: string): string {
  return GAME_NAMES[gameId] || fallback || gameId;
}

export function getGameLogo(gameId: string): string | null {
  return GAME_LOGOS[gameId] || null;
}

export function getWorkshopUrl(
  workshopAppId: number | undefined,
  appId: number,
): string {
  const id = workshopAppId || appId;
  return `https://steamcommunity.com/app/${id}/workshop/`;
}
