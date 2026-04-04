import { useState, useEffect, useCallback } from "react";
import { useBackend } from "@/hooks/useBackend";
import type { GameDefinition, GameCapabilities } from "@/types";

// Cache game definitions across hook instances
let cachedGames: GameDefinition[] | null = null;

/**
 * Hook to access game capabilities for a given gameId.
 * Fetches and caches game definitions from the API.
 */
export function useGameCapabilities(gameId: string): {
  capabilities: GameCapabilities | null;
  gameDefinition: GameDefinition | null;
  loading: boolean;
} {
  const { api, isConnected } = useBackend();
  const [games, setGames] = useState<GameDefinition[]>(cachedGames || []);
  const [loading, setLoading] = useState(!cachedGames);

  const loadGames = useCallback(async () => {
    if (cachedGames) {
      setGames(cachedGames);
      setLoading(false);
      return;
    }
    try {
      const data = await api.servers.getAvailableGames();
      cachedGames = data;
      setGames(data);
    } catch {
      // Silently fail — capabilities will be null
    } finally {
      setLoading(false);
    }
  }, [api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadGames();
  }, [loadGames, isConnected]);

  const gameDefinition = games.find((g) => g.id === gameId) || null;

  return {
    capabilities: gameDefinition?.capabilities || null,
    gameDefinition,
    loading,
  };
}
