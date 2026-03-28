import { useEffect, useState, useCallback } from "react";
import {
  FaServer,
  FaHardDrive,
  FaNetworkWired,
  FaClock,
  FaFloppyDisk,
  FaRotateLeft,
  FaCircleExclamation,
  FaPencil,
  FaChevronDown,
  FaFolder,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBackend } from "@/hooks/useBackend";
import { useUptime } from "@/hooks/useUptime";
import { useGameCapabilities } from "@/hooks/useGameCapabilities";
import { toastSuccess } from "@/lib/toast";
import { getGameName } from "@/components/server-details/games/registry";
import { Tip } from "@/components/ui/tooltip";
import type { GameServer, GameDefinition } from "@/types";

interface OverviewTabProps {
  server: GameServer;
  onRefresh?: () => void;
}

// Module-level cache so disk usage survives tab switches
const diskUsageCache = new Map<number, string>();

export function OverviewTab({ server, onRefresh }: OverviewTabProps) {
  const { api, isConnected } = useBackend();
  const { capabilities } = useGameCapabilities(server.gameId);
  const hasProfilesPath = capabilities?.profilesPath !== false;
  // Server name editing
  const [editingName, setEditingName] = useState(false);
  const [serverName, setServerName] = useState(server.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Launch params editing
  const [editingParams, setEditingParams] = useState(false);
  const [launchParams, setLaunchParams] = useState(server.launchParams || "");
  const [defaultLaunchParams, setDefaultLaunchParams] = useState<string | null>(
    null,
  );
  const [paramsSaving, setParamsSaving] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);

  // Profiles path editing
  const [editingProfilesPath, setEditingProfilesPath] = useState(false);
  const [profilesPath, setProfilesPath] = useState(
    server.profilesPath || "profiles",
  );
  const [profilesSaving, setProfilesSaving] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [availableDirs, setAvailableDirs] = useState<string[]>([]);
  const [showDirPicker, setShowDirPicker] = useState(false);

  // Port editing
  const [editingPorts, setEditingPorts] = useState(false);
  const [gamePort, setGamePort] = useState(server.port.toString());
  const [queryPort, setQueryPort] = useState(
    (server.queryPort || "").toString(),
  );
  const [portsSaving, setPortsSaving] = useState(false);
  const [portsError, setPortsError] = useState<string | null>(null);

  // Disk usage — initialize from cache for instant display, refresh in background
  const [diskUsage, setDiskUsage] = useState<string | null>(
    () => diskUsageCache.get(server.id) ?? null,
  );
  const [diskLoading, setDiskLoading] = useState(
    !diskUsageCache.has(server.id),
  );

  // Sync local state when server prop changes
  useEffect(() => {
    setServerName(server.name);
  }, [server.name]);

  useEffect(() => {
    setLaunchParams(server.launchParams || "");
  }, [server.launchParams]);

  useEffect(() => {
    setProfilesPath(server.profilesPath || "profiles");
  }, [server.profilesPath]);

  useEffect(() => {
    setGamePort(server.port.toString());
    setQueryPort((server.queryPort || "").toString());
  }, [server.port, server.queryPort]);

  // Fetch default launch params for the game
  useEffect(() => {
    if (!isConnected) return;
    api.servers
      .getAvailableGames()
      .then((games: GameDefinition[]) => {
        const game = games.find((g) => g.id === server.gameId);
        if (game) {
          setDefaultLaunchParams(game.defaultLaunchParams);
        }
      })
      .catch(() => {});
  }, [server.gameId, api.servers, isConnected]);

  const handleSaveLaunchParams = useCallback(async () => {
    setParamsSaving(true);
    setParamsError(null);
    try {
      await api.servers.updateLaunchParams(server.id, launchParams);
      toastSuccess("Launch parameters saved");
      setEditingParams(false);
      onRefresh?.();
    } catch (err) {
      setParamsError((err as Error).message);
    } finally {
      setParamsSaving(false);
    }
  }, [server.id, launchParams, onRefresh, api.servers]);

  function handleRevertParams() {
    setLaunchParams(server.launchParams || "");
    setParamsError(null);
  }

  function handleResetToDefault() {
    if (defaultLaunchParams !== null) {
      setLaunchParams(defaultLaunchParams);
    }
  }

  const handleSaveName = useCallback(async () => {
    if (!serverName.trim()) {
      setNameError("Name cannot be empty");
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      await api.servers.updateName(server.id, serverName.trim());
      toastSuccess("Server name updated");
      setEditingName(false);
      onRefresh?.();
    } catch (err) {
      setNameError((err as Error).message);
    } finally {
      setNameSaving(false);
    }
  }, [server.id, serverName, onRefresh, api.servers]);

  function handleRevertName() {
    setServerName(server.name);
    setNameError(null);
  }

  const nameChanged = serverName !== server.name;

  // Load disk usage in background — cache result for instant display on next visit
  useEffect(() => {
    if (!isConnected) return;
    setDiskLoading(true);
    api.servers
      .getDiskUsage(server.id)
      .then((result) => {
        diskUsageCache.set(server.id, result.sizeFormatted);
        setDiskUsage(result.sizeFormatted);
      })
      .catch(() => {})
      .finally(() => setDiskLoading(false));
  }, [server.id, api.servers, isConnected]);

  const handleSaveProfilesPath = useCallback(async () => {
    setProfilesSaving(true);
    setProfilesError(null);
    try {
      await api.servers.updateProfilesPath(server.id, profilesPath);
      toastSuccess("Profiles path saved");
      setEditingProfilesPath(false);
      onRefresh?.();
    } catch (err) {
      setProfilesError((err as Error).message);
    } finally {
      setProfilesSaving(false);
    }
  }, [server.id, profilesPath, onRefresh, api.servers]);

  const loadDirectories = useCallback(async () => {
    try {
      const result = await api.servers.getDirectories(server.id);
      setAvailableDirs(result.directories);
    } catch {
      setAvailableDirs([]);
    }
  }, [server.id, api.servers]);

  function handleRevertProfilesPath() {
    setProfilesPath(server.profilesPath || "profiles");
    setProfilesError(null);
  }

  const profilesPathChanged =
    profilesPath !== (server.profilesPath || "profiles");

  const handleSavePorts = useCallback(async () => {
    const portNum = parseInt(gamePort, 10);
    const queryPortNum = queryPort.trim() ? parseInt(queryPort, 10) : null;

    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setPortsError("Game Port must be between 1 and 65535");
      return;
    }
    if (
      queryPortNum !== null &&
      (isNaN(queryPortNum) || queryPortNum < 1 || queryPortNum > 65535)
    ) {
      setPortsError("Query Port must be between 1 and 65535");
      return;
    }

    setPortsSaving(true);
    setPortsError(null);
    try {
      await api.servers.updatePorts(server.id, portNum, queryPortNum);
      toastSuccess("Ports updated");
      setEditingPorts(false);
      onRefresh?.();
    } catch (err) {
      setPortsError((err as Error).message);
    } finally {
      setPortsSaving(false);
    }
  }, [server.id, gamePort, queryPort, onRefresh, api.servers]);

  function handleRevertPorts() {
    setGamePort(server.port.toString());
    setQueryPort((server.queryPort || "").toString());
    setPortsError(null);
  }

  const portsChanged =
    gamePort !== server.port.toString() ||
    queryPort !== (server.queryPort || "").toString();

  const paramsChanged = launchParams !== (server.launchParams || "");
  const gameName = getGameName(server.gameId);
  const createdDate = new Date(server.createdAt).toLocaleDateString();
  const isRunning = server.status === "running";
  const uptime = useUptime(isRunning ? server.startedAt : null);

  return (
    <div className="space-y-0">
      {/* Messages */}
      {(paramsError || portsError) && (
        <Alert variant="destructive" className="mb-6">
          <FaCircleExclamation className="h-4 w-4" />
          <AlertDescription>{paramsError || portsError}</AlertDescription>
        </Alert>
      )}

      {/* Metadata bar */}
      <div className="grid grid-cols-2 gap-3 pb-4 border-b items-center sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
        <div className="flex items-center gap-2">
          <FaServer className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Game</span>
          <span className="text-sm font-semibold">{gameName}</span>
          <span className="text-xs text-muted-foreground font-mono">
            ({server.appId})
          </span>
        </div>

        <div className="hidden sm:block h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          <FaNetworkWired className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Port</span>
          <span className="text-sm font-semibold font-mono">{server.port}</span>
          {server.queryPort && (
            <span className="text-xs text-muted-foreground font-mono">
              / {server.queryPort}
            </span>
          )}
        </div>

        <div className="hidden sm:block h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          <FaClock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Created</span>
          <span className="text-sm font-semibold">{createdDate}</span>
        </div>

        <div className="hidden sm:block h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          <FaHardDrive
            className={`h-3.5 w-3.5 text-muted-foreground${diskLoading && !diskUsage ? " animate-pulse" : ""}`}
          />
          <span className="text-sm text-muted-foreground">Disk</span>
          <span
            className={`text-sm font-semibold${diskLoading && !diskUsage ? " animate-pulse text-muted-foreground" : ""}`}
          >
            {diskUsage ?? "Calculating..."}
          </span>
        </div>

        {(uptime || server.pid) && (
          <>
            <div className="hidden sm:block h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <FaClock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Uptime</span>
              <span className="text-sm font-semibold font-mono tabular-nums">
                {uptime}
              </span>
              {server.pid && (
                <span className="text-xs text-muted-foreground font-mono">
                  PID {server.pid}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Section A — Identity & Network */}
      <div className="grid lg:grid-cols-2 gap-x-8 gap-y-6 py-6 border-b">
        {/* Server Name (editable) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-muted-foreground">
              Server Name
            </label>
            <div className="flex items-center gap-2">
              {editingName ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      handleRevertName();
                      setEditingName(false);
                    }}
                    disabled={nameSaving}
                  >
                    <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveName}
                    disabled={!nameChanged || nameSaving}
                  >
                    <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                    {nameSaving ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingName(true)}
                >
                  <FaPencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
            </div>
          </div>
          {editingName ? (
            <div className="space-y-2">
              <Input
                className="text-sm"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                maxLength={100}
                placeholder="Server name..."
              />
              {nameError && <p className="text-xs text-red-500">{nameError}</p>}
            </div>
          ) : (
            <p className="text-sm font-mono bg-muted p-2 rounded break-all">
              {server.name}
            </p>
          )}
        </div>

        {/* Ports (editable) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-muted-foreground">
              Ports
            </label>
            <div className="flex items-center gap-2">
              {editingPorts ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      handleRevertPorts();
                      setEditingPorts(false);
                    }}
                    disabled={portsSaving}
                  >
                    <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSavePorts}
                    disabled={!portsChanged || portsSaving}
                  >
                    <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                    {portsSaving ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingPorts(true)}
                >
                  <FaPencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
            </div>
          </div>
          {editingPorts ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Game Port
                  </label>
                  <Input
                    className="font-mono text-sm"
                    type="number"
                    min={1}
                    max={65535}
                    value={gamePort}
                    onChange={(e) => setGamePort(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Query Port
                  </label>
                  <Input
                    className="font-mono text-sm"
                    type="number"
                    min={1}
                    max={65535}
                    value={queryPort}
                    onChange={(e) => setQueryPort(e.target.value)}
                    placeholder="Auto"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The game port is used as{" "}
                <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                  {"{PORT}"}
                </code>{" "}
                in launch parameters. Leave query port empty for the game
                default.
              </p>
              {portsError && (
                <p className="text-xs text-red-500">{portsError}</p>
              )}
            </div>
          ) : (
            <div className="flex gap-4">
              <p className="text-sm font-mono bg-muted p-2 rounded flex-1">
                Game: <span className="text-primary">{server.port}</span>
              </p>
              <p className="text-sm font-mono bg-muted p-2 rounded flex-1">
                Query:{" "}
                <span className="text-primary">
                  {server.queryPort || (
                    <span className="text-muted-foreground">auto</span>
                  )}
                </span>
              </p>
            </div>
          )}
          {editingPorts && server.status === "running" && (
            <p className="text-xs text-yellow-500 mt-1">
              Changes will take effect after the next server restart.
            </p>
          )}
        </div>
      </div>

      {/* Section B — Paths */}
      <div className="grid lg:grid-cols-2 gap-x-8 gap-y-6 py-6 border-b">
        {/* Install Path (read-only) */}
        <div className={hasProfilesPath ? "" : "lg:col-span-2"}>
          <label className="text-sm font-medium text-muted-foreground">
            Install Path
          </label>
          <p className="text-sm font-mono bg-muted p-2 rounded mt-1 break-all">
            {server.installPath}
          </p>
        </div>

        {/* Profiles Path (editable, only for games that use it) */}
        {hasProfilesPath && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-muted-foreground">
                Profiles Path
              </label>
              <div className="flex items-center gap-2">
                {editingProfilesPath ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleRevertProfilesPath();
                        setEditingProfilesPath(false);
                        setShowDirPicker(false);
                      }}
                      disabled={profilesSaving}
                    >
                      <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveProfilesPath}
                      disabled={!profilesPathChanged || profilesSaving}
                    >
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                      {profilesSaving ? "Saving..." : "Save"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingProfilesPath(true);
                      loadDirectories();
                    }}
                  >
                    <FaPencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
            {editingProfilesPath ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-sm flex-1"
                    value={profilesPath}
                    onChange={(e) => setProfilesPath(e.target.value)}
                    spellCheck={false}
                    placeholder="e.g. profiles or profiles/config1"
                  />
                  <Tip content="Browse existing folders">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDirPicker(!showDirPicker)}
                      className="shrink-0"
                    >
                      <FaChevronDown className="h-4 w-4" />
                    </Button>
                  </Tip>
                </div>
                {showDirPicker && availableDirs.length > 0 && (
                  <div className="rounded border bg-muted/50 max-h-[160px] overflow-y-auto">
                    {availableDirs.map((dir) => (
                      <button
                        key={dir}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors ${
                          profilesPath === dir
                            ? "bg-muted font-medium text-primary"
                            : ""
                        }`}
                        onClick={() => {
                          setProfilesPath(dir);
                          setShowDirPicker(false);
                        }}
                      >
                        <FaFolder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono truncate">{dir}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showDirPicker && availableDirs.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1">
                    No folders found in the server directory.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Relative paths resolve from the install directory. You can
                  also type a subfolder path like{" "}
                  <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                    profiles/myconfig
                  </code>
                  . Used as{" "}
                  <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                    {"{PROFILES}"}
                  </code>{" "}
                  in launch parameters.
                </p>
                {profilesError && (
                  <p className="text-xs text-red-500">{profilesError}</p>
                )}
              </div>
            ) : (
              <p className="text-sm font-mono bg-muted p-2 rounded break-all">
                {server.profilesPath || "profiles"}
              </p>
            )}
            {editingProfilesPath && server.status === "running" && (
              <p className="text-xs text-yellow-500 mt-1">
                Changes will take effect after the next server restart.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Section C — Launch Parameters */}
      <div className="py-6">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-muted-foreground">
            Launch Parameters
          </label>
          <div className="flex items-center gap-2">
            {editingParams ? (
              <>
                {defaultLaunchParams !== null && (
                  <Tip content="Reset to game default parameters">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResetToDefault}
                      disabled={paramsSaving}
                    >
                      Default
                    </Button>
                  </Tip>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleRevertParams();
                    setEditingParams(false);
                  }}
                  disabled={paramsSaving}
                >
                  <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveLaunchParams}
                  disabled={!paramsChanged || paramsSaving}
                >
                  <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                  {paramsSaving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingParams(true)}
              >
                <FaPencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
          </div>
        </div>
        {editingParams ? (
          <div className="space-y-2">
            <Textarea
              className="font-mono text-sm min-h-[80px]"
              value={launchParams}
              onChange={(e) => setLaunchParams(e.target.value)}
              spellCheck={false}
              placeholder="Enter launch parameters..."
            />
            {/* Compact placeholder reference */}
            <p className="text-xs text-muted-foreground">
              Placeholders:{" "}
              <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                {"{PORT}"}
              </code>{" "}
              <span className="text-muted-foreground/70">({server.port})</span>{" "}
              {hasProfilesPath && (
                <>
                  <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                    {"{PROFILES}"}
                  </code>{" "}
                  <span className="text-muted-foreground/70">
                    ({server.profilesPath || "profiles"})
                  </span>{" "}
                </>
              )}
              <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                {"{INSTALL_PATH}"}
              </code>{" "}
              <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                {"{SERVER_NAME}"}
              </code>
            </p>
          </div>
        ) : (
          <p className="text-sm font-mono bg-muted p-2 rounded break-all">
            {server.launchParams || (
              <span className="text-muted-foreground">
                No custom parameters
              </span>
            )}
          </p>
        )}
        {editingParams && server.status === "running" && (
          <p className="text-xs text-yellow-500 mt-1">
            Changes will take effect after the next server restart.
          </p>
        )}
      </div>
    </div>
  );
}
