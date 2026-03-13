import { useNavigate } from "react-router-dom";
import {
  FaPlay,
  FaStop,
  FaTrashCan,
  FaArrowUpRightFromSquare,
  FaSpinner,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { publicAsset } from "@/lib/assets";
import { getGameName, getGameLogo } from "@/components/server/games/registry";
import { useUptime } from "@/hooks/useUptime";
import type { GameServer } from "@/types";

interface ServerCardProps {
  server: GameServer;
  onStart: (id: number) => void;
  onStop: (id: number) => void;
  onDelete: (id: number) => void;
  disabled?: boolean;
}

const statusConfig = {
  stopped: { label: "Stopped", variant: "secondary" as const },
  starting: { label: "Starting", variant: "warning" as const },
  running: { label: "Running", variant: "success" as const },
  stopping: { label: "Stopping", variant: "warning" as const },
  queued: { label: "Queued", variant: "secondary" as const },
  installing: { label: "Installing", variant: "warning" as const },
  updating: { label: "Updating", variant: "warning" as const },
  error: { label: "Error", variant: "destructive" as const },
};

export function ServerCard({
  server,
  onStart,
  onStop,
  onDelete,
  disabled = false,
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
    server.status === "stopping";

  const hoverGlowClass = isRunning
    ? "hover:server-card-glow-success"
    : server.status === "error"
      ? "hover:server-card-glow-error"
      : "hover:server-card-glow";

  function handleOpenServer() {
    if (disabled) return;
    navigate(`/server/${server.id}`);
  }

  return (
    <div
      className={`group relative rounded-xl border bg-card text-card-foreground shadow-md overflow-hidden transition-all duration-300 ease-out ${disabled ? "opacity-75 cursor-default" : `${hoverGlowClass} cursor-pointer`}`}
      onClick={handleOpenServer}
    >
      {/* Running indicator glow */}
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-success to-transparent" />
      )}
      {server.status === "error" && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-destructive to-transparent" />
      )}

      {/* Top section — Logo banner + Status */}
      <div className="relative h-28 bg-gradient-to-br from-secondary/80 to-muted/60 flex items-center px-5">
        {gameLogo ? (
          <img
            src={publicAsset(gameLogo)}
            alt={gameName}
            className="h-16 w-auto object-contain drop-shadow-lg"
          />
        ) : (
          <span className="text-lg font-bold text-muted-foreground/60">
            {gameName}
          </span>
        )}
        <div className="absolute top-3 right-3">
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
      </div>

      {/* Server info */}
      <div className="px-5 pt-4 pb-2 space-y-3">
        <div>
          <h3 className="font-semibold text-base leading-tight truncate">
            {server.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">{gameName}</p>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
      <div className="mx-5 border-t border-border/50" />

      {/* Actions bar */}
      <div
        className="flex items-center gap-2 px-5 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        {isBusy ? (
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
                    : "Stopping..."}
          </Button>
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
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(server.id)}
          disabled={isRunning || isBusy || disabled}
        >
          <FaTrashCan className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
