import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FaArrowsRotate,
  FaTerminal,
  FaTriangleExclamation,
  FaCheck,
  FaRightToBracket,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

interface UpdateCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: number;
}

type CheckState = "idle" | "checking" | "complete" | "error";

export function UpdateCheckDialog({
  open,
  onOpenChange,
  serverId,
}: UpdateCheckDialogProps) {
  const [state, setState] = useState<CheckState>("idle");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [hasUpdates, setHasUpdates] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(false);
  const navigate = useNavigate();
  const { api, subscribe } = useBackend();

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  // Subscribe to WebSocket messages for update check output
  useEffect(() => {
    if (!open) return;

    const unsubscribe = subscribe((message) => {
      if (message.type === "steamcmd:output") {
        const payload = message.payload as {
          message: string;
          serverId?: number;
          context?: string;
        };
        // Only capture output from our update-check context and server
        if (
          payload.context === "update-check" &&
          (payload.serverId === serverId || payload.serverId === undefined)
        ) {
          setTerminalOutput((prev) => [...prev.slice(-200), payload.message]);

          // Detect "cached credentials not found" in real-time
          if (
            payload.message
              .toLowerCase()
              .includes("cached credentials not found")
          ) {
            setLoginRequired(true);
          }
        }
      }

      if (message.type === "update-check:complete") {
        const payload = message.payload as {
          serverId: number;
          success: boolean;
          message: string;
          loginRequired?: boolean;
          gameUpdateAvailable?: boolean;
          updatedMods?: Array<{ name: string }>;
        };
        if (payload.serverId === serverId) {
          setState("complete");
          setResultMessage(payload.message);
          if (payload.loginRequired) {
            setLoginRequired(true);
          }
          if (
            payload.gameUpdateAvailable ||
            (payload.updatedMods && payload.updatedMods.length > 0)
          ) {
            setHasUpdates(true);
          }
        }
      }
    });

    return unsubscribe;
  }, [open, subscribe, serverId]);

  const startCheck = useCallback(async () => {
    setState("checking");
    setTerminalOutput([]);
    setResultMessage(null);
    setLoginRequired(false);
    setHasUpdates(false);
    try {
      await api.servers.checkUpdates(serverId);
      // The result will come via WebSocket "update-check:complete"
      // If WS didn't fire (e.g. for mod-only checks without game check), handle it:
      setState((prev) => (prev === "checking" ? "complete" : prev));
    } catch (err) {
      setState("error");
      setResultMessage((err as Error).message);
    }
  }, [serverId, api.servers]);

  // Track open/close transitions via ref
  useEffect(() => {
    prevOpenRef.current = open;
  });

  // Start check on mount / when dialog becomes visible
  // This is safe because the component is conditionally rendered
  const hasStartedRef = useRef(false);
  useEffect(() => {
    if (open && !hasStartedRef.current) {
      hasStartedRef.current = true;
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => startCheck(), 0);
    }
    if (!open) {
      hasStartedRef.current = false;
    }
  }, [open, startCheck]);

  const handleGoToLogin = () => {
    onOpenChange(false);
    navigate("/?setup=login");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaArrowsRotate
              className={`h-4 w-4 ${state === "checking" ? "animate-spin" : ""}`}
            />
            Update Check
          </DialogTitle>
          <DialogDescription>
            Checking for mod and game server updates via Steam Workshop API and
            SteamCMD
          </DialogDescription>
        </DialogHeader>

        {/* Terminal output */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FaTerminal className="h-3 w-3" />
            <span>SteamCMD Output</span>
            {state === "checking" && (
              <Badge variant="outline" className="ml-auto text-xs">
                Running...
              </Badge>
            )}
            {state === "complete" && !loginRequired && (
              <Badge variant="success" className="ml-auto text-xs">
                Complete
              </Badge>
            )}
            {state === "error" && (
              <Badge variant="destructive" className="ml-auto text-xs">
                Error
              </Badge>
            )}
          </div>

          <div
            ref={terminalRef}
            className="bg-terminal rounded-md p-3 h-[250px] overflow-y-auto font-mono text-xs text-green-400"
          >
            {terminalOutput.length === 0 ? (
              <span className="text-muted-foreground">
                {state === "checking"
                  ? "Waiting for output..."
                  : "No output yet"}
              </span>
            ) : (
              terminalOutput.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>

          {/* Login required warning */}
          {loginRequired && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
              <FaTriangleExclamation className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm text-yellow-500 font-medium">
                  Steam Login Required
                </p>
                <p className="text-xs text-muted-foreground">
                  This game server requires a logged-in Steam account to check
                  for updates. Please log in via the SteamCMD Setup on the home
                  page and try again.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGoToLogin}
                  className="mt-1"
                >
                  <FaRightToBracket className="h-3 w-3 mr-1.5" />
                  Go to Home
                </Button>
              </div>
            </div>
          )}

          {/* Result message */}
          {resultMessage && !loginRequired && (
            <div
              className={`flex items-center gap-2 text-sm ${
                hasUpdates
                  ? "text-yellow-500"
                  : state === "error"
                    ? "text-red-500"
                    : "text-green-500"
              }`}
            >
              {state === "error" ? (
                <FaTriangleExclamation className="h-3.5 w-3.5" />
              ) : (
                <FaCheck className="h-3.5 w-3.5" />
              )}
              {resultMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
