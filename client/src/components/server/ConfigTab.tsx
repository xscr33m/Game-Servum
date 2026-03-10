import { useState, useEffect, useCallback, useRef } from "react";
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

interface ConfigEditorProps {
  rawContent: string;
  originalContent: string;
  onContentChange: (content: string) => void;
  fileName?: string;
}

const CONFIG_EDITORS: Record<string, React.ComponentType<ConfigEditorProps>> = {
  dayz: DayZConfigEditor,
  "7dtd": SevenDaysConfigEditor,
  ark: ArkConfigEditor,
};

interface FileState {
  rawContent: string;
  originalContent: string;
  hasChanges: boolean;
  loaded: boolean;
}

interface ConfigTabProps {
  server: GameServer;
}

export function ConfigTab({ server }: ConfigTabProps) {
  const { api, isConnected } = useBackend();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configFiles, setConfigFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>("");
  const fileStates = useRef<Map<string, FileState>>(new Map());
  // Force re-render when fileStates change
  const [, setRenderKey] = useState(0);

  const loadFile = useCallback(
    async (fileName?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.servers.getConfig(server.id, fileName);

        // Set available config files from first response
        if (data.configFiles && data.configFiles.length > 0) {
          setConfigFiles(data.configFiles);
        } else if (configFiles.length === 0) {
          setConfigFiles([data.fileName]);
        }

        const targetFile = data.fileName;
        fileStates.current.set(targetFile, {
          rawContent: data.content,
          originalContent: data.content,
          hasChanges: false,
          loaded: true,
        });

        if (!activeFile) {
          setActiveFile(targetFile);
        }
        setRenderKey((k) => k + 1);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [server.id, api.servers, activeFile, configFiles.length],
  );

  useEffect(() => {
    if (!isConnected) return;
    loadFile();
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFileSwitch(fileName: string) {
    setActiveFile(fileName);
    const state = fileStates.current.get(fileName);
    if (!state?.loaded) {
      loadFile(fileName);
    }
  }

  function handleContentChange(content: string) {
    const state = fileStates.current.get(activeFile);
    if (state) {
      state.rawContent = content;
      state.hasChanges = true;
      setRenderKey((k) => k + 1);
    }
  }

  async function handleSave() {
    const state = fileStates.current.get(activeFile);
    if (!state) return;

    setSaving(true);
    setError(null);
    try {
      await api.servers.saveConfig(server.id, state.rawContent, activeFile);
      state.originalContent = state.rawContent;
      state.hasChanges = false;
      toastSuccess("Configuration saved successfully");
      setRenderKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    const state = fileStates.current.get(activeFile);
    if (state) {
      state.rawContent = state.originalContent;
      state.hasChanges = false;
      setRenderKey((k) => k + 1);
    }
  }

  const currentState = fileStates.current.get(activeFile);
  const anyUnsaved = Array.from(fileStates.current.values()).some(
    (s) => s.hasChanges,
  );

  if (loading && !currentState?.loaded) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading configuration...
        </CardContent>
      </Card>
    );
  }

  if (error && !currentState?.rawContent) {
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
  const hasMultipleFiles = configFiles.length > 1;

  return (
    <div className="space-y-4">
      {/* Messages */}
      {error && (
        <Alert variant="destructive">
          <FaCircleExclamation className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* File selector tabs for multi-file games */}
      {hasMultipleFiles && (
        <Tabs value={activeFile} onValueChange={handleFileSwitch}>
          <TabsList>
            {configFiles.map((file) => {
              const state = fileStates.current.get(file);
              return (
                <TabsTrigger key={file} value={file} className="gap-2">
                  {file}
                  {state?.hasChanges && (
                    <span className="h-2 w-2 rounded-full bg-yellow-500" />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      {/* Config Editor */}
      {currentState && (
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
              {(currentState.hasChanges || anyUnsaved) && (
                <Badge variant="warning">Unsaved Changes</Badge>
              )}
              {isRunning && (
                <Badge variant="destructive">Restart required</Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={!currentState.hasChanges || saving}
              >
                <FaRotateLeft className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!currentState.hasChanges || saving || isRunning}
              >
                <FaFloppyDisk className="h-4 w-4 mr-2" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          <TabsContent value="form" className="space-y-4">
            {(() => {
              const Editor = CONFIG_EDITORS[server.gameId];
              return Editor ? (
                <Editor
                  rawContent={currentState.rawContent}
                  originalContent={currentState.originalContent}
                  onContentChange={handleContentChange}
                  fileName={activeFile}
                />
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No form editor available for this game. Use the Raw Editor
                    tab.
                  </CardContent>
                </Card>
              );
            })()}
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
                  value={currentState.rawContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  spellCheck={false}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
