import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FaTriangleExclamation } from "react-icons/fa6";
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
  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaTriangleExclamation className="h-5 w-5 text-destructive" />
            Remove Agent
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to remove{" "}
            <span className="font-semibold text-foreground">{agent.name}</span>{" "}
            from your dashboard?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground space-y-1.5">
          <p>This will only disconnect the agent from this dashboard.</p>
          <p>
            The agent will <strong className="text-foreground">not</strong> be
            uninstalled or stopped on the remote system. Game servers managed by
            this agent will continue to run.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(agent.id);
              onOpenChange(false);
            }}
          >
            Remove Agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
