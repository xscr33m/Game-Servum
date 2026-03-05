import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  FaRightToBracket,
  FaTerminal,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

interface SteamLoginStepProps {
  alreadyLoggedIn: boolean;
  username: string | null;
  onNext: () => void;
  onGuardRequired: () => void;
  onSkip: () => void;
}

/**
 * Steam login step. Auto-advances if already logged in.
 */
export function SteamLoginStep({
  alreadyLoggedIn,
  username,
  onNext,
  onGuardRequired,
  onSkip,
}: SteamLoginStepProps) {
  const { api, subscribe } = useBackend();
  const [steamUsername, setSteamUsername] = useState(username || "");
  const [steamPassword, setSteamPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-advance if already logged in
  useEffect(() => {
    if (alreadyLoggedIn) {
      onNext();
    }
  }, [alreadyLoggedIn, onNext]);

  // Subscribe to WebSocket messages
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "steamcmd:output" && message.payload) {
        const payload = message.payload as { message: string };
        if (payload.message) {
          setTerminalOutput((prev) => [...prev.slice(-100), payload.message]);
        }
      }
      if (message.type === "steamcmd:guard-required") {
        setLoading(false);
        setError(null);
        onGuardRequired();
      }
      if (message.type === "steamcmd:login-success") {
        setLoading(false);
        setError(null);
        onNext();
      }
      if (message.type === "steamcmd:password-required") {
        setLoading(false);
        setNeedsPassword(true);
        setError(null);
      }
      if (message.type === "steamcmd:login-failed") {
        setLoading(false);
        const payload = message.payload as { message?: string };
        setError(payload?.message || "Login failed");
      }
    });
    return unsubscribe;
  }, [subscribe, onNext, onGuardRequired]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  async function handleLogin() {
    if (!steamUsername.trim()) {
      setError("Username is required");
      return;
    }
    if (needsPassword && !steamPassword.trim()) {
      setError("Password is required");
      return;
    }

    setLoading(true);
    setError(null);
    setTerminalOutput([]);

    try {
      const data = await api.steamcmd.login({
        username: steamUsername,
        ...(needsPassword && steamPassword ? { password: steamPassword } : {}),
      });

      if (data.success) {
        onNext();
      } else if (data.requiresGuard) {
        onGuardRequired();
      } else if (data.requiresPassword) {
        setNeedsPassword(true);
      } else {
        setError(data.message || "Login failed");
      }
    } catch {
      setError("Network error: Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  if (alreadyLoggedIn) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FaRightToBracket className="h-5 w-5" />
            Steam Login
          </CardTitle>
          <CardDescription>
            Log in to your Steam account to download Workshop mods and non-free
            game servers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <FaCircleExclamation className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="steam-username">Steam Username</Label>
            <Input
              id="steam-username"
              placeholder="Enter your Steam username"
              value={steamUsername}
              onChange={(e) => setSteamUsername(e.target.value)}
              disabled={loading}
              onKeyDown={(e) =>
                !needsPassword && e.key === "Enter" && handleLogin()
              }
            />
          </div>

          {needsPassword && (
            <div className="space-y-2">
              <Label htmlFor="steam-password">Password</Label>
              <Input
                id="steam-password"
                type="password"
                placeholder="Enter your password"
                value={steamPassword}
                onChange={(e) => setSteamPassword(e.target.value)}
                disabled={loading}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
              <p className="text-xs text-muted-foreground">
                No cached credentials found. Please enter your password.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onSkip}
              disabled={loading}
              className="flex-1"
            >
              Skip (Anonymous)
            </Button>
            <Button onClick={handleLogin} disabled={loading} className="flex-1">
              {loading ? (
                <>
                  <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                  {needsPassword ? "Logging in..." : "Checking..."}
                </>
              ) : (
                <>
                  <FaRightToBracket className="mr-2 h-4 w-4" />
                  Login
                </>
              )}
            </Button>
          </div>

          {!needsPassword && (
            <p className="text-xs text-muted-foreground">
              Enter your username to try cached credentials. If no cached
              session exists, you'll be asked for your password.
            </p>
          )}
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
