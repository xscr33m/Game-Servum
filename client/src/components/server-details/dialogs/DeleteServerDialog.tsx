import { useState } from "react";
import {
  FaTriangleExclamation,
  FaServer,
  FaCopy,
  FaCheck,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getGameName,
  getGameLogo,
} from "@/components/server-details/games/registry";
import { publicAsset } from "@/lib/assets";
import type { GameServer } from "@/types";

interface DeleteServerDialogProps {
  server: GameServer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (server: GameServer) => Promise<void>;
}

export function DeleteServerDialog({
  server,
  open,
  onOpenChange,
  onConfirm,
}: DeleteServerDialogProps) {
  const [confirmName, setConfirmName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const isNameMatch = server ? confirmName === server.name : false;
  const isRunning = server?.status === "running";
  const canDelete = acknowledged && isNameMatch && !isRunning;

  const gameName = server ? getGameName(server.gameId) : "";
  const gameLogo = server ? getGameLogo(server.gameId) : null;

  async function handleDelete() {
    if (!server || !canDelete) return;

    setIsDeleting(true);
    try {
      await onConfirm(server);
      resetState();
      onOpenChange(false);
    } finally {
      setIsDeleting(false);
    }
  }

  function resetState() {
    setConfirmName("");
    setAcknowledged(false);
    setCopied(false);
  }

  function handleCopyName() {
    if (!server) return;
    navigator.clipboard.writeText(server.name).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  }

  if (!server) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm Server Deletion</DialogTitle>
          <DialogDescription>
            This will permanently delete the server and all associated data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Running server warning */}
          {isRunning && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <FaTriangleExclamation className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-400">
                  Server is running
                </p>
                <p className="text-sm text-muted-foreground">
                  Stop the server before it can be deleted.
                </p>
              </div>
            </div>
          )}

          {/* What will happen */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              The following actions will be performed:
            </p>
            <div className="flex items-start gap-3">
              {/* Game logo */}
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
                <p className="text-destructive font-medium">
                  Delete{" "}
                  <span className="font-semibold text-foreground">
                    &quot;{server.name}&quot;
                  </span>{" "}
                  ({gameName}) and all associated data permanently.
                </p>
                <p className="text-muted-foreground mt-1.5">This includes:</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground list-disc list-inside">
                  <li>Server installation &amp; game files</li>
                  <li>Configuration files</li>
                  <li>World data and saves</li>
                  <li>Logs, profiles &amp; installed mods</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Confirmation section */}
          <div className="space-y-4">
            {/* Checkbox */}
            <div className="flex items-start gap-3">
              <Checkbox
                id="acknowledge-delete"
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
                disabled={isRunning || isDeleting}
                className="mt-0.5"
              />
              <Label
                htmlFor="acknowledge-delete"
                className="text-sm leading-snug cursor-pointer select-none"
              >
                I understand that this action is permanent and cannot be undone
              </Label>
            </div>

            {/* Name confirmation */}
            <div
              className={`space-y-3 transition-opacity duration-200 ${
                acknowledged && !isRunning
                  ? "opacity-100"
                  : "opacity-40 pointer-events-none"
              }`}
            >
              <div>
                <p className="text-sm font-medium mb-1.5">Confirm Deletion</p>
                <p className="text-sm text-muted-foreground">
                  Please confirm by entering the server name below
                </p>
              </div>

              {/* Reference name display (click to copy) */}
              <button
                type="button"
                onClick={handleCopyName}
                className="w-full flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2 hover:bg-muted/80 transition-colors cursor-pointer text-left"
              >
                <span className="text-sm font-mono text-muted-foreground">
                  {server.name}
                </span>
                {copied ? (
                  <FaCheck className="h-3.5 w-3.5 shrink-0 text-green-400" />
                ) : (
                  <FaCopy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {/* Input */}
              <div className="space-y-1.5">
                <Label htmlFor="confirm-name" className="text-sm">
                  Server Name
                </Label>
                <Input
                  id="confirm-name"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder="Enter server name"
                  autoComplete="off"
                  disabled={!acknowledged || isRunning || isDeleting}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!canDelete || isDeleting}
            className="w-full sm:w-auto"
          >
            {isDeleting ? "Deleting..." : "Permanently Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
