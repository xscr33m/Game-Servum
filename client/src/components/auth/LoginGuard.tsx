import { useState, useEffect, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FaSpinner, FaLock, FaShieldHalved } from "react-icons/fa6";
import { publicAsset } from "@/lib/assets";

type AuthState = "loading" | "setup" | "login" | "authenticated";

interface LoginGuardProps {
  children: ReactNode;
}

/**
 * Auth gate for Docker-hosted Commander (web mode).
 * Checks /commander/api/auth/status on mount:
 *  - Not configured → show "Set Admin Password" form
 *  - Not authenticated → show login form
 *  - Authenticated → render children
 */
export function LoginGuard({ children }: LoginGuardProps) {
  const [state, setState] = useState<AuthState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function checkStatus() {
    try {
      const res = await fetch("/commander/api/auth/status", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setState("login");
        return;
      }
      const data = await res.json();
      if (!data.configured) {
        setState("setup");
      } else if (!data.authenticated) {
        setState("login");
      } else {
        setState("authenticated");
      }
    } catch {
      setState("login");
    }
  }

  useEffect(() => {
    checkStatus();

    // Listen for session-expired events from WebCredentialStore
    function onExpired() {
      setState("login");
    }
    window.addEventListener("commander:session-expired", onExpired);
    return () =>
      window.removeEventListener("commander:session-expired", onExpired);
  }, []);

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/commander/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        setPassword("");
        setConfirmPassword("");
        setState("authenticated");
      } else {
        setError(data.message || "Setup failed");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("Password required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/commander/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        setPassword("");
        setState("authenticated");
      } else {
        setError(data.message || "Login failed");
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setSubmitting(false);
    }
  }

  // Loading state
  if (state === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <FaSpinner className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Authenticated — render the app
  if (state === "authenticated") {
    return <>{children}</>;
  }

  // Setup or Login form
  const isSetup = state === "setup";

  return (
    <div className="h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center">
            <img
              src={publicAsset("commander-icon.png")}
              alt="Game-Servum"
              className="h-12 w-auto"
            />
          </div>
          <CardTitle className="flex items-center justify-center gap-2">
            {isSetup ? (
              <>
                <FaShieldHalved className="h-4 w-4" />
                Set Up Admin Password
              </>
            ) : (
              <>
                <FaLock className="h-4 w-4" />
                Commander Login
              </>
            )}
          </CardTitle>
          <CardDescription>
            {isSetup
              ? "Set a password to protect your Commander instance."
              : "Enter your admin password to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={isSetup ? handleSetup : handleLogin}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={isSetup ? "Min. 8 characters" : "Password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete={isSetup ? "new-password" : "current-password"}
                />
              </div>

              {isSetup && (
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && (
                  <FaSpinner className="h-3.5 w-3.5 mr-2 animate-spin" />
                )}
                {isSetup ? "Set Password" : "Login"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
