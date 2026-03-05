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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess } from "@/lib/toast";
import type { GameServer } from "@/types";

interface ConfigTabProps {
  server: GameServer;
}

interface DayZConfig {
  // Basic Settings
  hostname: string;
  description: string;
  password: string;
  passwordAdmin: string;
  maxPlayers: number;
  enableWhitelist: number;

  // Fixed Values (not editable)
  verifySignatures: number; // Always 2
  guaranteedUpdates: number; // Always 1

  // Server Settings
  forceSameBuild: number;
  shardId: string;
  instanceId: number;
  storageAutoFix: number;

  // Gameplay Settings
  disableVoN: number;
  vonCodecQuality: number;
  disable3rdPerson: number;
  disableCrosshair: number;
  disablePersonalLight: number;
  lightingConfig: number;

  // Time Settings
  serverTime: string;
  serverTimeAcceleration: number;
  serverNightTimeAcceleration: number;
  serverTimePersistent: number;

  // Login Queue
  loginQueueConcurrentPlayers: number;
  loginQueueMaxPlayers: number;

  // Mission
  missionTemplate: string;
}

function parseConfig(content: string): DayZConfig {
  const getValue = (
    key: string,
    defaultValue: string | number,
  ): string | number => {
    // Match patterns like: key = "value"; or key = value;
    const stringMatch = content.match(
      new RegExp(`^${key}\\s*=\\s*"([^"]*)";`, "m"),
    );
    if (stringMatch) return stringMatch[1];

    const numMatch = content.match(
      new RegExp(`^${key}\\s*=\\s*([\\d.]+);`, "m"),
    );
    if (numMatch) return parseFloat(numMatch[1]);

    return defaultValue;
  };

  // Extract mission template from class block
  const missionMatch = content.match(/template\s*=\s*"([^"]+)"/);
  const missionTemplate = missionMatch
    ? missionMatch[1]
    : "dayzOffline.chernarusplus";

  return {
    // Basic Settings
    hostname: getValue("hostname", "DayZ Server") as string,
    description: getValue("description", "") as string,
    password: getValue("password", "") as string,
    passwordAdmin: getValue("passwordAdmin", "") as string,
    maxPlayers: getValue("maxPlayers", 60) as number,
    enableWhitelist: getValue("enableWhitelist", 0) as number,

    // Fixed Values (always use these values)
    verifySignatures: 2,
    guaranteedUpdates: 1,

    // Server Settings
    forceSameBuild: getValue("forceSameBuild", 1) as number,
    shardId: getValue("shardId", "") as string,
    instanceId: getValue("instanceId", 1) as number,
    storageAutoFix: getValue("storageAutoFix", 1) as number,

    // Gameplay Settings
    disableVoN: getValue("disableVoN", 0) as number,
    vonCodecQuality: getValue("vonCodecQuality", 20) as number,
    disable3rdPerson: getValue("disable3rdPerson", 0) as number,
    disableCrosshair: getValue("disableCrosshair", 0) as number,
    disablePersonalLight: getValue("disablePersonalLight", 1) as number,
    lightingConfig: getValue("lightingConfig", 0) as number,

    // Time Settings
    serverTime: getValue("serverTime", "SystemTime") as string,
    serverTimeAcceleration: getValue("serverTimeAcceleration", 12) as number,
    serverNightTimeAcceleration: getValue(
      "serverNightTimeAcceleration",
      1,
    ) as number,
    serverTimePersistent: getValue("serverTimePersistent", 0) as number,

    // Login Queue
    loginQueueConcurrentPlayers: getValue(
      "loginQueueConcurrentPlayers",
      5,
    ) as number,
    loginQueueMaxPlayers: getValue("loginQueueMaxPlayers", 500) as number,

    // Mission
    missionTemplate,
  };
}

function generateConfig(config: DayZConfig, originalContent: string): string {
  let content = originalContent;

  // Update string values
  const stringKeys = [
    "hostname",
    "description",
    "password",
    "passwordAdmin",
    "serverTime",
    "shardId",
  ] as const;
  for (const key of stringKeys) {
    const regex = new RegExp(`^(${key}\\s*=\\s*)"[^"]*";`, "m");
    if (content.match(regex)) {
      content = content.replace(regex, `$1"${config[key]}";`);
    }
  }

  // Update numeric values (excluding fixed values)
  const numKeys = [
    "maxPlayers",
    "forceSameBuild",
    "disableVoN",
    "vonCodecQuality",
    "disable3rdPerson",
    "disableCrosshair",
    "disablePersonalLight",
    "lightingConfig",
    "serverTimeAcceleration",
    "serverNightTimeAcceleration",
    "serverTimePersistent",
    "enableWhitelist",
    "loginQueueConcurrentPlayers",
    "loginQueueMaxPlayers",
    "instanceId",
    "storageAutoFix",
  ] as const;
  for (const key of numKeys) {
    const regex = new RegExp(`^(${key}\\s*=\\s*)[\\d.]+;`, "m");
    if (content.match(regex)) {
      content = content.replace(regex, `$1${config[key]};`);
    }
  }

  // Fixed values - always set to required values
  const verifyRegex = /^(verifySignatures\s*=\s*)[\d]+;/m;
  if (content.match(verifyRegex)) {
    content = content.replace(verifyRegex, "$12;");
  }

  const guaranteedRegex = /^(guaranteedUpdates\s*=\s*)[\d]+;/m;
  if (content.match(guaranteedRegex)) {
    content = content.replace(guaranteedRegex, "$11;");
  }

  // Update mission template
  content = content.replace(
    /(template\s*=\s*)"[^"]+"/,
    `$1"${config.missionTemplate}"`,
  );

  return content;
}

export function ConfigTab({ server }: ConfigTabProps) {
  const { api } = useBackend();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [config, setConfig] = useState<DayZConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.servers.getConfig(server.id);
      setRawContent(data.content);
      setOriginalContent(data.content);

      if (server.gameId === "dayz") {
        setConfig(parseConfig(data.content));
      }
      setHasChanges(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [server.id, server.gameId, api.servers]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  function handleConfigChange<K extends keyof DayZConfig>(
    key: K,
    value: DayZConfig[K],
  ) {
    if (!config) return;
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    setRawContent(generateConfig(newConfig, originalContent));
    setHasChanges(true);
  }

  function handleRawChange(content: string) {
    setRawContent(content);
    if (server.gameId === "dayz") {
      setConfig(parseConfig(content));
    }
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
    if (server.gameId === "dayz") {
      setConfig(parseConfig(originalContent));
    }
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
        <div className="flex items-center justify-between">
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
          {server.gameId === "dayz" && config ? (
            <>
              {/* Basic Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Basic Settings</CardTitle>
                  <CardDescription>
                    Server name and access settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="hostname">Server Name (Hostname)</Label>
                    <Input
                      id="hostname"
                      value={config.hostname}
                      onChange={(e) =>
                        handleConfigChange("hostname", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxPlayers">Max Players</Label>
                    <Input
                      id="maxPlayers"
                      type="number"
                      value={config.maxPlayers}
                      onChange={(e) =>
                        handleConfigChange(
                          "maxPlayers",
                          parseInt(e.target.value) || 60,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      value={config.description}
                      onChange={(e) =>
                        handleConfigChange("description", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      Server Password (empty = public)
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={config.password}
                      onChange={(e) =>
                        handleConfigChange("password", e.target.value)
                      }
                      placeholder="Leave empty for public server"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passwordAdmin">Admin Password</Label>
                    <Input
                      id="passwordAdmin"
                      type="password"
                      value={config.passwordAdmin}
                      onChange={(e) =>
                        handleConfigChange("passwordAdmin", e.target.value)
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Gameplay Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Gameplay Settings</CardTitle>
                  <CardDescription>Configure gameplay options</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Third Person</Label>
                    <Select
                      value={String(config.disable3rdPerson)}
                      onValueChange={(val) =>
                        handleConfigChange("disable3rdPerson", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Enabled</SelectItem>
                        <SelectItem value="1">Disabled (1PP Only)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Crosshair</Label>
                    <Select
                      value={String(config.disableCrosshair)}
                      onValueChange={(val) =>
                        handleConfigChange("disableCrosshair", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Enabled</SelectItem>
                        <SelectItem value="1">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Voice over Network</Label>
                    <Select
                      value={String(config.disableVoN)}
                      onValueChange={(val) =>
                        handleConfigChange("disableVoN", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Enabled</SelectItem>
                        <SelectItem value="1">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vonCodecQuality">VoN Quality (0-30)</Label>
                    <Input
                      id="vonCodecQuality"
                      type="number"
                      min={0}
                      max={30}
                      value={config.vonCodecQuality}
                      onChange={(e) =>
                        handleConfigChange(
                          "vonCodecQuality",
                          parseInt(e.target.value) || 20,
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Personal Light</Label>
                    <Select
                      value={String(config.disablePersonalLight)}
                      onValueChange={(val) =>
                        handleConfigChange(
                          "disablePersonalLight",
                          parseInt(val),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Enabled</SelectItem>
                        <SelectItem value="1">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Night Brightness</Label>
                    <Select
                      value={String(config.lightingConfig)}
                      onValueChange={(val) =>
                        handleConfigChange("lightingConfig", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Brighter Nights</SelectItem>
                        <SelectItem value="1">Darker Nights</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Server Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Server Settings</CardTitle>
                  <CardDescription>
                    Instance and storage configuration
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="instanceId">Instance ID</Label>
                    <Input
                      id="instanceId"
                      type="number"
                      min={1}
                      value={config.instanceId}
                      onChange={(e) =>
                        handleConfigChange(
                          "instanceId",
                          parseInt(e.target.value) || 1,
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Identifies storage folders for persistence files
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shardId">Shard ID (Private Server)</Label>
                    <Input
                      id="shardId"
                      value={config.shardId}
                      onChange={(e) =>
                        handleConfigChange("shardId", e.target.value)
                      }
                      placeholder="e.g., 123abc"
                      maxLength={6}
                    />
                    <p className="text-xs text-muted-foreground">
                      Six alphanumeric characters for private servers
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Whitelist</Label>
                    <Select
                      value={String(config.enableWhitelist)}
                      onValueChange={(val) =>
                        handleConfigChange("enableWhitelist", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Disabled</SelectItem>
                        <SelectItem value="1">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Force Same Build</Label>
                    <Select
                      value={String(config.forceSameBuild)}
                      onValueChange={(val) =>
                        handleConfigChange("forceSameBuild", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Disabled</SelectItem>
                        <SelectItem value="1">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Only allow clients with same .exe revision
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Storage Auto-Fix</Label>
                    <Select
                      value={String(config.storageAutoFix)}
                      onValueChange={(val) =>
                        handleConfigChange("storageAutoFix", parseInt(val))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Disabled</SelectItem>
                        <SelectItem value="1">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Auto-replace corrupted persistence files
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Network Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Network Settings</CardTitle>
                  <CardDescription>
                    Login queue and network configuration
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="loginQueueConcurrentPlayers">
                      Concurrent Login Players
                    </Label>
                    <Input
                      id="loginQueueConcurrentPlayers"
                      type="number"
                      min={1}
                      value={config.loginQueueConcurrentPlayers}
                      onChange={(e) =>
                        handleConfigChange(
                          "loginQueueConcurrentPlayers",
                          parseInt(e.target.value) || 5,
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Players processed simultaneously during login
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="loginQueueMaxPlayers">
                      Max Login Queue Size
                    </Label>
                    <Input
                      id="loginQueueMaxPlayers"
                      type="number"
                      min={1}
                      value={config.loginQueueMaxPlayers}
                      onChange={(e) =>
                        handleConfigChange(
                          "loginQueueMaxPlayers",
                          parseInt(e.target.value) || 500,
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum players waiting in login queue
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Verify Signatures</Label>
                    <Input value="2 (Required)" disabled className="bg-muted" />
                    <p className="text-xs text-muted-foreground">
                      Fixed value - required for .pbo verification
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Guaranteed Updates</Label>
                    <Input value="1 (Required)" disabled className="bg-muted" />
                    <p className="text-xs text-muted-foreground">
                      Fixed value - communication protocol
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Time Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Time Settings</CardTitle>
                  <CardDescription>Configure in-game time</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="serverTime">Server Time</Label>
                    <Input
                      id="serverTime"
                      value={config.serverTime}
                      onChange={(e) =>
                        handleConfigChange("serverTime", e.target.value)
                      }
                      placeholder="SystemTime or YYYY/MM/DD/HH/MM"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use "SystemTime" or format like "2024/06/15/12/00"
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Time Persistent</Label>
                    <Select
                      value={String(config.serverTimePersistent)}
                      onValueChange={(val) =>
                        handleConfigChange(
                          "serverTimePersistent",
                          parseInt(val),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">No (Reset on restart)</SelectItem>
                        <SelectItem value="1">Yes (Save time)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="serverTimeAcceleration">
                      Day Time Acceleration
                    </Label>
                    <Input
                      id="serverTimeAcceleration"
                      type="number"
                      min={0.1}
                      max={64}
                      step={0.1}
                      value={config.serverTimeAcceleration}
                      onChange={(e) =>
                        handleConfigChange(
                          "serverTimeAcceleration",
                          parseFloat(e.target.value) || 1,
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      1 = real-time, 2 = 2x faster, etc.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="serverNightTimeAcceleration">
                      Night Time Acceleration
                    </Label>
                    <Input
                      id="serverNightTimeAcceleration"
                      type="number"
                      min={0.1}
                      max={64}
                      step={0.1}
                      value={config.serverNightTimeAcceleration}
                      onChange={(e) =>
                        handleConfigChange(
                          "serverNightTimeAcceleration",
                          parseFloat(e.target.value) || 1,
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Multiplied with day acceleration
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Mission Settings */}
              <Card>
                <CardHeader>
                  <CardTitle>Mission / Map</CardTitle>
                  <CardDescription>Select the map to play on</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label>Mission Template</Label>
                    <Select
                      value={config.missionTemplate}
                      onValueChange={(val) =>
                        handleConfigChange("missionTemplate", val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dayzOffline.chernarusplus">
                          Chernarus
                        </SelectItem>
                        <SelectItem value="dayzOffline.enoch">
                          Livonia
                        </SelectItem>
                        <SelectItem value="dayzOffline.sakhal">
                          Sakhal
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Form editor is only available for DayZ servers. Use the Raw
                Editor tab.
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
                onChange={(e) => handleRawChange(e.target.value)}
                spellCheck={false}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
