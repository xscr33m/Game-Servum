import { useNavigate } from "react-router-dom";
import {
  FaPlay,
  FaStop,
  FaTrashCan,
  FaArrowUpRightFromSquare,
  FaSpinner,
  FaXmark,
  FaUsers,
  FaPuzzlePiece,
  FaCircleExclamation,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { publicAsset } from "@/lib/assets";
import {
  getGameName,
  getGameLogo,
} from "@/components/server-details/games/registry";
import { useUptime } from "@/hooks/useUptime";
import { Tip } from "@/components/ui/tooltip";
import type { GameServer } from "@/types";

interface ServerCardProps {
  server: GameServer;
  onStart: (id: number) => void;
  onStop: (id: number) => void;
  onDelete: (id: number) => void;
  onCancelInstall?: (id: number) => void;
  disabled?: boolean;
  installProgress?: { percent: number; message: string };
}

const statusConfig = {
  stopped: { label: "Stopped", variant: "secondary" as const },
  starting: { label: "Starting", variant: "warning" as const },
  running: { label: "Running", variant: "success" as const },
  stopping: { label: "Stopping", variant: "warning" as const },
  queued: { label: "Queued", variant: "secondary" as const },
  installing: { label: "Installing", variant: "success" as const },
  updating: { label: "Updating", variant: "warning" as const },
  deleting: { label: "Deleting", variant: "destructive" as const },
  error: { label: "Error", variant: "destructive" as const },
};

export function ServerCard({
  server,
  onStart,
  onStop,
  onDelete,
  onCancelInstall,
  disabled = false,
  installProgress,
}: ServerCardProps) {
  const navigate = useNavigate();
  const status = statusConfig[server.status];
  const gameName = getGameName(server.gameId, `App ${server.appId}`);
  const gameLogo = getGameLogo(server.gameId);
  const isRunning = server.status === "running";
  const uptime = useUptime(isRunning ? server.startedAt : null);
  const isBusy =
    server.status === "queued" ||
    server.status === "installing" ||
    server.status === "updating" ||
    server.status === "starting" ||
    server.status === "stopping" ||
    server.status === "deleting";

  const hoverGlowClass = isRunning
    ? "hover:server-card-glow-success"
    : server.status === "error"
      ? "hover:server-card-glow-error"
      : "hover:server-card-glow";

  const onlinePlayerCount = server.onlinePlayerCount ?? 0;
  const modCount = server.modCount ?? 0;
  const hasUpdate = server.hasPendingUpdateRestart === true;

  // Short version: first two numeric segments (e.g., "1.29" from "1.29.155939")
  const fullVersion = server.version ?? null;
  const shortVersion = fullVersion
    ? fullVersion.replace(/^(\d+\.\d+).*/, "$1")
    : null;

  function handleOpenServer() {
    if (disabled || server.status === "deleting") return;
    navigate(`/server/${server.id}`);
  }

  return (
    <div
      className={`group relative rounded-xl border bg-card text-card-foreground shadow-md overflow-hidden transition-all duration-300 ease-out ${disabled || server.status === "deleting" ? "opacity-75 cursor-default" : `${hoverGlowClass} cursor-pointer`}`}
      onClick={handleOpenServer}
    >
      {/* Running indicator glow */}
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-success to-transparent" />
      )}
      {server.status === "error" && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-destructive to-transparent" />
      )}

      {/* Top section — Logo banner + Status + Stats */}
      <div className="relative h-20 sm:h-28 bg-gradient-to-br from-secondary/80 to-muted/60 flex items-center px-3 sm:px-5">
        {gameLogo ? (
          <img
            src={publicAsset(gameLogo)}
            alt={gameName}
            className="h-12 sm:h-16 w-auto object-contain drop-shadow-lg"
          />
        ) : (
          <span className="text-lg font-bold text-muted-foreground/60">
            {gameName}
          </span>
        )}

        {/* Right side — Status badge + stats column */}
        <div className="absolute top-2 right-3 flex flex-col items-end gap-1.5">
          <Badge variant={status.variant}>
            {server.status === "installing" &&
            installProgress &&
            installProgress.percent > 0
              ? `Installing`
              : status.label}
          </Badge>

          {/* Stats — compact right-aligned column */}
          <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground/80">
            {shortVersion && (
              <Tip
                content={
                  fullVersion !== shortVersion
                    ? `v${fullVersion}`
                    : `v${shortVersion}`
                }
              >
                <span className="font-mono">v{shortVersion}</span>
              </Tip>
            )}
            {isRunning && (
              <span className="flex items-center gap-1 font-mono">
                <FaUsers className="h-2.5 w-2.5" />
                {onlinePlayerCount}
              </span>
            )}
            {modCount > 0 && (
              <span className="flex items-center gap-1 font-mono">
                <FaPuzzlePiece className="h-2.5 w-2.5" />
                {modCount}
              </span>
            )}
            {hasUpdate && (
              <Tip content="Update available">
                <span className="flex items-center gap-1 text-warning">
                  <FaCircleExclamation className="h-2.5 w-2.5" />
                  Update
                </span>
              </Tip>
            )}
          </div>
        </div>
      </div>

      {/* Server info */}
      <div className="px-3 sm:px-5 pt-3 sm:pt-4 pb-2 space-y-2 sm:space-y-3">
        <div>
          <h3 className="font-semibold text-base leading-tight truncate">
            {server.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">{gameName}</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="uppercase tracking-wider font-medium">Port</span>
            <span className="text-foreground font-mono">{server.port}</span>
          </div>
          {server.queryPort && (
            <div className="flex items-center gap-1.5">
              <span className="uppercase tracking-wider font-medium">
                Query
              </span>
              <span className="text-foreground font-mono">
                {server.queryPort}
              </span>
            </div>
          )}
          {uptime && (
            <div className="flex items-center gap-1.5">
              <span className="uppercase tracking-wider font-medium">
                Uptime
              </span>
              <span className="text-foreground font-mono tabular-nums">
                {uptime}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Separator */}
      <div className="mx-3 sm:mx-5 border-t border-border/50" />

      {/* Actions bar */}
      <div
        className="flex items-center gap-2 px-3 sm:px-5 py-2.5 sm:py-3"
        onClick={(e) => e.stopPropagation()}
      >
        {isBusy ? (
          server.status === "installing" &&
          installProgress &&
          installProgress.percent > 0 ? (
            <div className="flex-1 space-y-1.5">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all duration-500 ease-out"
                  style={{ width: `${installProgress.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {installProgress.message}
              </p>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="flex-1" disabled>
              <FaSpinner className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              {server.status === "queued"
                ? "Queued..."
                : server.status === "installing"
                  ? "Installing..."
                  : server.status === "updating"
                    ? "Updating..."
                    : server.status === "starting"
                      ? "Starting..."
                      : server.status === "deleting"
                        ? "Deleting..."
                        : "Stopping..."}
            </Button>
          )
        ) : isRunning ? (
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={() => onStop(server.id)}
            disabled={disabled}
          >
            <FaStop className="h-3.5 w-3.5 mr-1.5" />
            Stop
          </Button>
        ) : (
          <Button
            variant="success"
            size="sm"
            className="flex-1"
            onClick={() => onStart(server.id)}
            disabled={disabled}
          >
            <FaPlay className="h-3.5 w-3.5 mr-1.5" />
            Start
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenServer}
          disabled={disabled}
        >
          <FaArrowUpRightFromSquare className="h-3.5 w-3.5 mr-1.5" />
          Open
        </Button>
        {(server.status === "installing" || server.status === "queued") &&
        onCancelInstall ? (
          <Tip content="Cancel Installation">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onCancelInstall(server.id)}
              disabled={disabled}
            >
              <FaXmark className="h-4 w-4" />
            </Button>
          </Tip>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(server.id)}
            disabled={isRunning || isBusy || disabled}
          >
            <FaTrashCan className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
