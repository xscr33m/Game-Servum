import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  const missionMatch = content.match(/template\s*=\s*"([^"]+)"/);
  const missionTemplate = missionMatch
    ? missionMatch[1]
    : "dayzOffline.chernarusplus";

  return {
    hostname: getValue("hostname", "DayZ Server") as string,
    description: getValue("description", "") as string,
    password: getValue("password", "") as string,
    passwordAdmin: getValue("passwordAdmin", "") as string,
    maxPlayers: getValue("maxPlayers", 60) as number,
    enableWhitelist: getValue("enableWhitelist", 0) as number,
    verifySignatures: 2,
    guaranteedUpdates: 1,
    forceSameBuild: getValue("forceSameBuild", 1) as number,
    shardId: getValue("shardId", "") as string,
    instanceId: getValue("instanceId", 1) as number,
    storageAutoFix: getValue("storageAutoFix", 1) as number,
    disableVoN: getValue("disableVoN", 0) as number,
    vonCodecQuality: getValue("vonCodecQuality", 20) as number,
    disable3rdPerson: getValue("disable3rdPerson", 0) as number,
    disableCrosshair: getValue("disableCrosshair", 0) as number,
    disablePersonalLight: getValue("disablePersonalLight", 1) as number,
    lightingConfig: getValue("lightingConfig", 0) as number,
    serverTime: getValue("serverTime", "SystemTime") as string,
    serverTimeAcceleration: getValue("serverTimeAcceleration", 12) as number,
    serverNightTimeAcceleration: getValue(
      "serverNightTimeAcceleration",
      1,
    ) as number,
    serverTimePersistent: getValue("serverTimePersistent", 0) as number,
    loginQueueConcurrentPlayers: getValue(
      "loginQueueConcurrentPlayers",
      5,
    ) as number,
    loginQueueMaxPlayers: getValue("loginQueueMaxPlayers", 500) as number,
    missionTemplate,
  };
}

function generateConfig(config: DayZConfig, originalContent: string): string {
  let content = originalContent;

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

  const verifyRegex = /^(verifySignatures\s*=\s*)[\d]+;/m;
  if (content.match(verifyRegex)) {
    content = content.replace(verifyRegex, "$12;");
  }

  const guaranteedRegex = /^(guaranteedUpdates\s*=\s*)[\d]+;/m;
  if (content.match(guaranteedRegex)) {
    content = content.replace(guaranteedRegex, "$11;");
  }

  content = content.replace(
    /(template\s*=\s*)"[^"]+"/,
    `$1"${config.missionTemplate}"`,
  );

  return content;
}

interface DayZConfigEditorProps {
  rawContent: string;
  originalContent: string;
  onContentChange: (content: string) => void;
}

export function DayZConfigEditor({
  rawContent,
  originalContent,
  onContentChange,
}: DayZConfigEditorProps) {
  const config = parseConfig(rawContent);

  function handleChange<K extends keyof DayZConfig>(
    key: K,
    value: DayZConfig[K],
  ) {
    const newConfig = { ...config, [key]: value };
    onContentChange(generateConfig(newConfig, originalContent));
  }

  return (
    <div className="divide-y">
      {/* Basic Settings */}
      <div className="py-6 first:pt-0">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Basic Settings</h3>
          <p className="text-sm text-muted-foreground">
            Server name and access settings
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hostname">Server Name (Hostname)</Label>
            <Input
              id="hostname"
              value={config.hostname}
              onChange={(e) => handleChange("hostname", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxPlayers">Max Players</Label>
            <Input
              id="maxPlayers"
              type="number"
              value={config.maxPlayers}
              onChange={(e) =>
                handleChange("maxPlayers", parseInt(e.target.value) || 60)
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={config.description}
              onChange={(e) => handleChange("description", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Server Password (empty = public)</Label>
            <Input
              id="password"
              type="password"
              value={config.password}
              onChange={(e) => handleChange("password", e.target.value)}
              placeholder="Leave empty for public server"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="passwordAdmin">Admin Password</Label>
            <Input
              id="passwordAdmin"
              type="password"
              value={config.passwordAdmin}
              onChange={(e) => handleChange("passwordAdmin", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Gameplay Settings */}
      <div className="py-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Gameplay Settings</h3>
          <p className="text-sm text-muted-foreground">
            Configure gameplay options
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Third Person</Label>
            <Select
              value={String(config.disable3rdPerson)}
              onValueChange={(val) =>
                handleChange("disable3rdPerson", parseInt(val))
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
                handleChange("disableCrosshair", parseInt(val))
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
              onValueChange={(val) => handleChange("disableVoN", parseInt(val))}
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
                handleChange("vonCodecQuality", parseInt(e.target.value) || 20)
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Personal Light</Label>
            <Select
              value={String(config.disablePersonalLight)}
              onValueChange={(val) =>
                handleChange("disablePersonalLight", parseInt(val))
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
                handleChange("lightingConfig", parseInt(val))
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
        </div>
      </div>

      {/* Server Settings */}
      <div className="py-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Server Settings</h3>
          <p className="text-sm text-muted-foreground">
            Instance and storage configuration
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="instanceId">Instance ID</Label>
            <Input
              id="instanceId"
              type="number"
              min={1}
              value={config.instanceId}
              onChange={(e) =>
                handleChange("instanceId", parseInt(e.target.value) || 1)
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
              onChange={(e) => handleChange("shardId", e.target.value)}
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
                handleChange("enableWhitelist", parseInt(val))
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
                handleChange("forceSameBuild", parseInt(val))
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
                handleChange("storageAutoFix", parseInt(val))
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
        </div>
      </div>

      {/* Network Settings */}
      <div className="py-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Network Settings</h3>
          <p className="text-sm text-muted-foreground">
            Login queue and network configuration
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
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
                handleChange(
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
            <Label htmlFor="loginQueueMaxPlayers">Max Login Queue Size</Label>
            <Input
              id="loginQueueMaxPlayers"
              type="number"
              min={1}
              value={config.loginQueueMaxPlayers}
              onChange={(e) =>
                handleChange(
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
        </div>
      </div>

      {/* Time Settings */}
      <div className="py-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Time Settings</h3>
          <p className="text-sm text-muted-foreground">
            Configure in-game time
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="serverTime">Server Time</Label>
            <Input
              id="serverTime"
              value={config.serverTime}
              onChange={(e) => handleChange("serverTime", e.target.value)}
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
                handleChange("serverTimePersistent", parseInt(val))
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
                handleChange(
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
                handleChange(
                  "serverNightTimeAcceleration",
                  parseFloat(e.target.value) || 1,
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              Multiplied with day acceleration
            </p>
          </div>
        </div>
      </div>

      {/* Mission Settings */}
      <div className="py-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Mission / Map</h3>
          <p className="text-sm text-muted-foreground">
            Select the map to play on
          </p>
        </div>
        <div>
          <div className="space-y-2">
            <Label>Mission Template</Label>
            <Select
              value={config.missionTemplate}
              onValueChange={(val) => handleChange("missionTemplate", val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dayzOffline.chernarusplus">
                  Chernarus
                </SelectItem>
                <SelectItem value="dayzOffline.enoch">Livonia</SelectItem>
                <SelectItem value="dayzOffline.sakhal">Sakhal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
