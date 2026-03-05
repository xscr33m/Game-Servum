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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackend } from "@/hooks/useBackend";
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

  const { api, subscribe } = useBackend();

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

  // Load whitelist/ban files
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setError(null);
    try {
      const [whitelist, ban] = await Promise.all([
        api.servers.getFile(server.id, "whitelist.txt"),
        api.servers.getFile(server.id, "ban.txt"),
      ]);

      setWhitelistContent(whitelist.content);
      setBanContent(ban.content);
      setOriginalWhitelist(whitelist.content);
      setOriginalBan(ban.content);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFilesLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    loadPlayers();
    loadFiles();
  }, [loadPlayers, loadFiles]);

  // Auto-refresh player list every 30 seconds when server is running
  useEffect(() => {
    if (server.status !== "running") return;

    const interval = setInterval(loadPlayers, 30000);
    return () => clearInterval(interval);
  }, [server.status, loadPlayers]);

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
  async function handleCopyId(characterId: string) {
    try {
      await navigator.clipboard.writeText(characterId);
      toastSuccess("Character ID copied to clipboard");
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
    <div className="space-y-4">
      {/* Messages */}
      {error && (
        <Alert variant="destructive">
          <FaCircleExclamation className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview" className="gap-2">
            <FaUsers className="h-4 w-4 text-ring/70" />
            Players
            {onlineCount > 0 && (
              <Badge variant="success" className="ml-1">
                {onlineCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="whitelist" className="gap-2">
            <FaShield className="h-4 w-4 text-ring/70" />
            Whitelist
            {whitelistChanged && (
              <Badge variant="warning" className="ml-1">
                Modified
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ban" className="gap-2">
            <FaBan className="h-4 w-4 text-ring/70" />
            Ban List
            {banChanged && (
              <Badge variant="warning" className="ml-1">
                Modified
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Player Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Online Players Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FaWifi className="h-5 w-5 text-ring" />
                    Online Players
                    <Badge variant="success">{onlineCount}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {server.status === "running"
                      ? "Currently connected players"
                      : "Server is not running"}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadPlayers}
                  disabled={playersLoading}
                >
                  <FaArrowsRotate
                    className={`h-4 w-4 ${playersLoading ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {playersError && (
                <Alert variant="destructive" className="mb-4">
                  <FaCircleExclamation className="h-4 w-4" />
                  <AlertDescription>{playersError}</AlertDescription>
                </Alert>
              )}

              {server.status !== "running" ? (
                <div className="text-center py-6 text-muted-foreground">
                  <FaWifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Server is offline</p>
                  <p className="text-sm mt-1">
                    Start the server to see connected players.
                  </p>
                </div>
              ) : onlinePlayers.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <FaUsers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No players connected</p>
                  <p className="text-sm mt-1">
                    Players will appear here when they join the server.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {onlinePlayers.map((player) => (
                    <div
                      key={player.steamId}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50"
                    >
                      <div className="h-2 w-2 rounded-full bg-ring shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">
                            {player.playerName}
                          </p>
                          {player.characterId &&
                            isWhitelisted(player.characterId) && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-blue-500 text-blue-500"
                              >
                                <FaShield className="h-2.5 w-2.5 mr-0.5" />
                                WL
                              </Badge>
                            )}
                          {player.characterId &&
                            isBanned(player.characterId) && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-red-500 text-red-500"
                              >
                                <FaBan className="h-2.5 w-2.5 mr-0.5" />
                                Banned
                              </Badge>
                            )}
                        </div>
                        {player.characterId ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span
                              className="font-mono text-xs text-muted-foreground truncate max-w-[300px]"
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
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground/50 mt-0.5">
                            Character ID pending...
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <FaClock className="h-3.5 w-3.5" />
                          {player.currentSessionStart
                            ? formatSessionDuration(player.currentSessionStart)
                            : "—"}
                        </div>
                        {player.characterId && (
                          <div className="flex items-center gap-0.5 ml-1">
                            {isWhitelisted(player.characterId) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600"
                                onClick={() =>
                                  handleRemoveFromWhitelist(
                                    player.characterId!,
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
                                    player.characterId!,
                                    player.playerName,
                                  )
                                }
                                disabled={actionLoading !== null}
                                title="Add to whitelist"
                              >
                                <FaUserShield className="h-4 w-4" />
                              </Button>
                            )}
                            {isBanned(player.characterId) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                onClick={() =>
                                  handleRemoveFromBanList(
                                    player.characterId!,
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
                                    player.characterId!,
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
            </CardContent>
          </Card>

          {/* Player History Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FaClock className="h-5 w-5 text-ring" />
                Player History
                {players.length > 0 && (
                  <Badge variant="secondary">{players.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                All players who have joined this server
              </CardDescription>
            </CardHeader>
            <CardContent>
              {players.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <FaUsers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No player history yet</p>
                  <p className="text-sm mt-1">
                    Player data is collected from server logs while the server
                    is running.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Player Name</th>
                        <th className="pb-2 pr-4">Character ID</th>
                        <th className="pb-2 pr-4">Total Playtime</th>
                        <th className="pb-2 pr-4">Sessions</th>
                        <th className="pb-2 pr-4">Last Seen</th>
                        <th className="pb-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...onlinePlayers, ...offlinePlayers].map((player) => (
                        <tr
                          key={player.steamId}
                          className="border-b border-border/50 last:border-0"
                        >
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-1">
                              {player.isOnline ? (
                                <Badge variant="success" className="text-xs">
                                  Online
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                  Offline
                                </Badge>
                              )}
                              {player.characterId &&
                                isWhitelisted(player.characterId) && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1 py-0 border-blue-500 text-blue-500"
                                  >
                                    WL
                                  </Badge>
                                )}
                              {player.characterId &&
                                isBanned(player.characterId) && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1 py-0 border-red-500 text-red-500"
                                  >
                                    Ban
                                  </Badge>
                                )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 font-medium">
                            {player.playerName}
                          </td>
                          <td className="py-2.5 pr-4">
                            {player.characterId ? (
                              <div className="flex items-center gap-1">
                                <span
                                  className="font-mono text-xs truncate max-w-[200px]"
                                  title={player.characterId}
                                >
                                  {player.characterId}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0"
                                  onClick={() =>
                                    handleCopyId(player.characterId!)
                                  }
                                  title="Copy Character ID"
                                >
                                  <FaCopy className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">
                                —
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4">
                            {formatPlaytime(player.totalPlaytimeSeconds)}
                          </td>
                          <td className="py-2.5 pr-4">{player.sessionCount}</td>
                          <td className="py-2.5 pr-4">
                            {player.isOnline
                              ? "Now"
                              : formatLastSeen(player.lastSeen)}
                          </td>
                          <td className="py-2.5">
                            {player.characterId ? (
                              <div className="flex items-center gap-0.5">
                                {isWhitelisted(player.characterId) ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-blue-500 hover:text-blue-600"
                                    onClick={() =>
                                      handleRemoveFromWhitelist(
                                        player.characterId!,
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
                                        player.characterId!,
                                        player.playerName,
                                      )
                                    }
                                    disabled={actionLoading !== null}
                                    title="Add to whitelist"
                                  >
                                    <FaUserShield className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {isBanned(player.characterId) ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                    onClick={() =>
                                      handleRemoveFromBanList(
                                        player.characterId!,
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
                                        player.characterId!,
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
                            ) : (
                              <span className="text-xs text-muted-foreground/50">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Whitelist Tab */}
        <TabsContent value="whitelist">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FaShield className="h-5 w-5 text-ring" />
                    Whitelist
                  </CardTitle>
                  <CardDescription>
                    Players with priority queue access (
                    {countEntries(whitelistContent)} entries)
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWhitelistContent(originalWhitelist)}
                    disabled={!whitelistChanged || saving}
                  >
                    <FaRotateLeft className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveWhitelist}
                    disabled={!whitelistChanged || saving}
                  >
                    <FaFloppyDisk className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {filesLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading...
                </div>
              ) : (
                <>
                  <Textarea
                    className="font-mono text-sm h-[400px]"
                    value={whitelistContent}
                    onChange={(e) => setWhitelistContent(e.target.value)}
                    placeholder="// Add Character IDs here (one per line)&#10;// The 44-character ID can be found in the ADM log file"
                    spellCheck={false}
                  />
                  <p className="text-sm text-muted-foreground">
                    Add one Character ID per line. Lines starting with // are
                    comments. You can also use the player action buttons to
                    add/remove players.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ban List Tab */}
        <TabsContent value="ban">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FaBan className="h-5 w-5 text-ring" />
                    Ban List
                  </CardTitle>
                  <CardDescription>
                    Banned players ({countEntries(banContent)} entries)
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBanContent(originalBan)}
                    disabled={!banChanged || saving}
                  >
                    <FaRotateLeft className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveBan}
                    disabled={!banChanged || saving}
                  >
                    <FaFloppyDisk className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {filesLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading...
                </div>
              ) : (
                <>
                  <Textarea
                    className="font-mono text-sm h-[400px]"
                    value={banContent}
                    onChange={(e) => setBanContent(e.target.value)}
                    placeholder="// Add Character IDs of banned players here (one per line)&#10;// The 44-character ID can be found in the ADM log file"
                    spellCheck={false}
                  />
                  <p className="text-sm text-muted-foreground">
                    Add one Character ID per line. Lines starting with // are
                    comments. You can also use the player action buttons to
                    add/remove players.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
