import { useState, useEffect, useRef } from "react";
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
  FaSpinner,
  FaCircleExclamation,
  FaDownload,
  FaTerminal,
  FaCheck,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

interface SteamCmdInstallStepProps {
  alreadyInstalled: boolean;
  onNext: () => void;
}

/**
 * Downloads and installs SteamCMD. Auto-skips if already installed.
 */
export function SteamCmdInstallStep({
  alreadyInstalled,
  onNext,
}: SteamCmdInstallStepProps) {
  const { api, subscribe } = useBackend();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(alreadyInstalled);

  // Auto-advance if already installed
  useEffect(() => {
    if (alreadyInstalled) {
      onNext();
    }
  }, [alreadyInstalled, onNext]);

  // Subscribe to SteamCMD output
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "steamcmd:output" && message.payload) {
        const payload = message.payload as { message: string };
        if (payload.message) {
          setTerminalOutput((prev) => [...prev.slice(-100), payload.message]);
        }
      }
    });
    return unsubscribe;
  }, [subscribe]);

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
        setTimeout(onNext, 800);
      } else {
        setError(data.message || "Failed to install SteamCMD");
      }
    } catch {
      setError("Network error: Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  if (alreadyInstalled) {
    return null; // Will auto-advance
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {done ? (
              <FaCheck className="h-5 w-5 text-green-500" />
            ) : (
              <FaDownload className="h-5 w-5" />
            )}
            Install SteamCMD
          </CardTitle>
          <CardDescription>
            SteamCMD is required to download and manage game servers. The
            download is approximately 3 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {/* Terminal Output */}
      {terminalOutput.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FaTerminal className="h-4 w-4" />
              SteamCMD Output
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div
              ref={terminalRef}
              className="bg-terminal text-green-400 font-mono text-xs p-3 rounded h-48 overflow-y-auto whitespace-pre-wrap"
            >
              {terminalOutput.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
