import { useState, useEffect, useRef, useCallback } from "react";
import {
  FaSpinner,
  FaCircleExclamation,
  FaRightToBracket,
  FaRightFromBracket,
  FaShieldHalved,
  FaUser,
  FaUserSlash,
  FaSteam,
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess } from "@/lib/toast";
import type { SteamCMDStatus } from "@/types";

type DialogView = "account" | "login" | "guard";

interface SteamAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steamcmd: SteamCMDStatus | null;
  onStatusChange: () => void;
}

/**
 * Steam account management dialog.
 * Shows account overview when logged in, or a login flow
 * (username → password → Steam Guard) when not.
 */
export function SteamAccountDialog({
  open,
  onOpenChange,
  steamcmd,
  onStatusChange,
}: SteamAccountDialogProps) {
  const { api, subscribe } = useBackend();

  const [view, setView] = useState<DialogView>("account");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [guardCode, setGuardCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setView(steamcmd?.loggedIn ? "account" : "account");
      setError(null);
      setLoading(false);
      setPassword("");
      setGuardCode("");
      setNeedsPassword(false);
      setTerminalOutput([]);
      if (steamcmd?.username) {
        setUsername(steamcmd.username);
      }
    }
  }, [open, steamcmd]);

  // Subscribe to WebSocket messages for login flow
  useEffect(() => {
    if (!open) return;

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
        setView("guard");
      }
      if (message.type === "steamcmd:login-success") {
        setLoading(false);
        setError(null);
        onStatusChange();
        onOpenChange(false);
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
  }, [open, subscribe, onStatusChange, onOpenChange]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  const handleLogin = useCallback(async () => {
    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (needsPassword && !password.trim()) {
      setError("Password is required");
      return;
    }

    setLoading(true);
    setError(null);
    setTerminalOutput([]);

    try {
      const data = await api.steamcmd.login({
        username,
        ...(needsPassword && password ? { password } : {}),
      });

      if (data.success) {
        toastSuccess("Logged in to Steam");
        onStatusChange();
        onOpenChange(false);
      } else if (data.requiresGuard) {
        setView("guard");
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
  }, [
    api.steamcmd,
    username,
    password,
    needsPassword,
    onStatusChange,
    onOpenChange,
  ]);

  async function handleGuardSubmit() {
    if (!guardCode.trim()) {
      setError("Steam Guard code is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api.steamcmd.submitGuardCode({ code: guardCode });
      if (data.success) {
        toastSuccess("Logged in to Steam");
        onStatusChange();
        onOpenChange(false);
      } else {
        setError(data.message || "Invalid Steam Guard code");
      }
    } catch {
      setError("Network error: Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    setError(null);
    try {
      await api.steamcmd.logout();
      toastSuccess("Logged out from Steam");
      onStatusChange();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* ── Account overview ── */}
        {view === "account" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FaSteam className="h-5 w-5" />
                Steam Account
              </DialogTitle>
              <DialogDescription>
                {steamcmd?.loggedIn
                  ? "You are logged in to Steam. Some games require an account to download."
                  : "Log in to your Steam account to download Workshop mods and non-free game servers."}
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {steamcmd?.loggedIn ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                  <div className="h-10 w-10 rounded-full bg-ring/20 flex items-center justify-center">
                    <FaUser className="h-5 w-5 text-ring" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{steamcmd.username}</p>
                    <p className="text-xs text-muted-foreground">
                      Logged in via SteamCMD
                    </p>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={handleLogout}
                    disabled={loading}
                  >
                    {loading ? (
                      <FaSpinner className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FaRightFromBracket className="h-4 w-4 mr-2" />
                    )}
                    Logout
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Logging out switches to anonymous mode. You can always log in
                  again.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <FaUserSlash className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-muted-foreground">
                      Anonymous
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Some downloads may be restricted
                    </p>
                  </div>
                </div>

                <Button className="w-full" onClick={() => setView("login")}>
                  <FaRightToBracket className="h-4 w-4 mr-2" />
                  Log in to Steam
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Login form ── */}
        {view === "login" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FaRightToBracket className="h-5 w-5" />
                Steam Login
              </DialogTitle>
              <DialogDescription>
                Enter your Steam credentials. If cached credentials exist,
                you'll be logged in automatically.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="steam-username">Steam Username</Label>
                <Input
                  id="steam-username"
                  placeholder="Enter your Steam username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  onKeyDown={(e) =>
                    !needsPassword && e.key === "Enter" && handleLogin()
                  }
                  autoFocus
                />
              </div>

              {needsPassword && (
                <div className="space-y-2">
                  <Label htmlFor="steam-password">Password</Label>
                  <Input
                    id="steam-password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                  onClick={() => {
                    setView("account");
                    setError(null);
                    setNeedsPassword(false);
                    setPassword("");
                    setTerminalOutput([]);
                  }}
                  disabled={loading}
                >
                  Back
                </Button>
                <Button
                  onClick={handleLogin}
                  disabled={loading}
                  className="flex-1"
                >
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
            </div>

            {/* Terminal Output */}
            {terminalOutput.length > 0 && (
              <div
                ref={terminalRef}
                className="bg-terminal text-green-400 font-mono text-xs p-3 rounded h-36 overflow-y-auto whitespace-pre-wrap"
              >
                {terminalOutput.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Steam Guard ── */}
        {view === "guard" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FaShieldHalved className="h-5 w-5" />
                Steam Guard
              </DialogTitle>
              <DialogDescription>
                Enter the code from your authenticator app or email.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <FaCircleExclamation className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="guard-code">Steam Guard Code</Label>
                <Input
                  id="guard-code"
                  placeholder="e.g. X1Y2Z"
                  value={guardCode}
                  onChange={(e) => setGuardCode(e.target.value.toUpperCase())}
                  disabled={loading}
                  maxLength={5}
                  className="text-center text-2xl tracking-widest"
                  onKeyDown={(e) => e.key === "Enter" && handleGuardSubmit()}
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setView("login");
                    setError(null);
                    setGuardCode("");
                  }}
                  disabled={loading}
                >
                  Back
                </Button>
                <Button
                  onClick={handleGuardSubmit}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? (
                    <>
                      <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      <FaShieldHalved className="mr-2 h-4 w-4" />
                      Verify Code
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
