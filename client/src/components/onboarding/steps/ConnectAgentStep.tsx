import { useState, useMemo } from "react";
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
  FaLockOpen,
  FaPlug,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

interface ConnectAgentStepProps {
  onNext: (agentUrl: string, sessionToken: string) => Promise<void>;
}

/**
 * Commander-mode step: connect to a remote Game-Servum Agent.
 * Reuses addConnection from BackendContext.
 */
export function ConnectAgentStep({ onNext }: ConnectAgentStepProps) {
  const { addConnection } = useBackend();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);

  // Warn only when user explicitly typed http:// to a non-localhost address.
  // No protocol = defaults to https:// on submit, so no warning needed.
  const showInsecureWarning = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed.startsWith("http://")) return false;
    try {
      const hostname = new URL(trimmed).hostname;
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1"
      )
        return false;
      return true;
    } catch {
      return false;
    }
  }, [url]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    if (!apiKey.trim()) {
      setError("API key is required");
      return;
    }
    if (!password.trim()) {
      setError("Password is required");
      return;
    }

    setLoading(true);

    let normalizedUrl = url.trim();
    if (
      !normalizedUrl.startsWith("http://") &&
      !normalizedUrl.startsWith("https://")
    ) {
      // Agent defaults to HTTPS (self-signed cert) — try HTTPS first
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      const conn = await addConnection(
        normalizedUrl,
        apiKey.trim(),
        password,
        name.trim() || "Agent",
      );
      await onNext(conn.url, conn.sessionToken!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";

      // Detect self-signed certificate rejection in browser
      if (
        (msg.includes("Failed to fetch") ||
          msg.includes("NetworkError") ||
          msg.includes("CERT")) &&
        normalizedUrl.startsWith("https://")
      ) {
        const healthUrl = `${normalizedUrl}/api/v1/health`;
        setError(
          <>
            Cannot connect — your browser does not trust the agent's
            certificate. Open{" "}
            <a
              href={healthUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium hover:opacity-80"
            >
              {healthUrl}
            </a>{" "}
            in a new tab, accept the certificate warning, then try connecting
            again.
          </>,
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FaPlug className="h-5 w-5" />
          Connect Agent
        </CardTitle>
        <CardDescription>
          Enter the connection details for your Game-Servum Agent. You can find
          them in the{" "}
          <span className="font-medium text-foreground">CREDENTIALS.txt</span>{" "}
          file in the agent's data directory.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <FaCircleExclamation className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="agent-name">Name (optional)</Label>
            <Input
              id="agent-name"
              placeholder="e.g. Office PC, Dedicated Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-url">URL</Label>
            <Input
              id="agent-url"
              placeholder="192.168.1.100:3001"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              required
            />
            {showInsecureWarning && (
              <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400">
                <FaLockOpen className="h-4 w-4" />
                <AlertDescription>
                  Using <strong>http://</strong> — credentials will be
                  transmitted in plain text. Remove the <strong>http://</strong>{" "}
                  prefix to connect via HTTPS (default), or use a VPN.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-apikey">API-Key</Label>
            <Input
              id="agent-apikey"
              placeholder="Agent API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={loading}
              required
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-password">Password</Label>
            <Input
              id="agent-password"
              type="password"
              placeholder="Connection password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <>
                <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <FaPlug className="mr-2 h-4 w-4" />
                Connect
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
