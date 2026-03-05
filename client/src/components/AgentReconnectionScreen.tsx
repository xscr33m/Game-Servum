import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FaCircleExclamation,
  FaArrowsRotate,
  FaTrash,
  FaRightLeft,
  FaCircleCheck,
  FaTriangleExclamation,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";
import { useNavigate } from "react-router-dom";
import { publicAsset } from "@/lib/assets";
import type { BackendConnection } from "@/lib/config";

const MAX_RECONNECT_ATTEMPTS = 3;

export function AgentReconnectionScreen() {
  const navigate = useNavigate();
  const {
    activeConnection,
    connections,
    resetReconnectAttempts,
    removeConnection,
    setActiveConnection,
  } = useBackend();

  const [removing, setRemoving] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (!activeConnection) {
    // No active connection — redirect to onboarding
    navigate("/?onboarding=connect");
    return null;
  }

  const reconnectAttempts = activeConnection.reconnectAttempts || 0;
  const lastError = activeConnection.lastError || "Connection timeout";

  // Find other available agents that could be connected
  const otherAgents = connections.filter(
    (c) =>
      c.id !== activeConnection.id &&
      c.status === "connected" &&
      c.sessionToken,
  );

  // Show "Try Again" button when status is error OR when max attempts reached
  const hasReachedLimit =
    activeConnection.status === "error" ||
    reconnectAttempts >= MAX_RECONNECT_ATTEMPTS;

  async function handleTryAgain() {
    if (!activeConnection) return;
    resetReconnectAttempts(activeConnection.id);
    // The auto-reconnect logic in BackendContext will pick it up
  }

  async function handleRemove() {
    if (!activeConnection) return;

    if (
      !confirm(
        `Remove agent "${activeConnection.name}"?\n\nThis will only remove the connection from this dashboard. Server configurations on the agent will not be deleted.`,
      )
    ) {
      return;
    }

    setRemoving(true);
    removeConnection(activeConnection.id);

    // If there are other agents, switch to the first available one
    if (otherAgents.length > 0) {
      setActiveConnection(otherAgents[0].id);
    } else {
      // No other agents — redirect to onboarding
      navigate("/?onboarding=connect");
    }
  }

  async function handleSwitchAgent(conn: BackendConnection) {
    setSwitching(true);
    setActiveConnection(conn.id);
    navigate("/");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl space-y-6 animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Logo & Branding */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <img
            src={publicAsset("/dashboard-icon.png")}
            alt="Game Servum"
            className="h-10 w-auto"
          />
          <span className="text-xl font-bold">
            Game-<span className="text-ring">Servum</span>
          </span>
        </div>

        {/* Main Reconnection Card */}
        <Card className="border-2">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
              <FaArrowsRotate
                className={`h-8 w-8 text-destructive ${!hasReachedLimit ? "animate-spin" : ""}`}
              />
            </div>
            <CardTitle className="text-2xl">
              {hasReachedLimit ? "Connection Failed" : "Reconnecting to Agent"}
            </CardTitle>
            <CardDescription className="text-base mt-2">
              {hasReachedLimit
                ? "Unable to establish connection after multiple attempts"
                : "Attempting to restore connection to your Game-Servum agent"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Agent Info Grid */}
            <div className="grid grid-cols-1 gap-3 p-4 rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Agent
                </span>
                <span className="font-semibold">{activeConnection.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  URL
                </span>
                <span className="font-mono text-sm">
                  {activeConnection.url}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Retry Attempts
                </span>
                <span className="font-semibold tabular-nums">
                  {reconnectAttempts} / {MAX_RECONNECT_ATTEMPTS}
                </span>
              </div>
            </div>

            {/* Error Message */}
            {hasReachedLimit && (
              <Alert variant="destructive" className="border-2">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription className="font-medium">
                  {lastError}
                </AlertDescription>
              </Alert>
            )}

            {/* Status Info */}
            {!hasReachedLimit && (
              <Alert className="bg-blue-500/10 border-blue-500/50 text-blue-600 dark:text-blue-400">
                <FaTriangleExclamation className="h-4 w-4" />
                <AlertDescription>
                  Attempting to reconnect... Please ensure the agent is running
                  and reachable.
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="space-y-3 pt-2">
              {hasReachedLimit && (
                <Button onClick={handleTryAgain} className="w-full" size="lg">
                  <FaArrowsRotate className="mr-2 h-5 w-5" />
                  Try Again
                </Button>
              )}

              <div className="flex items-center justify-center gap-4">
                <Button
                  onClick={handleRemove}
                  variant="destructive"
                  disabled={removing}
                >
                  <FaTrash className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Other Available Agents */}
        {otherAgents.length > 0 && (
          <Card className="border">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                  <FaCircleCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Other Available Agents
                  </CardTitle>
                  <CardDescription className="text-sm mt-0.5">
                    Switch to a connected agent to continue
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {otherAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-all group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {agent.url}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSwitchAgent(agent)}
                    variant="default"
                    size="sm"
                    className="ml-3 shrink-0"
                    disabled={switching}
                  >
                    <FaRightLeft className="mr-1.5 h-3 w-3" />
                    Switch
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Help Text */}
        <div className="text-center text-sm text-muted-foreground space-y-1 px-4">
          <p>
            Make sure the agent is running and accessible from this computer.
          </p>
          <p>
            Check firewall settings and network connectivity if the problem
            persists.
          </p>
        </div>
      </div>
    </div>
  );
}
