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

interface ArkConfig {
  // [ServerSettings]
  ServerName: string;
  ServerPassword: string;
  ServerAdminPassword: string;
  MaxPlayers: number;
  RCONEnabled: string;
  RCONPort: number;
  AutoSavePeriodMinutes: number;
  AllowThirdPersonPlayer: string;
  ShowMapPlayerLocation: string;
  EnablePvPGamma: string;

  // [SessionSettings]
  SessionName: string;
  QueryPort: number;

  // [/Script/ShooterGame.ShooterGameMode]
  XPMultiplier: number;
  TamingSpeedMultiplier: number;
  HarvestAmountMultiplier: number;
  DayCycleSpeedScale: number;
  NightTimeSpeedScale: number;
  DinoCountMultiplier: number;
}

const DEFAULTS: ArkConfig = {
  ServerName: "ARK Server",
  ServerPassword: "",
  ServerAdminPassword: "",
  MaxPlayers: 70,
  RCONEnabled: "True",
  RCONPort: 27020,
  AutoSavePeriodMinutes: 15,
  AllowThirdPersonPlayer: "True",
  ShowMapPlayerLocation: "True",
  EnablePvPGamma: "True",
  SessionName: "ARK Server",
  QueryPort: 27015,
  XPMultiplier: 1,
  TamingSpeedMultiplier: 1,
  HarvestAmountMultiplier: 1,
  DayCycleSpeedScale: 1,
  NightTimeSpeedScale: 1,
  DinoCountMultiplier: 1,
};

// INI parser: find Key=Value within any section
function getIniValue(
  content: string,
  key: string,
  defaultValue: string,
): string {
  // Match Key=Value (case-insensitive key match)
  const regex = new RegExp(`^${key}\\s*=\\s*(.*)$`, "im");
  const match = content.match(regex);
  return match ? match[1].trim() : defaultValue;
}

function setIniValue(content: string, key: string, value: string): string {
  const regex = new RegExp(`^(${key}\\s*=\\s*).*$`, "im");
  if (content.match(regex)) {
    return content.replace(regex, `$1${value}`);
  }
  return content;
}

function parseConfig(content: string): ArkConfig {
  return {
    ServerName: getIniValue(content, "ServerName", DEFAULTS.ServerName),
    ServerPassword: getIniValue(
      content,
      "ServerPassword",
      DEFAULTS.ServerPassword,
    ),
    ServerAdminPassword: getIniValue(
      content,
      "ServerAdminPassword",
      DEFAULTS.ServerAdminPassword,
    ),
    MaxPlayers:
      parseFloat(
        getIniValue(content, "MaxPlayers", String(DEFAULTS.MaxPlayers)),
      ) || DEFAULTS.MaxPlayers,
    RCONEnabled: getIniValue(content, "RCONEnabled", DEFAULTS.RCONEnabled),
    RCONPort:
      parseInt(getIniValue(content, "RCONPort", String(DEFAULTS.RCONPort))) ||
      DEFAULTS.RCONPort,
    AutoSavePeriodMinutes:
      parseFloat(
        getIniValue(
          content,
          "AutoSavePeriodMinutes",
          String(DEFAULTS.AutoSavePeriodMinutes),
        ),
      ) || DEFAULTS.AutoSavePeriodMinutes,
    AllowThirdPersonPlayer: getIniValue(
      content,
      "AllowThirdPersonPlayer",
      DEFAULTS.AllowThirdPersonPlayer,
    ),
    ShowMapPlayerLocation: getIniValue(
      content,
      "ShowMapPlayerLocation",
      DEFAULTS.ShowMapPlayerLocation,
    ),
    EnablePvPGamma: getIniValue(
      content,
      "EnablePvPGamma",
      DEFAULTS.EnablePvPGamma,
    ),
    SessionName: getIniValue(content, "SessionName", DEFAULTS.SessionName),
    QueryPort:
      parseInt(getIniValue(content, "QueryPort", String(DEFAULTS.QueryPort))) ||
      DEFAULTS.QueryPort,
    XPMultiplier:
      parseFloat(
        getIniValue(content, "XPMultiplier", String(DEFAULTS.XPMultiplier)),
      ) || DEFAULTS.XPMultiplier,
    TamingSpeedMultiplier:
      parseFloat(
        getIniValue(
          content,
          "TamingSpeedMultiplier",
          String(DEFAULTS.TamingSpeedMultiplier),
        ),
      ) || DEFAULTS.TamingSpeedMultiplier,
    HarvestAmountMultiplier:
      parseFloat(
        getIniValue(
          content,
          "HarvestAmountMultiplier",
          String(DEFAULTS.HarvestAmountMultiplier),
        ),
      ) || DEFAULTS.HarvestAmountMultiplier,
    DayCycleSpeedScale:
      parseFloat(
        getIniValue(
          content,
          "DayCycleSpeedScale",
          String(DEFAULTS.DayCycleSpeedScale),
        ),
      ) || DEFAULTS.DayCycleSpeedScale,
    NightTimeSpeedScale:
      parseFloat(
        getIniValue(
          content,
          "NightTimeSpeedScale",
          String(DEFAULTS.NightTimeSpeedScale),
        ),
      ) || DEFAULTS.NightTimeSpeedScale,
    DinoCountMultiplier:
      parseFloat(
        getIniValue(
          content,
          "DinoCountMultiplier",
          String(DEFAULTS.DinoCountMultiplier),
        ),
      ) || DEFAULTS.DinoCountMultiplier,
  };
}

function generateConfig(config: ArkConfig, originalContent: string): string {
  let content = originalContent;
  for (const [key, value] of Object.entries(config)) {
    content = setIniValue(content, key, String(value));
  }
  return content;
}

interface ArkConfigEditorProps {
  rawContent: string;
  originalContent: string;
  onContentChange: (content: string) => void;
}

export function ArkConfigEditor({
  rawContent,
  originalContent,
  onContentChange,
}: ArkConfigEditorProps) {
  const config = parseConfig(rawContent);

  function handleChange<K extends keyof ArkConfig>(
    key: K,
    value: ArkConfig[K],
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
          <CardDescription>Basic server information and access</CardDescription>
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
            <Label htmlFor="SessionName">Session Name</Label>
            <Input
              id="SessionName"
              value={config.SessionName}
              onChange={(e) => handleChange("SessionName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="MaxPlayers">Max Players</Label>
            <Input
              id="MaxPlayers"
              type="number"
              min={1}
              value={config.MaxPlayers}
              onChange={(e) =>
                handleChange("MaxPlayers", parseInt(e.target.value) || 70)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="AutoSavePeriodMinutes">
              Auto-Save Interval (minutes)
            </Label>
            <Input
              id="AutoSavePeriodMinutes"
              type="number"
              min={1}
              value={config.AutoSavePeriodMinutes}
              onChange={(e) =>
                handleChange(
                  "AutoSavePeriodMinutes",
                  parseFloat(e.target.value) || 15,
                )
              }
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
          <div className="space-y-2">
            <Label htmlFor="ServerAdminPassword">Admin Password</Label>
            <Input
              id="ServerAdminPassword"
              type="password"
              value={config.ServerAdminPassword}
              onChange={(e) =>
                handleChange("ServerAdminPassword", e.target.value)
              }
            />
            <p className="text-xs text-muted-foreground">
              Required for RCON and in-game admin access
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Gameplay Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Gameplay Settings</CardTitle>
          <CardDescription>Player and visual options</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Third Person</Label>
            <Select
              value={config.AllowThirdPersonPlayer}
              onValueChange={(val) =>
                handleChange("AllowThirdPersonPlayer", val)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="True">Enabled</SelectItem>
                <SelectItem value="False">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Show Player Map Location</Label>
            <Select
              value={config.ShowMapPlayerLocation}
              onValueChange={(val) =>
                handleChange("ShowMapPlayerLocation", val)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="True">Enabled</SelectItem>
                <SelectItem value="False">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>PvP Gamma</Label>
            <Select
              value={config.EnablePvPGamma}
              onValueChange={(val) => handleChange("EnablePvPGamma", val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="True">Enabled</SelectItem>
                <SelectItem value="False">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Multipliers */}
      <Card>
        <CardHeader>
          <CardTitle>Rates & Multipliers</CardTitle>
          <CardDescription>
            XP, taming, harvesting, and time scale
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="XPMultiplier">XP Multiplier</Label>
            <Input
              id="XPMultiplier"
              type="number"
              min={0.1}
              step={0.1}
              value={config.XPMultiplier}
              onChange={(e) =>
                handleChange("XPMultiplier", parseFloat(e.target.value) || 1)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="TamingSpeedMultiplier">Taming Speed</Label>
            <Input
              id="TamingSpeedMultiplier"
              type="number"
              min={0.1}
              step={0.1}
              value={config.TamingSpeedMultiplier}
              onChange={(e) =>
                handleChange(
                  "TamingSpeedMultiplier",
                  parseFloat(e.target.value) || 1,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="HarvestAmountMultiplier">Harvest Amount</Label>
            <Input
              id="HarvestAmountMultiplier"
              type="number"
              min={0.1}
              step={0.1}
              value={config.HarvestAmountMultiplier}
              onChange={(e) =>
                handleChange(
                  "HarvestAmountMultiplier",
                  parseFloat(e.target.value) || 1,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="DayCycleSpeedScale">Day Cycle Speed</Label>
            <Input
              id="DayCycleSpeedScale"
              type="number"
              min={0.1}
              step={0.1}
              value={config.DayCycleSpeedScale}
              onChange={(e) =>
                handleChange(
                  "DayCycleSpeedScale",
                  parseFloat(e.target.value) || 1,
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              1.0 = default, lower = longer days
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="NightTimeSpeedScale">Night Time Speed</Label>
            <Input
              id="NightTimeSpeedScale"
              type="number"
              min={0.1}
              step={0.1}
              value={config.NightTimeSpeedScale}
              onChange={(e) =>
                handleChange(
                  "NightTimeSpeedScale",
                  parseFloat(e.target.value) || 1,
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              1.0 = default, higher = shorter nights
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="DinoCountMultiplier">Dino Count</Label>
            <Input
              id="DinoCountMultiplier"
              type="number"
              min={0.1}
              step={0.1}
              value={config.DinoCountMultiplier}
              onChange={(e) =>
                handleChange(
                  "DinoCountMultiplier",
                  parseFloat(e.target.value) || 1,
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Network & RCON */}
      <Card>
        <CardHeader>
          <CardTitle>Network & RCON</CardTitle>
          <CardDescription>
            Port and remote console configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="QueryPort">Query Port</Label>
            <Input
              id="QueryPort"
              type="number"
              value={config.QueryPort}
              onChange={(e) =>
                handleChange("QueryPort", parseInt(e.target.value) || 27015)
              }
            />
          </div>
          <div className="space-y-2">
            <Label>RCON</Label>
            <Select
              value={config.RCONEnabled}
              onValueChange={(val) => handleChange("RCONEnabled", val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="True">Enabled</SelectItem>
                <SelectItem value="False">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Required for player tracking and scheduled messages
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="RCONPort">RCON Port</Label>
            <Input
              id="RCONPort"
              type="number"
              value={config.RCONPort}
              onChange={(e) =>
                handleChange("RCONPort", parseInt(e.target.value) || 27020)
              }
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
