import { useState, useEffect, useRef } from "react";
import {
  FaSpinner,
  FaCircleExclamation,
  FaDownload,
  FaTerminal,
  FaCheck,
} from "react-icons/fa6";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks/useBackend";

interface SteamCmdInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}

/**
 * Standalone dialog for installing SteamCMD from the Dashboard.
 * Shown when a user connected an agent but closed the onboarding wizard
 * before SteamCMD was installed.
 */
export function SteamCmdInstallDialog({
  open,
  onOpenChange,
  onInstalled,
}: SteamCmdInstallDialogProps) {
  const { api, subscribe } = useBackend();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setLoading(false);
      setError(null);
      setDone(false);
      setTerminalOutput([]);
    }
  }, [open]);

  // Subscribe to SteamCMD output
  useEffect(() => {
    if (!open) return;

    const unsubscribe = subscribe((message) => {
      if (message.type === "steamcmd:output" && message.payload) {
        const payload = message.payload as { message: string };
        if (payload.message) {
          setTerminalOutput((prev) => [...prev.slice(-100), payload.message]);
        }
      }
    });
    return unsubscribe;
  }, [open, subscribe]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  async function handleInstall() {
    setLoading(true);
    setError(null);
    setTerminalOutput([]);

    try {
      const data = await api.steamcmd.install();
      if (data.success) {
        setDone(true);
        setTimeout(() => {
          onInstalled();
          onOpenChange(false);
        }, 800);
      } else {
        setError(data.message || "Failed to install SteamCMD");
      }
    } catch {
      setError("Network error: Could not connect to agent");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {done ? (
              <FaCheck className="h-5 w-5 text-green-500" />
            ) : (
              <FaDownload className="h-5 w-5" />
            )}
            Install SteamCMD
          </DialogTitle>
          <DialogDescription>
            SteamCMD is required to download and manage game servers. The
            download is approximately 3 MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <FaCircleExclamation className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleInstall}
            disabled={loading || done}
            className="w-full"
          >
            {loading ? (
              <>
                <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                Installing...
              </>
            ) : done ? (
              <>
                <FaCheck className="mr-2 h-4 w-4" />
                Installed
              </>
            ) : (
              <>
                <FaDownload className="mr-2 h-4 w-4" />
                Download SteamCMD
              </>
            )}
          </Button>

          {/* Terminal Output */}
          {terminalOutput.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <FaTerminal className="h-3.5 w-3.5" />
                Output
              </div>
              <div
                ref={terminalRef}
                className="bg-terminal text-green-400 font-mono text-xs p-3 rounded h-48 overflow-y-auto whitespace-pre-wrap"
              >
                {terminalOutput.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
