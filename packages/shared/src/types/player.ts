// Player tracking
export interface PlayerSummary {
  steamId: string;
  playerName: string;
  characterId: string | null;
  isOnline: boolean;
  currentSessionStart: string | null;
  totalPlaytimeSeconds: number;
  sessionCount: number;
  lastSeen: string;
}
