import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  FaSpinner,
  FaCircleExclamation,
  FaTerminal,
  FaLock,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";
import type { GameDefinition, GameServer } from "@/types";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerCreated: () => void;
  isLoggedIn: boolean;
}

export function AddServerDialog({
  open,
  onOpenChange,
  onServerCreated,
  isLoggedIn,
}: AddServerDialogProps) {
  const [games, setGames] = useState<GameDefinition[]>([]);
  const [existingServers, setExistingServers] = useState<GameServer[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameDefinition | null>(null);
  const [serverName, setServerName] = useState("");
  const [port, setPort] = useState<number | undefined>();
  const [portsUsed, setPortsUsed] = useState<number[]>([]);
  const [portConflict, setPortConflict] = useState<string | null>(null);
  const [usedPorts, setUsedPorts] = useState<
    Array<{
      id: number;
      name: string;
      gameId: string;
      port: number;
      queryPort: number | null;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadingGames, setLoadingGames] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installingServerId, setInstallingServerId] = useState<number | null>(
    null,
  );
  const [installProgress, setInstallProgress] = useState<string>("");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { api, subscribe } = useBackend();

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    try {
      const availableGames = await api.servers.getAvailableGames();
      setGames(availableGames);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingGames(false);
    }
  }, [api.servers]);

  const loadUsedPorts = useCallback(async () => {
    try {
      const ports = await api.servers.getUsedPorts();
      setUsedPorts(ports);
    } catch {
      // Non-critical, continue without port data
    }
  }, [api.servers]);

  const loadExistingServers = useCallback(async () => {
    try {
      const servers = await api.servers.getAll();
      setExistingServers(servers);
    } catch {
      // Non-critical
    }
  }, [api.servers]);

  // Load available games and used ports when dialog opens
  useEffect(() => {
    if (open) {
      loadGames();
      loadUsedPorts();
      loadExistingServers();
      // Reset state
      setSelectedGame(null);
      setServerName("");
      setPort(undefined);
      setPortsUsed([]);
      setPortConflict(null);
      setError(null);
      setInstalling(false);
      setInstallingServerId(null);
      setInstallProgress("");
      setTerminalOutput([]);
    }
  }, [open, loadGames, loadUsedPorts, loadExistingServers]);

  // Subscribe to installation progress WebSocket messages
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "install:progress") {
        const payload = message.payload as {
          serverId: number;
          status: string;
          message: string;
          percent?: number;
        };
        // Only update if it's for our server or we don't have a serverId yet
        if (
          installingServerId === null ||
          payload.serverId === installingServerId
        ) {
          setInstallProgress(payload.message);
        }
      }

      if (message.type === "steamcmd:output" && installing) {
        const payload = message.payload as {
          message: string;
          serverId: number;
        };
        // Only show output for the server we're installing
        if (
          payload.message &&
          (installingServerId === null ||
            payload.serverId === installingServerId)
        ) {
          setTerminalOutput((prev) => [...prev.slice(-100), payload.message]);
        }
      }

      if (message.type === "install:complete") {
        const payload = message.payload as {
          serverId: number;
          success: boolean;
          message: string;
        };
        // Only handle if it's for our server
        if (
          installingServerId === null ||
          payload.serverId === installingServerId
        ) {
          setInstalling(false);
          setInstallingServerId(null);
          if (payload.success) {
            onServerCreated();
            onOpenChange(false);
          } else {
            setError(payload.message);
          }
        }
      }

      if (message.type === "install:error") {
        const payload = message.payload as {
          serverId: number;
          message: string;
        };
        // Only handle if it's for our server
        if (
          installingServerId === null ||
          payload.serverId === installingServerId
        ) {
          setInstalling(false);
          setInstallingServerId(null);
          setError(payload.message);
        }
      }
    });

    return unsubscribe;
  }, [
    subscribe,
    installing,
    installingServerId,
    onServerCreated,
    onOpenChange,
  ]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  /**
   * Generate a unique server name like "DayZ Server #1", "DayZ Server #2", etc.
   */
  function generateServerName(game: GameDefinition): string {
    const baseName = `${game.name} Server`;
    const existingNames = new Set(
      existingServers.map((s) => s.name.toLowerCase()),
    );
    let num = 1;
    while (existingNames.has(`${baseName} #${num}`.toLowerCase())) {
      num++;
    }
    return `${baseName} #${num}`;
  }

  /**
   * Build a Set of ALL ports occupied by existing servers,
   * considering each game's portCount and queryPortOffset.
   */
  function buildOccupiedPorts(): Set<number> {
    const occupied = new Set<number>();
    for (const s of usedPorts) {
      // Find the game definition for this server to know its port range
      const gameDef = games.find((g) => g.id === s.gameId);
      if (gameDef) {
        for (let i = 0; i < gameDef.portCount; i++) {
          occupied.add(s.port + i);
        }
        if (gameDef.queryPortOffset != null) {
          occupied.add(s.port + gameDef.queryPortOffset);
        }
      } else {
        occupied.add(s.port);
        if (s.queryPort) occupied.add(s.queryPort);
      }
    }
    return occupied;
  }

  /**
   * Calculate all ports that would be used for a given base port + game,
   * and check for conflicts with existing servers.
   */
  function calculatePorts(
    basePort: number | undefined,
    game: GameDefinition | null,
  ) {
    if (!basePort || !game) {
      setPortsUsed([]);
      setPortConflict(null);
      return;
    }

    // Build list of ports this server would use
    const ports: number[] = [];
    for (let i = 0; i < game.portCount; i++) {
      ports.push(basePort + i);
    }
    if (game.queryPortOffset != null) {
      ports.push(basePort + game.queryPortOffset);
    }
    setPortsUsed(ports.sort((a, b) => a - b));

    // Check conflicts
    const occupied = buildOccupiedPorts();
    const conflicts: string[] = [];
    for (const p of ports) {
      if (occupied.has(p)) {
        const conflictServer = usedPorts.find((s) => {
          const sd = games.find((g) => g.id === s.gameId);
          if (sd) {
            for (let j = 0; j < sd.portCount; j++) {
              if (s.port + j === p) return true;
            }
            if (sd.queryPortOffset != null && s.port + sd.queryPortOffset === p)
              return true;
          }
          return s.port === p || s.queryPort === p;
        });
        conflicts.push(
          `Port ${p} is already used by "${conflictServer?.name || "unknown"}"`,
        );
      }
    }
    setPortConflict(conflicts.length > 0 ? conflicts.join(". ") : null);
  }

  async function handleGameSelect(gameId: string) {
    const game = games.find((g) => g.id === gameId);
    setSelectedGame(game || null);
    if (game) {
      // Auto-suggest server name
      setServerName(generateServerName(game));

      // Auto-suggest next available port
      try {
        const suggestion = await api.servers.suggestPorts(game.id);
        setPort(suggestion.port);
        setPortsUsed(suggestion.portsUsed);
        setPortConflict(null);
      } catch {
        // Fallback to default port
        setPort(game.defaultPort);
        calculatePorts(game.defaultPort, game);
      }
    }
  }

  async function handleCreate() {
    if (!selectedGame || !serverName.trim()) {
      setError("Please select a game and enter a server name");
      return;
    }

    if (selectedGame.requiresLogin && !isLoggedIn) {
      setError(
        `${selectedGame.name} requires Steam login. Please login first.`,
      );
      return;
    }

    setLoading(true);
    setError(null);
    setTerminalOutput([]);

    try {
      const response = await api.servers.create({
        gameId: selectedGame.id,
        name: serverName.trim(),
        port: port || selectedGame.defaultPort,
        queryPort:
          selectedGame.queryPortOffset != null
            ? (port || selectedGame.defaultPort) + selectedGame.queryPortOffset
            : undefined,
      });

      // Track the server ID for filtering WebSocket messages
      setInstallingServerId(response.server.id);

      // Installation started - switch to progress view
      setInstalling(true);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  const canCreate =
    selectedGame &&
    serverName.trim() &&
    !portConflict &&
    (!selectedGame.requiresLogin || isLoggedIn);

  return (
    <Dialog open={open} onOpenChange={installing ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-[600px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add Game Server</DialogTitle>
          <DialogDescription>
            {installing
              ? "Installing game server..."
              : "Select a game and configure your server"}
          </DialogDescription>
        </DialogHeader>

        {!installing ? (
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Game Selection */}
            <div className="space-y-2">
              <Label htmlFor="game">Game</Label>
              {loadingGames ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FaSpinner className="h-4 w-4 animate-spin" />
                  Loading available games...
                </div>
              ) : (
                <Select onValueChange={handleGameSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a game..." />
                  </SelectTrigger>
                  <SelectContent>
                    {games.map((game) => (
                      <SelectItem key={game.id} value={game.id}>
                        <div className="flex items-center gap-2">
                          <span>{game.name}</span>
                          {game.requiresLogin && (
                            <FaLock className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Game Info */}
            {selectedGame && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{selectedGame.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      App ID: {selectedGame.appId}
                    </Badge>
                    {selectedGame.requiresLogin ? (
                      <Badge
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        <FaLock className="h-3 w-3" />
                        Login Required
                      </Badge>
                    ) : (
                      <Badge variant="outline">Anonymous</Badge>
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedGame.description}
                </p>

                {selectedGame.requiresLogin && !isLoggedIn && (
                  <Alert variant="destructive" className="mt-2">
                    <FaCircleExclamation className="h-4 w-4" />
                    <AlertDescription>
                      This game requires Steam login. Please login from the
                      dashboard first.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Server Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Server Name</Label>
              <Input
                id="name"
                placeholder="My DayZ Server"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                This will also be used as the installation folder name
              </p>
            </div>

            {/* Port */}
            <div className="space-y-2">
              <Label htmlFor="port">Game Port</Label>
              <Input
                id="port"
                type="number"
                placeholder={selectedGame?.defaultPort.toString() || "2302"}
                value={port || ""}
                onChange={(e) => {
                  const newPort = e.target.value
                    ? parseInt(e.target.value, 10)
                    : undefined;
                  setPort(newPort);
                  calculatePorts(newPort, selectedGame);
                }}
                disabled={loading}
              />
              {portsUsed.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Ports used:{" "}
                  {portsUsed.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ", "}
                      <span className="font-mono">{p}</span>
                    </span>
                  ))}
                </p>
              )}
              {portConflict && (
                <p className="text-xs text-destructive font-medium">
                  {portConflict}
                </p>
              )}
            </div>
          </div>
        ) : (
          // Installation Progress View
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <FaSpinner className="h-4 w-4 animate-spin" />
              <span className="font-medium">
                {installProgress || "Starting installation..."}
              </span>
            </div>

            {/* Terminal Output */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FaTerminal className="h-4 w-4" />
                Installation Output
              </Label>
              <div
                ref={terminalRef}
                className="bg-terminal rounded-md p-3 h-[200px] overflow-y-auto font-mono text-xs text-green-400"
              >
                {terminalOutput.length === 0 ? (
                  <span className="text-muted-foreground">
                    Waiting for output...
                  </span>
                ) : (
                  terminalOutput.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!installing ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!canCreate || loading}>
                {loading ? (
                  <>
                    <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Install Server"
                )}
              </Button>
            </>
          ) : (
            <Button variant="outline" disabled>
              Installation in progress...
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
