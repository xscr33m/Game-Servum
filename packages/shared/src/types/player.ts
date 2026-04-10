// Player tracking
export interface PlayerSummary {
  steamId: string;
  playerName: string;
  characterId: string | null;
  steam64Id: string | null;
  isOnline: boolean;
  currentSessionStart: string | null;
  totalPlaytimeSeconds: number;
  sessionCount: number;
  lastSeen: string;
}
