import { useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
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
  const [isDeleting, setIsDeleting] = useState(false);

  const isNameMatch = server && confirmName === server.name;

  async function handleDelete() {
    if (!server || !isNameMatch) return;

    setIsDeleting(true);
    try {
      await onConfirm(server);
      setConfirmName("");
      onOpenChange(false);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setConfirmName("");
    }
    onOpenChange(newOpen);
  }

  if (!server) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <FaTriangleExclamation className="h-5 w-5" />
            Delete Server
          </DialogTitle>
          <DialogDescription>
            This action is permanent and irreversible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning list */}
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm font-medium text-destructive mb-2">
              All server files will be deleted:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Configuration files</li>
              <li>World data and saves</li>
              <li>Logs and profiles</li>
              <li>All installed game files</li>
            </ul>
          </div>

          {/* Server info */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">
              Server to delete:
            </div>
            <div className="font-semibold">{server.name}</div>
            <div className="text-xs text-muted-foreground mt-1 break-all">
              {server.installPath}
            </div>
          </div>

          {/* Confirmation input */}
          <div className="space-y-2">
            <Label htmlFor="confirm-name" className="text-sm">
              Type{" "}
              <code className="px-1.5 py-0.5 bg-muted rounded font-mono text-sm">
                {server.name}
              </code>{" "}
              to confirm:
            </Label>
            <Input
              id="confirm-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Enter server name"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-2 mt-2">
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
            disabled={!isNameMatch || isDeleting}
            className="w-full sm:w-auto"
          >
            {isDeleting ? "Deleting..." : "Delete Permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
