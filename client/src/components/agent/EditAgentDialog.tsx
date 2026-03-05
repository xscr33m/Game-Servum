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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FaPen, FaServer, FaCircle } from "react-icons/fa6";
import type { BackendConnection } from "@/lib/config";

interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: BackendConnection | null;
  onSave: (id: string, details: { name: string }) => void;
}

const STATUS_COLORS = {
  connected: "text-green-500",
  authenticating: "text-yellow-500",
  reconnecting: "text-yellow-500",
  disconnected: "text-red-400",
  error: "text-red-500",
} as const;

const STATUS_LABELS = {
  connected: "Connected",
  authenticating: "Connecting...",
  reconnecting: "Reconnecting...",
  disconnected: "Disconnected",
  error: "Error",
} as const;

export function EditAgentDialog({
  open,
  onOpenChange,
  agent,
  onSave,
}: EditAgentDialogProps) {
  const [name, setName] = useState(agent?.name ?? "");

  if (!agent) return null;

  const s = (agent.status as keyof typeof STATUS_COLORS) || "disconnected";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(agent!.id, { name: trimmed });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o && agent) setName(agent.name);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaPen className="h-4 w-4 text-muted-foreground" />
            Edit Agent
          </DialogTitle>
          <DialogDescription>
            Update the display name and review connection details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Agent info summary */}
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <FaServer className="h-5 w-5 text-muted-foreground" />
                <FaCircle
                  className={`absolute -top-0.5 -right-0.5 h-2 w-2 ${STATUS_COLORS[s]}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{agent.name}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {new URL(agent.url).host}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={s === "connected" ? "success" : "secondary"}
                  className="text-xs"
                >
                  {STATUS_LABELS[s]}
                </Badge>
                {agent.agentInfo && (
                  <Badge variant="outline" className="text-xs border-border/50">
                    v{agent.agentInfo.version}
                  </Badge>
                )}
              </div>
            </div>

            {agent.agentInfo && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground pl-8">
                <span>Hostname</span>
                <span className="font-mono text-foreground/80 truncate">
                  {agent.agentInfo.hostname}
                </span>
                <span>Platform</span>
                <span className="font-mono text-foreground/80">
                  {agent.agentInfo.platform}
                </span>
              </div>
            )}
          </div>

          {/* Editable fields */}
          <div className="space-y-2">
            <Label htmlFor="edit-agent-name">Display Name</Label>
            <Input
              id="edit-agent-name"
              placeholder="e.g. Office PC, Dedicated Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
