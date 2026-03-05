import { useState, useEffect } from "react";
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
  FaShieldHalved,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";

interface SteamGuardStepProps {
  onNext: () => void;
  onBack: () => void;
}

/**
 * Steam Guard code entry step.
 */
export function SteamGuardStep({ onNext, onBack }: SteamGuardStepProps) {
  const { api, subscribe } = useBackend();
  const [guardCode, setGuardCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for login success via WebSocket
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === "steamcmd:login-success") {
        setLoading(false);
        setError(null);
        onNext();
      }
      if (message.type === "steamcmd:login-failed") {
        setLoading(false);
        const payload = message.payload as { message?: string };
        setError(payload?.message || "Invalid code");
      }
    });
    return unsubscribe;
  }, [subscribe, onNext]);

  async function handleSubmit() {
    if (!guardCode.trim()) {
      setError("Steam Guard code is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api.steamcmd.submitGuardCode({ code: guardCode });
      if (data.success) {
        onNext();
      } else {
        setError(data.message || "Invalid Steam Guard code");
      }
    } catch {
      setError("Network error: Could not connect to server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FaShieldHalved className="h-5 w-5" />
          Steam Guard
        </CardTitle>
        <CardDescription>
          Enter the Steam Guard code from your authenticator app or email.
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
          <Label htmlFor="guard-code">Steam Guard Code</Label>
          <Input
            id="guard-code"
            placeholder="e.g. X1Y2Z"
            value={guardCode}
            onChange={(e) => setGuardCode(e.target.value.toUpperCase())}
            disabled={loading}
            maxLength={5}
            className="text-center text-2xl tracking-widest"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="flex-1">
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
      </CardContent>
    </Card>
  );
}
