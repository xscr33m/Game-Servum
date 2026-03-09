import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SevenDaysConfig {
  // Server
  ServerName: string;
  ServerDescription: string;
  ServerWebsiteURL: string;
  ServerPassword: string;
  ServerMaxPlayerCount: number;

  // Gameplay
  GameWorld: string;
  GameName: string;
  GameDifficulty: number;
  DayNightLength: number;
  PlayerKillingMode: number;

  // Advanced
  EACEnabled: string;
  TelnetEnabled: string;
  TelnetPort: number;
  TelnetPassword: string;

  // Multiplayer
  MaxSpawnedZombies: number;
  MaxSpawnedAnimals: number;
  LootAbundance: number;
  LootRespawnDays: number;
  BlockDurabilityModifier: number;
}

const DEFAULTS: SevenDaysConfig = {
  ServerName: "My 7 Days to Die Server",
  ServerDescription: "",
  ServerWebsiteURL: "",
  ServerPassword: "",
  ServerMaxPlayerCount: 8,
  GameWorld: "Navezgane",
  GameName: "My Game",
  GameDifficulty: 2,
  DayNightLength: 60,
  PlayerKillingMode: 3,
  EACEnabled: "true",
  TelnetEnabled: "true",
  TelnetPort: 8081,
  TelnetPassword: "",
  MaxSpawnedZombies: 64,
  MaxSpawnedAnimals: 50,
  LootAbundance: 100,
  LootRespawnDays: 30,
  BlockDurabilityModifier: 100,
};

// Parse XML property value: <property name="Key" value="Value"/>
function getXmlProperty(
  content: string,
  name: string,
  defaultValue: string,
): string {
  const regex = new RegExp(
    `<property\\s+name\\s*=\\s*"${name}"\\s+value\\s*=\\s*"([^"]*)"`,
    "i",
  );
  const match = content.match(regex);
  return match ? match[1] : defaultValue;
}

function setXmlProperty(content: string, name: string, value: string): string {
  const regex = new RegExp(
    `(<property\\s+name\\s*=\\s*"${name}"\\s+value\\s*=\\s*")[^"]*"`,
    "i",
  );
  if (content.match(regex)) {
    return content.replace(regex, `$1${value}"`);
  }
  return content;
}

function parseConfig(content: string): SevenDaysConfig {
  return {
    ServerName: getXmlProperty(content, "ServerName", DEFAULTS.ServerName),
    ServerDescription: getXmlProperty(
      content,
      "ServerDescription",
      DEFAULTS.ServerDescription,
    ),
    ServerWebsiteURL: getXmlProperty(
      content,
      "ServerWebsiteURL",
      DEFAULTS.ServerWebsiteURL,
    ),
    ServerPassword: getXmlProperty(
      content,
      "ServerPassword",
      DEFAULTS.ServerPassword,
    ),
    ServerMaxPlayerCount: parseInt(
      getXmlProperty(
        content,
        "ServerMaxPlayerCount",
        String(DEFAULTS.ServerMaxPlayerCount),
      ),
    ),
    GameWorld: getXmlProperty(content, "GameWorld", DEFAULTS.GameWorld),
    GameName: getXmlProperty(content, "GameName", DEFAULTS.GameName),
    GameDifficulty: parseInt(
      getXmlProperty(
        content,
        "GameDifficulty",
        String(DEFAULTS.GameDifficulty),
      ),
    ),
    DayNightLength: parseInt(
      getXmlProperty(
        content,
        "DayNightLength",
        String(DEFAULTS.DayNightLength),
      ),
    ),
    PlayerKillingMode: parseInt(
      getXmlProperty(
        content,
        "PlayerKillingMode",
        String(DEFAULTS.PlayerKillingMode),
      ),
    ),
    EACEnabled: getXmlProperty(content, "EACEnabled", DEFAULTS.EACEnabled),
    TelnetEnabled: getXmlProperty(
      content,
      "TelnetEnabled",
      DEFAULTS.TelnetEnabled,
    ),
    TelnetPort: parseInt(
      getXmlProperty(content, "TelnetPort", String(DEFAULTS.TelnetPort)),
    ),
    TelnetPassword: getXmlProperty(
      content,
      "TelnetPassword",
      DEFAULTS.TelnetPassword,
    ),
    MaxSpawnedZombies: parseInt(
      getXmlProperty(
        content,
        "MaxSpawnedZombies",
        String(DEFAULTS.MaxSpawnedZombies),
      ),
    ),
    MaxSpawnedAnimals: parseInt(
      getXmlProperty(
        content,
        "MaxSpawnedAnimals",
        String(DEFAULTS.MaxSpawnedAnimals),
      ),
    ),
    LootAbundance: parseInt(
      getXmlProperty(content, "LootAbundance", String(DEFAULTS.LootAbundance)),
    ),
    LootRespawnDays: parseInt(
      getXmlProperty(
        content,
        "LootRespawnDays",
        String(DEFAULTS.LootRespawnDays),
      ),
    ),
    BlockDurabilityModifier: parseInt(
      getXmlProperty(
        content,
        "BlockDurabilityModifier",
        String(DEFAULTS.BlockDurabilityModifier),
      ),
    ),
  };
}

function generateConfig(
  config: SevenDaysConfig,
  originalContent: string,
): string {
  let content = originalContent;
  for (const [key, value] of Object.entries(config)) {
    content = setXmlProperty(content, key, String(value));
  }
  return content;
}

interface SevenDaysConfigEditorProps {
  rawContent: string;
  originalContent: string;
  onContentChange: (content: string) => void;
}

export function SevenDaysConfigEditor({
  rawContent,
  originalContent,
  onContentChange,
}: SevenDaysConfigEditorProps) {
  const config = parseConfig(rawContent);

  function handleChange<K extends keyof SevenDaysConfig>(
    key: K,
    value: SevenDaysConfig[K],
  ) {
    const newConfig = { ...config, [key]: value };
    onContentChange(generateConfig(newConfig, originalContent));
  }

  return (
    <>
      {/* Server Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Server Settings</CardTitle>
          <CardDescription>Basic server configuration</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ServerName">Server Name</Label>
            <Input
              id="ServerName"
              value={config.ServerName}
              onChange={(e) => handleChange("ServerName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ServerMaxPlayerCount">Max Players</Label>
            <Input
              id="ServerMaxPlayerCount"
              type="number"
              min={1}
              value={config.ServerMaxPlayerCount}
              onChange={(e) =>
                handleChange(
                  "ServerMaxPlayerCount",
                  parseInt(e.target.value) || 8,
                )
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="ServerDescription">Description</Label>
            <Input
              id="ServerDescription"
              value={config.ServerDescription}
              onChange={(e) =>
                handleChange("ServerDescription", e.target.value)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ServerWebsiteURL">Website URL</Label>
            <Input
              id="ServerWebsiteURL"
              value={config.ServerWebsiteURL}
              onChange={(e) => handleChange("ServerWebsiteURL", e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ServerPassword">
              Server Password (empty = public)
            </Label>
            <Input
              id="ServerPassword"
              type="password"
              value={config.ServerPassword}
              onChange={(e) => handleChange("ServerPassword", e.target.value)}
              placeholder="Leave empty for public server"
            />
          </div>
        </CardContent>
      </Card>

      {/* Gameplay Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Gameplay Settings</CardTitle>
          <CardDescription>World and difficulty configuration</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="GameWorld">Game World</Label>
            <Select
              value={config.GameWorld}
              onValueChange={(val) => handleChange("GameWorld", val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Navezgane">Navezgane</SelectItem>
                <SelectItem value="RWG">Random Gen World</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="GameName">Game Name</Label>
            <Input
              id="GameName"
              value={config.GameName}
              onChange={(e) => handleChange("GameName", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Used for save game folder name (Random Gen seed)
            </p>
          </div>
          <div className="space-y-2">
            <Label>Difficulty</Label>
            <Select
              value={String(config.GameDifficulty)}
              onValueChange={(val) =>
                handleChange("GameDifficulty", parseInt(val))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Scavenger</SelectItem>
                <SelectItem value="1">Adventurer</SelectItem>
                <SelectItem value="2">Nomad</SelectItem>
                <SelectItem value="3">Warrior</SelectItem>
                <SelectItem value="4">Survivalist</SelectItem>
                <SelectItem value="5">Insane</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="DayNightLength">Day/Night Length (minutes)</Label>
            <Input
              id="DayNightLength"
              type="number"
              min={10}
              max={240}
              value={config.DayNightLength}
              onChange={(e) =>
                handleChange("DayNightLength", parseInt(e.target.value) || 60)
              }
            />
            <p className="text-xs text-muted-foreground">
              Real-time minutes for a full in-game day
            </p>
          </div>
          <div className="space-y-2">
            <Label>Player Killing Mode</Label>
            <Select
              value={String(config.PlayerKillingMode)}
              onValueChange={(val) =>
                handleChange("PlayerKillingMode", parseInt(val))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No Killing</SelectItem>
                <SelectItem value="1">Kill Allies Only</SelectItem>
                <SelectItem value="2">Kill Strangers Only</SelectItem>
                <SelectItem value="3">Kill Everyone</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Spawn & Loot Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Spawn & Loot</CardTitle>
          <CardDescription>
            Zombie, animal, and loot configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="MaxSpawnedZombies">Max Spawned Zombies</Label>
            <Input
              id="MaxSpawnedZombies"
              type="number"
              min={0}
              value={config.MaxSpawnedZombies}
              onChange={(e) =>
                handleChange(
                  "MaxSpawnedZombies",
                  parseInt(e.target.value) || 64,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="MaxSpawnedAnimals">Max Spawned Animals</Label>
            <Input
              id="MaxSpawnedAnimals"
              type="number"
              min={0}
              value={config.MaxSpawnedAnimals}
              onChange={(e) =>
                handleChange(
                  "MaxSpawnedAnimals",
                  parseInt(e.target.value) || 50,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="LootAbundance">Loot Abundance (%)</Label>
            <Input
              id="LootAbundance"
              type="number"
              min={0}
              value={config.LootAbundance}
              onChange={(e) =>
                handleChange("LootAbundance", parseInt(e.target.value) || 100)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="LootRespawnDays">Loot Respawn (days)</Label>
            <Input
              id="LootRespawnDays"
              type="number"
              min={0}
              value={config.LootRespawnDays}
              onChange={(e) =>
                handleChange("LootRespawnDays", parseInt(e.target.value) || 30)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="BlockDurabilityModifier">
              Block Durability (%)
            </Label>
            <Input
              id="BlockDurabilityModifier"
              type="number"
              min={0}
              value={config.BlockDurabilityModifier}
              onChange={(e) =>
                handleChange(
                  "BlockDurabilityModifier",
                  parseInt(e.target.value) || 100,
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>
            Anti-cheat and remote access configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>EasyAntiCheat</Label>
            <Select
              value={config.EACEnabled}
              onValueChange={(val) => handleChange("EACEnabled", val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Telnet (RCON)</Label>
            <Select
              value={config.TelnetEnabled}
              onValueChange={(val) => handleChange("TelnetEnabled", val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Enabled</SelectItem>
                <SelectItem value="false">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Required for player tracking and scheduled messages
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="TelnetPort">Telnet Port</Label>
            <Input
              id="TelnetPort"
              type="number"
              value={config.TelnetPort}
              onChange={(e) =>
                handleChange("TelnetPort", parseInt(e.target.value) || 8081)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="TelnetPassword">Telnet Password</Label>
            <Input
              id="TelnetPassword"
              type="password"
              value={config.TelnetPassword}
              onChange={(e) => handleChange("TelnetPassword", e.target.value)}
              placeholder="Required for remote access"
            />
            <p className="text-xs text-muted-foreground">
              Must be set for Game Servum RCON features to work
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
