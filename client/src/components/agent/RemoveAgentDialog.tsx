import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FaTriangleExclamation, FaSpinner } from "react-icons/fa6";
import type { BackendConnection } from "@/lib/config";

interface RemoveAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: BackendConnection | null;
  onConfirm: (id: string) => void;
}

export function RemoveAgentDialog({
  open,
  onOpenChange,
  agent,
  onConfirm,
}: RemoveAgentDialogProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!agent) return null;

  async function handleRemove() {
    setIsRemoving(true);
    setError(null);
    try {
      onConfirm(agent!.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove agent");
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaTriangleExclamation className="h-5 w-5 text-destructive" />
            Remove Agent
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to remove{" "}
            <span className="font-semibold text-foreground">{agent.name}</span>{" "}
            from your Commander?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground space-y-1.5">
          <p>This will only disconnect the agent from this Commander.</p>
          <p>
            The agent will <strong className="text-foreground">not</strong> be
            uninstalled or stopped on the remote system. Game servers managed by
            this agent will continue to run.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRemoving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleRemove}
            disabled={isRemoving}
            className="w-full sm:w-auto"
          >
            {isRemoving ? (
              <>
                <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
                Removing...
              </>
            ) : (
              "Remove Agent"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
