import { useState, useEffect, useCallback } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  FaSpinner,
  FaCircleExclamation,
  FaLock,
  FaRightToBracket,
  FaArrowLeft,
  FaCheck,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";
import { SteamAccountDialog } from "@/components/agent/SteamAccountDialog";
import { publicAsset } from "@/lib/assets";
import { getGameLogo } from "@/components/server-details/games/registry";
import { toastSuccess } from "@/lib/toast";
import { STEAM_RESERVED_PORT_RANGES } from "@game-servum/shared";
import type { GameDefinition, GameServer, SteamCMDStatus } from "@/types";

type WizardStep = "select-game" | "steam-login" | "configure";

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerCreated: () => void;
  steamcmd: SteamCMDStatus | null;
  onSteamStatusChange: () => void;
}

export function AddServerDialog({
  open,
  onOpenChange,
  onServerCreated,
  steamcmd,
  onSteamStatusChange,
}: AddServerDialogProps) {
  const [step, setStep] = useState<WizardStep>("select-game");
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
  const [showSteamLogin, setShowSteamLogin] = useState(false);

  const isLoggedIn = steamcmd?.loggedIn ?? false;

  const { api } = useBackend();

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
      setStep("select-game");
      setSelectedGame(null);
      setServerName("");
      setPort(undefined);
      setPortsUsed([]);
      setPortConflict(null);
      setError(null);
      setShowSteamLogin(false);
    }
  }, [open, loadGames, loadUsedPorts, loadExistingServers]);

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

  function buildOccupiedPorts(): Set<number> {
    const occupied = new Set<number>();
    for (const s of usedPorts) {
      const gameDef = games.find((g) => g.id === s.gameId);
      if (gameDef) {
        // Use firewallRules as source of truth for port enumeration
        if (gameDef.firewallRules && gameDef.firewallRules.length > 0) {
          for (const rule of gameDef.firewallRules) {
            for (let i = 0; i < rule.portCount; i++) {
              occupied.add(s.port + rule.portOffset + i);
            }
          }
        } else {
          for (let i = 0; i < gameDef.portCount; i++) {
            occupied.add(s.port + i);
          }
          if (gameDef.queryPortOffset != null) {
            occupied.add(s.port + gameDef.queryPortOffset);
          }
        }
      } else {
        occupied.add(s.port);
        if (s.queryPort) occupied.add(s.queryPort);
      }
    }
    return occupied;
  }

  /** Compute all ports a server would use based on firewallRules */
  function getPortsForGame(basePort: number, game: GameDefinition): number[] {
    const ports = new Set<number>();
    if (game.firewallRules && game.firewallRules.length > 0) {
      for (const rule of game.firewallRules) {
        for (let i = 0; i < rule.portCount; i++) {
          ports.add(basePort + rule.portOffset + i);
        }
      }
    } else {
      for (let i = 0; i < game.portCount; i++) {
        ports.add(basePort + i);
      }
      if (game.queryPortOffset != null) {
        ports.add(basePort + game.queryPortOffset);
      }
    }
    return Array.from(ports).sort((a, b) => a - b);
  }

  function calculatePorts(
    basePort: number | undefined,
    game: GameDefinition | null,
  ) {
    if (!basePort || !game) {
      setPortsUsed([]);
      setPortConflict(null);
      return;
    }

    const ports = getPortsForGame(basePort, game);
    setPortsUsed(ports);

    const occupied = buildOccupiedPorts();
    const conflicts: string[] = [];
    for (const p of ports) {
      if (occupied.has(p)) {
        const conflictServer = usedPorts.find((s) => {
          const sd = games.find((g) => g.id === s.gameId);
          if (sd) {
            return getPortsForGame(s.port, sd).includes(p);
          }
          return s.port === p || s.queryPort === p;
        });
        conflicts.push(
          `Port ${p} is already used by "${conflictServer?.name || "unknown"}"`,
        );
      }
      if (STEAM_RESERVED_PORT_RANGES.some(([lo, hi]) => p >= lo && p <= hi)) {
        conflicts.push(
          `Port ${p} conflicts with Steam internal ports (27030–27050)`,
        );
      }
    }
    setPortConflict(conflicts.length > 0 ? conflicts.join(". ") : null);
  }

  async function handleGameSelect(game: GameDefinition) {
    setSelectedGame(game);
    setError(null);

    // Auto-suggest server name and port
    setServerName(generateServerName(game));
    try {
      const suggestion = await api.servers.suggestPorts(game.id);
      setPort(suggestion.port);
      setPortsUsed(suggestion.portsUsed);
      setPortConflict(null);
    } catch {
      setPort(game.defaultPort);
      calculatePorts(game.defaultPort, game);
    }

    // Decide next step
    if (game.requiresLogin && !isLoggedIn) {
      setStep("steam-login");
    } else {
      setStep("configure");
    }
  }

  function handleBack() {
    setError(null);
    if (step === "configure") {
      if (selectedGame?.requiresLogin && !isLoggedIn) {
        setStep("steam-login");
      } else {
        setStep("select-game");
      }
    } else if (step === "steam-login") {
      setStep("select-game");
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

      toastSuccess(
        `Installation started for ${response.server.name || serverName}`,
      );
      onServerCreated();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const canCreate =
    selectedGame &&
    serverName.trim() &&
    !portConflict &&
    (!selectedGame.requiresLogin || isLoggedIn);

  const stepTitles: Record<WizardStep, { title: string; description: string }> =
    {
      "select-game": {
        title: "Select a Game",
        description: "Choose which game server you want to install",
      },
      "steam-login": {
        title: "Steam Login Required",
        description: `${selectedGame?.name || "This game"} requires a Steam account to download`,
      },
      configure: {
        title: "Configure Server",
        description: `Set up your ${selectedGame?.name || ""} server`,
      },
    };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{stepTitles[step].title}</DialogTitle>
            <DialogDescription>
              {stepTitles[step].description}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator — always 2 steps: Select Game → Configure */}
          <div className="flex items-center gap-2 px-1">
            {[0, 1].map((i) => {
              const isFilled = i === 0 || (i === 1 && step === "configure");
              return (
                <div key={i} className="flex items-center gap-2 flex-1">
                  <div
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      isFilled ? "bg-primary" : "bg-muted"
                    }`}
                  />
                  {i < 1 && <div className="w-1" />}
                </div>
              );
            })}
          </div>

          <div className="py-2">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Step 1: Game Selection Grid */}
            {step === "select-game" && (
              <div className="space-y-3">
                {loadingGames ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <FaSpinner className="h-5 w-5 animate-spin mr-2" />
                    Loading available games...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {games.map((game) => {
                      const logo = getGameLogo(game.id);
                      return (
                        <button
                          key={game.id}
                          type="button"
                          onClick={() => handleGameSelect(game)}
                          className={`group relative rounded-xl border-2 p-4 text-left transition-all hover:cursor-pointer hover:border-ring/50 hover:shadow-md ${
                            selectedGame?.id === game.id
                              ? "border-ring bg-ring/5"
                              : "border-border bg-card"
                          }`}
                        >
                          <div className="flex flex-col items-center gap-3">
                            {logo ? (
                              <img
                                src={publicAsset(logo)}
                                alt={game.name}
                                className="h-12 w-auto object-contain"
                              />
                            ) : (
                              <div className="h-12 flex items-center justify-center">
                                <span className="text-lg font-bold text-muted-foreground/60">
                                  {game.name}
                                </span>
                              </div>
                            )}
                            <div className="text-center w-full">
                              <div className="font-medium text-sm">
                                {game.name}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {game.description}
                              </div>
                            </div>
                          </div>
                          {game.requiresLogin && (
                            <div className="absolute top-2 right-2">
                              <FaLock className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Steam Login (conditional) */}
            {step === "steam-login" && selectedGame && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {getGameLogo(selectedGame.id) && (
                      <img
                        src={publicAsset(getGameLogo(selectedGame.id)!)}
                        alt={selectedGame.name}
                        className="h-10 w-auto object-contain"
                      />
                    )}
                    <div>
                      <span className="font-medium">{selectedGame.name}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary">
                          App ID: {selectedGame.appId}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="flex items-center gap-1"
                        >
                          <FaLock className="h-3 w-3" />
                          Login Required
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {isLoggedIn ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/5 p-3">
                    <FaCheck className="h-4 w-4 text-success shrink-0" />
                    <span className="text-sm">
                      Logged in as <strong>{steamcmd?.username}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/5 p-3 text-warning">
                    <div className="flex items-center gap-2.5">
                      <FaCircleExclamation className="h-4 w-4 shrink-0" />
                      <span className="text-sm">
                        This game requires a Steam login to download.
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setShowSteamLogin(true)}
                    >
                      <FaRightToBracket className="h-3.5 w-3.5 mr-1.5" />
                      Log in
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Server Configuration */}
            {step === "configure" && selectedGame && (
              <div className="space-y-4">
                {/* Selected game summary */}
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    {getGameLogo(selectedGame.id) && (
                      <img
                        src={publicAsset(getGameLogo(selectedGame.id)!)}
                        alt={selectedGame.name}
                        className="h-8 w-auto object-contain"
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{selectedGame.name}</span>
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
                </div>

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
                  {portsUsed.length > 0 && selectedGame && (
                    <p className="text-xs text-muted-foreground">
                      {selectedGame.firewallRules &&
                      selectedGame.firewallRules.length > 0
                        ? selectedGame.firewallRules.map((rule, i) => {
                            const start =
                              (port || selectedGame.defaultPort) +
                              rule.portOffset;
                            const end = start + rule.portCount - 1;
                            const portRange =
                              start === end ? String(start) : `${start}–${end}`;
                            return (
                              <span key={i}>
                                {i > 0 && ", "}
                                <span className="font-mono">
                                  {portRange}
                                </span>{" "}
                                <span className="text-muted-foreground/70">
                                  {rule.protocol} ({rule.description})
                                </span>
                              </span>
                            );
                          })
                        : portsUsed.map((p, i) => (
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
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {step === "select-game" ? (
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={loading}
                  className="w-full sm:w-auto"
                >
                  <FaArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back
                </Button>
                {step === "steam-login" && isLoggedIn && (
                  <Button
                    onClick={() => setStep("configure")}
                    className="w-full sm:w-auto"
                  >
                    Continue
                  </Button>
                )}
                {step === "configure" && (
                  <Button
                    onClick={handleCreate}
                    disabled={!canCreate || loading}
                    className="w-full sm:w-auto"
                  >
                    {loading ? (
                      <>
                        <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      "Install Server"
                    )}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Steam Account Dialog — opens as overlay on top of AddServerDialog */}
      <SteamAccountDialog
        open={showSteamLogin}
        onOpenChange={setShowSteamLogin}
        steamcmd={steamcmd}
        onStatusChange={onSteamStatusChange}
      />
    </>
  );
}
