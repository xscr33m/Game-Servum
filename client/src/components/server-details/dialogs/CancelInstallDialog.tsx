import { useState } from "react";
import { FaTriangleExclamation, FaServer } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getGameName,
  getGameLogo,
} from "@/components/server-details/games/registry";
import { publicAsset } from "@/lib/assets";
import type { GameServer } from "@/types";

interface CancelInstallDialogProps {
  server: GameServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (server: GameServer) => Promise<void>;
}

export function CancelInstallDialog({
  server,
  open,
  onOpenChange,
  onConfirm,
}: CancelInstallDialogProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  const gameName = server ? getGameName(server.gameId) : "";
  const gameLogo = server ? getGameLogo(server.gameId) : null;

  async function handleCancel() {
    if (!server) return;

    setIsCancelling(true);
    try {
      await onConfirm(server);
      onOpenChange(false);
    } finally {
      setIsCancelling(false);
    }
  }

  if (!server) return null;

  return (
    <Dialog open={open} onOpenChange={isCancelling ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg gap-0 p-0 overflow-hidden">
        <DialogTitle className="sr-only">
          Cancel Server Installation
        </DialogTitle>

        {/* Title bar */}
        <div className="px-6 pt-6">
          <h2 className="text-lg font-semibold">Cancel Installation?</h2>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-2 space-y-5">
          {/* Warning */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <FaTriangleExclamation className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Cancelling the installation will stop the download and{" "}
              <span className="text-foreground font-medium">
                permanently remove
              </span>{" "}
              this server and all downloaded data.
            </p>
          </div>

          {/* Server info */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              {gameLogo ? (
                <img
                  src={publicAsset(gameLogo)}
                  alt={gameName}
                  className="h-7 w-auto object-contain"
                />
              ) : (
                <FaServer className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                <span className="font-semibold text-foreground">
                  &quot;{server.name}&quot;
                </span>{" "}
                <span className="text-muted-foreground">({gameName})</span>
              </p>
              <p className="text-muted-foreground mt-1.5">
                The following will be removed:
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground list-disc list-inside">
                <li>All downloaded game files</li>
                <li>Server configuration</li>
                <li>Database entry</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 mt-2 border-t border-border gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCancelling}
            className="w-full sm:w-auto"
          >
            Keep Installing
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isCancelling}
            className="w-full sm:w-auto"
          >
            {isCancelling ? "Cancelling..." : "Cancel Installation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
