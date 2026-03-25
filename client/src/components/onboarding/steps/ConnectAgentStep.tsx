import { useState } from "react";
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
import { FaSpinner, FaCircleExclamation, FaPlug } from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

interface ConnectAgentStepProps {
  onNext: (agentUrl: string, sessionToken: string) => Promise<void>;
}

/**
 * Dashboard-mode step: connect to a remote Game-Servum Agent.
 * Reuses addConnection from BackendContext.
 */
export function ConnectAgentStep({ onNext }: ConnectAgentStepProps) {
  const { addConnection } = useBackend();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    try {
      let normalizedUrl = url.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `http://${normalizedUrl}`;
      }

      const conn = await addConnection(
        normalizedUrl,
        apiKey.trim(),
        password,
        name.trim() || "Agent",
      );
      await onNext(conn.url, conn.sessionToken!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
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
