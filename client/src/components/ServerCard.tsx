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
import type { GameServer } from "@/types";

interface ServerCardProps {
  server: GameServer;
  onStart: (id: number) => void;
  onStop: (id: number) => void;
  onDelete: (id: number) => void;
}

const statusConfig = {
  stopped: { label: "Stopped", variant: "secondary" as const },
  starting: { label: "Starting", variant: "warning" as const },
  running: { label: "Running", variant: "success" as const },
  stopping: { label: "Stopping", variant: "warning" as const },
  installing: { label: "Installing", variant: "warning" as const },
  updating: { label: "Updating", variant: "warning" as const },
  error: { label: "Error", variant: "destructive" as const },
};

/**
 * Map gameId to a logo file in /game-logos/.
 * Falls back to null if no logo exists for the game.
 */
const gameLogos: Record<string, string> = {
  dayz: "game-logos/dayz.png",
  "7dtd": "game-logos/7daystodie.png",
  ark: "game-logos/ark.png",
};

const gameNames: Record<string, string> = {
  dayz: "DayZ",
  "7dtd": "7 Days to Die",
  ark: "ARK: Survival Evolved",
  rust: "Rust",
  csgo: "Counter-Strike 2",
  valheim: "Valheim",
};

export function ServerCard({
  server,
  onStart,
  onStop,
  onDelete,
}: ServerCardProps) {
  const navigate = useNavigate();
  const status = statusConfig[server.status];
  const gameName = gameNames[server.gameId] || `App ${server.appId}`;
  const gameLogo = gameLogos[server.gameId] || null;
  const isRunning = server.status === "running";
  const isBusy =
    server.status === "installing" ||
    server.status === "updating" ||
    server.status === "starting" ||
    server.status === "stopping";

  function handleOpenServer() {
    navigate(`/server/${server.id}`);
  }

  return (
    <div
      className="group relative rounded-xl border bg-card text-card-foreground shadow overflow-hidden transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 cursor-pointer"
      onClick={handleOpenServer}
    >
      {/* Running indicator glow */}
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-success to-transparent" />
      )}

      {/* Top section — Logo banner + Status */}
      <div className="relative h-24 bg-gradient-to-br from-secondary to-muted flex items-center px-5">
        {gameLogo ? (
          <img
            src={publicAsset(gameLogo)}
            alt={gameName}
            className="h-14 w-auto object-contain drop-shadow-lg"
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
      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-base leading-tight truncate">
            {server.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{gameName}</p>
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
        </div>
      </div>

      {/* Actions bar */}
      <div
        className="flex items-center gap-2 px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        {isBusy ? (
          <Button variant="outline" size="sm" className="flex-1" disabled>
            <FaSpinner className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            {server.status === "installing"
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
          >
            <FaPlay className="h-3.5 w-3.5 mr-1.5" />
            Start
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleOpenServer}>
          <FaArrowUpRightFromSquare className="h-3.5 w-3.5 mr-1.5" />
          Open
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(server.id)}
          disabled={isRunning || isBusy}
        >
          <FaTrashCan className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
