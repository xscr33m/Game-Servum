import { useState, useEffect, useCallback } from "react";
import {
  FaFloppyDisk,
  FaRotateLeft,
  FaFileCode,
  FaCircleExclamation,
} from "react-icons/fa6";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess } from "@/lib/toast";
import { DayZConfigEditor } from "@/components/server/config-editors/DayZConfigEditor";
import { SevenDaysConfigEditor } from "@/components/server/config-editors/SevenDaysConfigEditor";
import { ArkConfigEditor } from "@/components/server/config-editors/ArkConfigEditor";
import type { GameServer } from "@/types";

interface ConfigTabProps {
  server: GameServer;
}

export function ConfigTab({ server }: ConfigTabProps) {
  const { api, isConnected } = useBackend();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.servers.getConfig(server.id);
      setRawContent(data.content);
      setOriginalContent(data.content);
      setHasChanges(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadConfig();
  }, [loadConfig, isConnected]);

  function handleContentChange(content: string) {
    setRawContent(content);
    setHasChanges(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.servers.saveConfig(server.id, rawContent);
      setOriginalContent(rawContent);
      toastSuccess("Configuration saved successfully");
      setHasChanges(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setRawContent(originalContent);
    setHasChanges(false);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading configuration...
        </CardContent>
      </Card>
    );
  }

  if (error && !rawContent) {
    return (
      <Card>
        <CardContent className="py-8">
          <Alert variant="destructive">
            <FaCircleExclamation className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const isRunning = server.status === "running";

  return (
    <div className="space-y-4">
      {/* Messages */}
      {error && (
        <Alert variant="destructive">
          <FaCircleExclamation className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Config Editor */}
      <Tabs defaultValue="form">
        <div className="flex items-center justify-between sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 -mt-2">
          <TabsList>
            <TabsTrigger value="form">Form Editor</TabsTrigger>
            <TabsTrigger value="raw" className="gap-2">
              <FaFileCode className="h-4 w-4 text-ring/70" />
              Raw Editor
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {hasChanges && <Badge variant="warning">Unsaved Changes</Badge>}
            {isRunning && <Badge variant="destructive">Restart required</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!hasChanges || saving}
            >
              <FaRotateLeft className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || saving || isRunning}
            >
              <FaFloppyDisk className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <TabsContent value="form" className="space-y-4">
          {server.gameId === "dayz" ? (
            <DayZConfigEditor
              rawContent={rawContent}
              originalContent={originalContent}
              onContentChange={handleContentChange}
            />
          ) : server.gameId === "7dtd" ? (
            <SevenDaysConfigEditor
              rawContent={rawContent}
              originalContent={originalContent}
              onContentChange={handleContentChange}
            />
          ) : server.gameId === "ark" ? (
            <ArkConfigEditor
              rawContent={rawContent}
              originalContent={originalContent}
              onContentChange={handleContentChange}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No form editor available for this game. Use the Raw Editor tab.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardHeader>
              <CardTitle>Raw Configuration</CardTitle>
              <CardDescription>
                Edit the configuration file directly
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                className="font-mono text-sm h-[500px]"
                value={rawContent}
                onChange={(e) => handleContentChange(e.target.value)}
                spellCheck={false}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
