import { useState, useEffect, useCallback } from "react";
import {
  FaShieldHalved,
  FaUserShield,
  FaShield,
  FaBan,
  FaFloppyDisk,
  FaRotateLeft,
  FaCircleExclamation,
  FaUsers,
  FaClock,
  FaWifi,
  FaArrowsRotate,
  FaCopy,
  FaUserPlus,
  FaUserMinus,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackend } from "@/hooks/useBackend";
import { useGameCapabilities } from "@/hooks/useGameCapabilities";
import { toastSuccess, toastError } from "@/lib/toast";
import type { GameServer, PlayerSummary } from "@/types";

interface PlayersTabProps {
  server: GameServer;
}

/**
 * Format seconds into a human-readable duration string
 */
function formatPlaytime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format a time duration since a given ISO date string
 */
function formatSessionDuration(connectedAt: string): string {
  const start = new Date(connectedAt).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - start) / 1000);
  return formatPlaytime(seconds);
}

/**
 * Format a date to a relative or absolute string
 */
function formatLastSeen(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function PlayersTab({ server }: PlayersTabProps) {
  // Player overview state
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [playersError, setPlayersError] = useState<string | null>(null);

  // Whitelist/ban state
  const [whitelistContent, setWhitelistContent] = useState("");
  const [banContent, setBanContent] = useState("");
  const [originalWhitelist, setOriginalWhitelist] = useState("");
  const [originalBan, setOriginalBan] = useState("");
  const [filesLoading, setFilesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { api, subscribe, isConnected } = useBackend();
  const { capabilities } = useGameCapabilities(server.gameId);

  const hasWhitelist = capabilities?.whitelist !== false;
  const hasBanList = capabilities?.banList !== false;
  const isPlayerListEditable = capabilities?.playerListEditable !== false;

  // Resolve the effective player ID for whitelist/ban based on game type:
  // DayZ uses BattlEye GUID (characterId from ADM logs), ARK/7DTD use SteamID64.
  function getPlayerId(player: PlayerSummary): string | null {
    if (capabilities?.playerIdentifier === "steam-id") return player.steamId;
    return player.characterId;
  }

  const playerIdLabel =
    capabilities?.playerIdentifier === "steam-id" ? "Steam ID" : "Character ID";

  /**
   * Check if a character ID is present in the whitelist content
   */
  function isWhitelisted(characterId: string | null): boolean {
    if (!characterId) return false;
    return whitelistContent.includes(characterId);
  }

  /**
   * Check if a character ID is present in the ban list content
   */
  function isBanned(characterId: string | null): boolean {
    if (!characterId) return false;
    return banContent.includes(characterId);
  }

  // Load player data
  const loadPlayers = useCallback(async () => {
    try {
      const data = await api.servers.getPlayers(server.id);
      setPlayers(data.players);
      setOnlineCount(data.onlineCount);
      setPlayersError(null);
    } catch (err) {
      setPlayersError((err as Error).message);
    } finally {
      setPlayersLoading(false);
    }
  }, [server.id, api.servers]);

  // Load whitelist/ban content (only for games that support them)
  const loadFiles = useCallback(async () => {
    if (!hasWhitelist && !hasBanList) {
      setFilesLoading(false);
      return;
    }
    setFilesLoading(true);
    setError(null);
    try {
      const promises: Promise<{ content: string }>[] = [];
      if (hasWhitelist) {
        promises.push(api.servers.getWhitelistContent(server.id));
      } else {
        promises.push(Promise.resolve({ content: "" }));
      }
      if (hasBanList) {
        promises.push(api.servers.getBanContent(server.id));
      } else {
        promises.push(Promise.resolve({ content: "" }));
      }
      const [whitelist, ban] = await Promise.all(promises);

      setWhitelistContent(whitelist.content);
      setBanContent(ban.content);
      setOriginalWhitelist(whitelist.content);
      setOriginalBan(ban.content);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFilesLoading(false);
    }
  }, [server.id, api.servers, hasWhitelist, hasBanList]);

  useEffect(() => {
    if (!isConnected) return;
    loadPlayers();
    loadFiles();
  }, [loadPlayers, loadFiles, isConnected]);

  // Auto-refresh player list every 30 seconds when server is running
  useEffect(() => {
    if (server.status !== "running" || !isConnected) return;

    const interval = setInterval(loadPlayers, 30000);
    return () => clearInterval(interval);
  }, [server.status, loadPlayers, isConnected]);

  // Subscribe to player updates via WebSocket
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (
        message.type === "player:connected" ||
        message.type === "player:disconnected"
      ) {
        const payload = message.payload as { serverId: number };
        if (payload.serverId === server.id) {
          loadPlayers();
        }
      }
    });
    return unsubscribe;
  }, [subscribe, server.id, loadPlayers]);

  async function handleSaveWhitelist() {
    setSaving(true);
    setError(null);
    try {
      await api.servers.saveFile(server.id, "whitelist.txt", whitelistContent);
      setOriginalWhitelist(whitelistContent);
      toastSuccess("Whitelist saved successfully");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBan() {
    setSaving(true);
    setError(null);
    try {
      await api.servers.saveFile(server.id, "ban.txt", banContent);
      setOriginalBan(banContent);
      toastSuccess("Ban list saved successfully");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Add a player to the whitelist via API
   */
  async function handleAddToWhitelist(characterId: string, playerName: string) {
    setActionLoading(`whitelist-${characterId}`);
    setError(null);
    try {
      await api.servers.addToWhitelist(server.id, characterId, playerName);
      toastSuccess(`${playerName} added to whitelist`);
      // Reload whitelist content to keep it in sync
      loadFiles();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Remove a player from the whitelist via API
   */
  async function handleRemoveFromWhitelist(
    characterId: string,
    playerName: string,
  ) {
    setActionLoading(`unwhitelist-${characterId}`);
    setError(null);
    try {
      await api.servers.removeFromWhitelist(server.id, characterId);
      toastSuccess(`${playerName} removed from whitelist`);
      loadFiles();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Add a player to the ban list via API
   */
  async function handleAddToBanList(characterId: string, playerName: string) {
    setActionLoading(`ban-${characterId}`);
    setError(null);
    try {
      await api.servers.addToBanList(server.id, characterId, playerName);
      toastSuccess(`${playerName} added to ban list`);
      loadFiles();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Remove a player from the ban list via API
   */
  async function handleRemoveFromBanList(
    characterId: string,
    playerName: string,
  ) {
    setActionLoading(`unban-${characterId}`);
    setError(null);
    try {
      await api.servers.removeFromBanList(server.id, characterId);
      toastSuccess(`${playerName} removed from ban list`);
      loadFiles();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Copy character ID to clipboard
   */
  async function handleCopyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      toastSuccess(`${playerIdLabel} copied to clipboard`);
    } catch {
      toastError("Failed to copy to clipboard");
    }
  }

  const whitelistChanged = whitelistContent !== originalWhitelist;
  const banChanged = banContent !== originalBan;

  function countEntries(content: string): number {
    return content
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("//")).length;
  }

  const onlinePlayers = players.filter((p) => p.isOnline);
  const offlinePlayers = players.filter((p) => !p.isOnline);

  return (
    <div className="space-y-0">
      {/* Error message */}
      {error && (
        <div className="pb-4">
          <Alert variant="destructive">
            <FaCircleExclamation className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList
          className={`grid w-full ${hasWhitelist && hasBanList ? "grid-cols-3" : hasWhitelist || hasBanList ? "grid-cols-2" : "grid-cols-1"}`}
        >
          <TabsTrigger value="overview" className="gap-2">
            <FaUsers className="h-4 w-4 text-ring/70" />
            Players
            {onlineCount > 0 && (
              <Badge variant="success" className="ml-1">
                {onlineCount}
              </Badge>
            )}
          </TabsTrigger>
          {hasWhitelist && (
            <TabsTrigger value="whitelist" className="gap-2">
              <FaShield className="h-4 w-4 text-ring/70" />
              Whitelist
              {whitelistChanged && (
                <Badge variant="warning" className="ml-1">
                  Modified
                </Badge>
              )}
            </TabsTrigger>
          )}
          {hasBanList && (
            <TabsTrigger value="ban" className="gap-2">
              <FaBan className="h-4 w-4 text-ring/70" />
              Ban List
              {banChanged && (
                <Badge variant="warning" className="ml-1">
                  Modified
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Player Overview Tab ── */}
        <TabsContent value="overview" className="mt-6 space-y-0">
          {/* Online Players */}
          <div className="pb-6 border-b">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FaWifi className="h-4 w-4 text-ring" />
                <span className="text-sm font-medium text-muted-foreground">
                  Online Players
                </span>
                <Badge variant="success">{onlineCount}</Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadPlayers}
                disabled={playersLoading}
              >
                <FaArrowsRotate
                  className={`h-3.5 w-3.5 ${playersLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {playersError && (
              <Alert variant="destructive" className="mb-4">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription>{playersError}</AlertDescription>
              </Alert>
            )}

            {server.status !== "running" ? (
              <div className="text-center py-6 text-muted-foreground">
                <FaWifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Server is offline</p>
                <p className="text-xs mt-1">
                  Start the server to see connected players.
                </p>
              </div>
            ) : onlinePlayers.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <FaUsers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No players connected</p>
                <p className="text-xs mt-1">
                  Players will appear here when they join the server.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {onlinePlayers.map((player) => (
                  <div
                    key={player.steamId}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg border bg-muted/50 border-border"
                  >
                    {/* Player info */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="h-2 w-2 rounded-full bg-ring shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate text-sm">
                            {player.playerName}
                          </p>
                          {getPlayerId(player) &&
                            isWhitelisted(getPlayerId(player)) && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-blue-500 text-blue-500 shrink-0"
                              >
                                <FaShield className="h-2.5 w-2.5 mr-0.5" />
                                WL
                              </Badge>
                            )}
                          {getPlayerId(player) &&
                            isBanned(getPlayerId(player)) && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-red-500 text-red-500 shrink-0"
                              >
                                <FaBan className="h-2.5 w-2.5 mr-0.5" />
                                Banned
                              </Badge>
                            )}
                        </div>
                        {getPlayerId(player) ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span
                              className="font-mono text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-[300px]"
                              title={getPlayerId(player)!}
                            >
                              {getPlayerId(player)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => handleCopyId(getPlayerId(player)!)}
                              title={`Copy ${playerIdLabel}`}
                            >
                              <FaCopy className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground/50 mt-0.5">
                            {playerIdLabel} pending...
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Session duration + action buttons */}
                    <div className="flex items-center gap-2 sm:shrink-0 justify-end sm:justify-start pl-5 sm:pl-0">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <FaClock className="h-3.5 w-3.5" />
                        {player.currentSessionStart
                          ? formatSessionDuration(player.currentSessionStart)
                          : "—"}
                      </div>
                      {getPlayerId(player) && (
                        <div className="flex items-center gap-0.5 ml-1">
                          {isWhitelisted(getPlayerId(player)) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600"
                              onClick={() =>
                                handleRemoveFromWhitelist(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Remove from whitelist"
                            >
                              <FaShieldHalved className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-500"
                              onClick={() =>
                                handleAddToWhitelist(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Add to whitelist"
                            >
                              <FaUserShield className="h-4 w-4" />
                            </Button>
                          )}
                          {isBanned(getPlayerId(player)) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                              onClick={() =>
                                handleRemoveFromBanList(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Remove from ban list"
                            >
                              <FaUserMinus className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                              onClick={() =>
                                handleAddToBanList(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Add to ban list"
                            >
                              <FaUserPlus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Player History */}
          <div className="py-6">
            <div className="flex items-center gap-2 mb-3">
              <FaClock className="h-4 w-4 text-ring" />
              <span className="text-sm font-medium text-muted-foreground">
                Player History
              </span>
              {players.length > 0 && (
                <Badge variant="secondary">{players.length}</Badge>
              )}
            </div>

            {players.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <FaUsers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No player history yet</p>
                <p className="text-xs mt-1">
                  Player data is collected via RCON while the server is running.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...onlinePlayers, ...offlinePlayers].map((player) => (
                  <div
                    key={player.steamId}
                    className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg border ${
                      player.isOnline
                        ? "bg-muted/50 border-border"
                        : "bg-muted/20 border-border/50 opacity-60"
                    }`}
                  >
                    {/* Row 1: Status + Name + Badges */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {player.isOnline ? (
                        <Badge variant="success" className="text-xs shrink-0">
                          Online
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Offline
                        </Badge>
                      )}
                      <p className="font-medium truncate text-sm">
                        {player.playerName}
                      </p>
                      {getPlayerId(player) &&
                        isWhitelisted(getPlayerId(player)) && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 border-blue-500 text-blue-500 shrink-0"
                          >
                            WL
                          </Badge>
                        )}
                      {getPlayerId(player) && isBanned(getPlayerId(player)) && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0 border-red-500 text-red-500 shrink-0"
                        >
                          Ban
                        </Badge>
                      )}
                    </div>

                    {/* Row 2: Character ID (if applicable) */}
                    {capabilities?.logParsing && (
                      <div className="flex items-center gap-1 sm:shrink-0 pl-0 sm:pl-0">
                        {player.characterId ? (
                          <>
                            <span
                              className="font-mono text-xs text-muted-foreground truncate max-w-[180px] sm:max-w-[200px]"
                              title={player.characterId}
                            >
                              {player.characterId}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0"
                              onClick={() => handleCopyId(player.characterId!)}
                              title="Copy Character ID"
                            >
                              <FaCopy className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </div>
                    )}

                    {/* Row 3: Stats + Actions */}
                    <div className="flex items-center gap-3 sm:shrink-0 justify-between sm:justify-start text-xs text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span title="Total playtime">
                          {formatPlaytime(player.totalPlaytimeSeconds)}
                        </span>
                        <span title="Sessions">
                          {player.sessionCount}{" "}
                          {player.sessionCount === 1 ? "session" : "sessions"}
                        </span>
                        <span title="Last seen">
                          {player.isOnline
                            ? "Now"
                            : formatLastSeen(player.lastSeen)}
                        </span>
                      </div>
                      {(hasWhitelist || hasBanList) && getPlayerId(player) && (
                        <div className="flex items-center gap-0.5">
                          {isWhitelisted(getPlayerId(player)) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600"
                              onClick={() =>
                                handleRemoveFromWhitelist(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Remove from whitelist"
                            >
                              <FaShieldHalved className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-500"
                              onClick={() =>
                                handleAddToWhitelist(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Add to whitelist"
                            >
                              <FaUserShield className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {isBanned(getPlayerId(player)) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                              onClick={() =>
                                handleRemoveFromBanList(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Remove from ban list"
                            >
                              <FaUserMinus className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                              onClick={() =>
                                handleAddToBanList(
                                  getPlayerId(player)!,
                                  player.playerName,
                                )
                              }
                              disabled={actionLoading !== null}
                              title="Add to ban list"
                            >
                              <FaUserPlus className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Whitelist Tab ── */}
        {hasWhitelist && (
          <TabsContent value="whitelist" className="mt-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FaShield className="h-4 w-4 text-ring" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Whitelist
                  </span>
                  <Badge variant="secondary">
                    {countEntries(whitelistContent)} entries
                  </Badge>
                </div>
                {isPlayerListEditable && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWhitelistContent(originalWhitelist)}
                      disabled={!whitelistChanged || saving}
                    >
                      <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                      Revert
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveWhitelist}
                      disabled={!whitelistChanged || saving}
                    >
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                      {saving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </div>

              {filesLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Loading...
                </div>
              ) : (
                <>
                  <Textarea
                    className="font-mono text-sm h-[300px] sm:h-[400px]"
                    value={whitelistContent}
                    onChange={(e) => setWhitelistContent(e.target.value)}
                    placeholder={`// Add player IDs here (one per line)`}
                    spellCheck={false}
                    readOnly={!isPlayerListEditable}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isPlayerListEditable
                      ? "Add one player ID per line. Lines starting with // are comments. You can also use the player action buttons to add/remove players."
                      : "This list is managed via the player action buttons. Use the buttons in the Players tab to add or remove entries."}
                  </p>
                </>
              )}
            </div>
          </TabsContent>
        )}

        {/* ── Ban List Tab ── */}
        {hasBanList && (
          <TabsContent value="ban" className="mt-6">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FaBan className="h-4 w-4 text-ring" />
                  <span className="text-sm font-medium text-muted-foreground">
                    Ban List
                  </span>
                  <Badge variant="secondary">
                    {countEntries(banContent)} entries
                  </Badge>
                </div>
                {isPlayerListEditable && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBanContent(originalBan)}
                      disabled={!banChanged || saving}
                    >
                      <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                      Revert
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveBan}
                      disabled={!banChanged || saving}
                    >
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                      {saving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </div>

              {filesLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Loading...
                </div>
              ) : (
                <>
                  <Textarea
                    className="font-mono text-sm h-[300px] sm:h-[400px]"
                    value={banContent}
                    onChange={(e) => setBanContent(e.target.value)}
                    placeholder={`// Add player IDs of banned players here (one per line)`}
                    spellCheck={false}
                    readOnly={!isPlayerListEditable}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isPlayerListEditable
                      ? "Add one player ID per line. Lines starting with // are comments. You can also use the player action buttons to add/remove players."
                      : "This list is managed via the player action buttons. Use the buttons in the Players tab to add or remove entries."}
                  </p>
                </>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
