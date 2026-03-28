import { FaCircle, FaPlus, FaServer } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks/useBackend";

const STATUS_COLORS = {
  connected: "text-green-500",
  authenticating: "text-yellow-500",
  reconnecting: "text-yellow-500",
  updating: "text-blue-500",
  restarting: "text-blue-500",
  disconnected: "text-red-400",
  error: "text-red-500",
} as const;

const STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  authenticating: "Authenticating…",
  reconnecting: "Reconnecting…",
  updating: "Updating…",
  restarting: "Restarting…",
  disconnected: "Disconnected",
  error: "Error",
};

interface MobileAgentSectionProps {
  onAddAgent?: () => void;
}

/**
 * Inline agent selector for mobile Sheet menus.
 * Renders agents as a flat list without nested dropdowns/popovers.
 */
export function MobileAgentSection({ onAddAgent }: MobileAgentSectionProps) {
  const { connections, activeConnection, setActiveConnection } = useBackend();

  if (connections.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          Agent
        </div>
        <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
          <FaServer className="h-5 w-5 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-xs text-muted-foreground mb-3">
            No agents connected
          </p>
          {onAddAgent && (
            <Button size="sm" variant="outline" onClick={onAddAgent}>
              <FaPlus className="h-3 w-3 mr-1.5" />
              Connect Agent
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
        Agent
      </div>
      <div className="space-y-1">
        {connections.map((conn) => {
          const isActive = conn.id === activeConnection?.id;
          const status =
            (conn.status as keyof typeof STATUS_COLORS) || "disconnected";
          const statusColor =
            STATUS_COLORS[status] || STATUS_COLORS.disconnected;
          const statusLabel = STATUS_LABELS[status] || "Unknown";

          return (
            <button
              key={conn.id}
              onClick={() => setActiveConnection(conn.id)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors text-left ${
                isActive
                  ? "bg-accent border border-ring/30"
                  : "hover:bg-muted/50"
              }`}
            >
              <div className="relative shrink-0">
                <FaServer className="h-4 w-4 text-muted-foreground" />
                <FaCircle
                  className={`absolute -top-0.5 -right-0.5 h-2 w-2 ${statusColor}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{conn.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {statusLabel}
                  {conn.agentInfo?.version && ` · v${conn.agentInfo.version}`}
                </div>
              </div>
              {isActive && (
                <span className="text-[10px] font-medium text-ring bg-ring/10 px-1.5 py-0.5 rounded">
                  Active
                </span>
              )}
            </button>
          );
        })}
      </div>
      {onAddAgent && (
        <button
          onClick={onAddAgent}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <FaPlus className="h-3.5 w-3.5" />
          <span className="text-sm">Add Agent</span>
        </button>
      )}
    </div>
  );
}
