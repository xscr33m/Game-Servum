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
  // Server Representation
  ServerName: string;
  ServerDescription: string;
  ServerWebsiteURL: string;
  ServerPassword: string;
  ServerLoginConfirmationText: string;
  Region: string;
  Language: string;
  // Networking
  ServerPort: number;
  ServerVisibility: number;
  ServerDisabledNetworkProtocols: string;
  ServerMaxWorldTransferSpeedKiBs: number;
  // Slots
  ServerMaxPlayerCount: number;
  ServerReservedSlots: number;
  ServerReservedSlotsPermission: number;
  ServerAdminSlots: number;
  ServerAdminSlotsPermission: number;
  // Admin Interfaces
  WebDashboardEnabled: string;
  WebDashboardPort: number;
  WebDashboardUrl: string;
  EnableMapRendering: string;
  TelnetEnabled: string;
  TelnetPort: number;
  TelnetPassword: string;
  TelnetFailedLoginLimit: number;
  TelnetFailedLoginsBlocktime: number;
  TerminalWindowEnabled: string;
  // Folder Locations
  AdminFileName: string;
  // Technical
  ServerAllowCrossplay: string;
  EACEnabled: string;
  IgnoreEOSSanctions: string;
  HideCommandExecutionLog: number;
  MaxUncoveredMapChunksPerPlayer: number;
  PersistentPlayerProfiles: string;
  MaxChunkAge: number;
  SaveDataLimit: number;
  // World
  GameWorld: string;
  WorldGenSeed: string;
  WorldGenSize: number;
  GameName: string;
  GameMode: string;
  // Difficulty
  GameDifficulty: number;
  BlockDamagePlayer: number;
  BlockDamageAI: number;
  BlockDamageAIBM: number;
  XPMultiplier: number;
  PlayerSafeZoneLevel: number;
  PlayerSafeZoneHours: number;
  // Game Rules
  BuildCreate: string;
  DayNightLength: number;
  DayLightLength: number;
  BiomeProgression: string;
  StormFreq: number;
  DeathPenalty: number;
  DropOnDeath: number;
  DropOnQuit: number;
  BedrollDeadZoneSize: number;
  BedrollExpiryTime: number;
  AllowSpawnNearFriend: number;
  CameraRestrictionMode: number;
  JarRefund: number;
  // Performance
  MaxSpawnedZombies: number;
  MaxSpawnedAnimals: number;
  ServerMaxAllowedViewDistance: number;
  MaxQueuedMeshLayers: number;
  // Zombie Settings
  EnemySpawnMode: string;
  EnemyDifficulty: number;
  ZombieFeralSense: number;
  ZombieMove: number;
  ZombieMoveNight: number;
  ZombieFeralMove: number;
  ZombieBMMove: number;
  AISmellMode: number;
  BloodMoonFrequency: number;
  BloodMoonRange: number;
  BloodMoonWarning: number;
  BloodMoonEnemyCount: number;
  // Loot
  LootAbundance: number;
  LootRespawnDays: number;
  AirDropFrequency: number;
  AirDropMarker: string;
  // Multiplayer
  PartySharedKillRange: number;
  PlayerKillingMode: number;
  // Land Claims
  LandClaimCount: number;
  LandClaimSize: number;
  LandClaimDeadZone: number;
  LandClaimExpiryTime: number;
  LandClaimDecayMode: number;
  LandClaimOnlineDurabilityModifier: number;
  LandClaimOfflineDurabilityModifier: number;
  LandClaimOfflineDelay: number;
  // Dynamic Mesh
  DynamicMeshEnabled: string;
  DynamicMeshLandClaimOnly: string;
  DynamicMeshLandClaimBuffer: number;
  DynamicMeshMaxItemCache: number;
  // Other
  TwitchServerPermission: number;
  TwitchBloodMoonAllowed: string;
  QuestProgressionDailyLimit: number;
}

const DEFAULTS: SevenDaysConfig = {
  ServerName: "My Game Host",
  ServerDescription: "A 7 Days to Die server",
  ServerWebsiteURL: "",
  ServerPassword: "",
  ServerLoginConfirmationText: "",
  Region: "NorthAmericaEast",
  Language: "English",
  ServerPort: 26900,
  ServerVisibility: 2,
  ServerDisabledNetworkProtocols: "SteamNetworking",
  ServerMaxWorldTransferSpeedKiBs: 512,
  ServerMaxPlayerCount: 8,
  ServerReservedSlots: 0,
  ServerReservedSlotsPermission: 100,
  ServerAdminSlots: 0,
  ServerAdminSlotsPermission: 0,
  WebDashboardEnabled: "false",
  WebDashboardPort: 8080,
  WebDashboardUrl: "",
  EnableMapRendering: "false",
  TelnetEnabled: "true",
  TelnetPort: 8081,
  TelnetPassword: "",
  TelnetFailedLoginLimit: 10,
  TelnetFailedLoginsBlocktime: 10,
  TerminalWindowEnabled: "true",
  AdminFileName: "serveradmin.xml",
  ServerAllowCrossplay: "false",
  EACEnabled: "true",
  IgnoreEOSSanctions: "false",
  HideCommandExecutionLog: 0,
  MaxUncoveredMapChunksPerPlayer: 131072,
  PersistentPlayerProfiles: "false",
  MaxChunkAge: -1,
  SaveDataLimit: -1,
  GameWorld: "Navezgane",
  WorldGenSeed: "MyGame",
  WorldGenSize: 6144,
  GameName: "MyGame",
  GameMode: "GameModeSurvival",
  GameDifficulty: 1,
  BlockDamagePlayer: 100,
  BlockDamageAI: 100,
  BlockDamageAIBM: 100,
  XPMultiplier: 100,
  PlayerSafeZoneLevel: 5,
  PlayerSafeZoneHours: 5,
  BuildCreate: "false",
  DayNightLength: 60,
  DayLightLength: 18,
  BiomeProgression: "true",
  StormFreq: 100,
  DeathPenalty: 1,
  DropOnDeath: 1,
  DropOnQuit: 0,
  BedrollDeadZoneSize: 15,
  BedrollExpiryTime: 45,
  AllowSpawnNearFriend: 2,
  CameraRestrictionMode: 0,
  JarRefund: 0,
  MaxSpawnedZombies: 64,
  MaxSpawnedAnimals: 50,
  ServerMaxAllowedViewDistance: 12,
  MaxQueuedMeshLayers: 1000,
  EnemySpawnMode: "true",
  EnemyDifficulty: 0,
  ZombieFeralSense: 0,
  ZombieMove: 0,
  ZombieMoveNight: 3,
  ZombieFeralMove: 3,
  ZombieBMMove: 3,
  AISmellMode: 3,
  BloodMoonFrequency: 7,
  BloodMoonRange: 0,
  BloodMoonWarning: 8,
  BloodMoonEnemyCount: 8,
  LootAbundance: 100,
  LootRespawnDays: 7,
  AirDropFrequency: 72,
  AirDropMarker: "true",
  PartySharedKillRange: 100,
  PlayerKillingMode: 3,
  LandClaimCount: 5,
  LandClaimSize: 41,
  LandClaimDeadZone: 30,
  LandClaimExpiryTime: 7,
  LandClaimDecayMode: 0,
  LandClaimOnlineDurabilityModifier: 4,
  LandClaimOfflineDurabilityModifier: 4,
  LandClaimOfflineDelay: 0,
  DynamicMeshEnabled: "true",
  DynamicMeshLandClaimOnly: "true",
  DynamicMeshLandClaimBuffer: 3,
  DynamicMeshMaxItemCache: 3,
  TwitchServerPermission: 90,
  TwitchBloodMoonAllowed: "false",
  QuestProgressionDailyLimit: 4,
};

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
  const result: Record<string, string | number> = {};
  for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
    const raw = getXmlProperty(content, key, String(defaultVal));
    result[key] = typeof defaultVal === "number" ? parseInt(raw, 10) || 0 : raw;
  }
  return result as unknown as SevenDaysConfig;
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

type FieldType = "text" | "number" | "password" | "boolean" | "select";

interface FieldDef {
  key: keyof SevenDaysConfig;
  label: string;
  type: FieldType;
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  colSpan?: 2;
}

interface SectionDef {
  title: string;
  description: string;
  fields: FieldDef[];
}

const MOVEMENT_OPTIONS = [
  { value: "0", label: "Walk" },
  { value: "1", label: "Jog" },
  { value: "2", label: "Run" },
  { value: "3", label: "Sprint" },
  { value: "4", label: "Nightmare" },
];

const SECTIONS: SectionDef[] = [
  {
    title: "Server",
    description: "Server identity, region, and language",
    fields: [
      { key: "ServerName", label: "Server Name", type: "text" },
      {
        key: "ServerDescription",
        label: "Description",
        type: "text",
        colSpan: 2,
      },
      {
        key: "ServerWebsiteURL",
        label: "Website URL",
        type: "text",
        placeholder: "https://...",
      },
      {
        key: "ServerPassword",
        label: "Password",
        type: "password",
        placeholder: "Leave empty for public",
        description: "Empty = public server",
      },
      {
        key: "ServerLoginConfirmationText",
        label: "Login Confirmation Text",
        type: "text",
        colSpan: 2,
        description: "Message shown to players when joining",
      },
      {
        key: "Region",
        label: "Region",
        type: "select",
        options: [
          { value: "NorthAmericaEast", label: "North America East" },
          { value: "NorthAmericaWest", label: "North America West" },
          { value: "CentralAmerica", label: "Central America" },
          { value: "SouthAmerica", label: "South America" },
          { value: "Europe", label: "Europe" },
          { value: "Russia", label: "Russia" },
          { value: "Asia", label: "Asia" },
          { value: "MiddleEast", label: "Middle East" },
          { value: "Africa", label: "Africa" },
          { value: "Oceania", label: "Oceania" },
        ],
      },
      {
        key: "Language",
        label: "Language",
        type: "text",
        description:
          "English name of the primary language (e.g. German, French)",
      },
    ],
  },
  {
    title: "Networking",
    description: "Port, visibility, and network protocol settings",
    fields: [
      {
        key: "ServerPort",
        label: "Server Port",
        type: "number",
        min: 1,
        max: 65535,
        description: "26900-26905 or 27015-27020 for LAN discovery",
      },
      {
        key: "ServerVisibility",
        label: "Visibility",
        type: "select",
        options: [
          { value: "0", label: "Not Listed" },
          { value: "1", label: "Friends Only" },
          { value: "2", label: "Public" },
        ],
      },
      {
        key: "ServerDisabledNetworkProtocols",
        label: "Disabled Protocols",
        type: "text",
        description: "Comma-separated: LiteNetLib, SteamNetworking",
      },
      {
        key: "ServerMaxWorldTransferSpeedKiBs",
        label: "Max World Transfer Speed (KiB/s)",
        type: "number",
        min: 0,
        description: "Maximum ~1300 KiB/s",
      },
    ],
  },
  {
    title: "Player Slots",
    description: "Maximum players, reserved and admin slots",
    fields: [
      {
        key: "ServerMaxPlayerCount",
        label: "Max Players",
        type: "number",
        min: 1,
      },
      {
        key: "ServerReservedSlots",
        label: "Reserved Slots",
        type: "number",
        min: 0,
      },
      {
        key: "ServerReservedSlotsPermission",
        label: "Reserved Slots Permission Level",
        type: "number",
        min: 0,
      },
      {
        key: "ServerAdminSlots",
        label: "Admin Slots",
        type: "number",
        min: 0,
      },
      {
        key: "ServerAdminSlotsPermission",
        label: "Admin Slots Permission Level",
        type: "number",
        min: 0,
      },
    ],
  },
  {
    title: "World",
    description: "World generation and game mode settings",
    fields: [
      {
        key: "GameWorld",
        label: "Game World",
        type: "select",
        options: [
          { value: "Navezgane", label: "Navezgane" },
          { value: "RWG", label: "Random Gen (RWG)" },
          { value: "Pregen06k01", label: "Pregen 6k #1" },
          { value: "Pregen06k02", label: "Pregen 6k #2" },
          { value: "Pregen08k01", label: "Pregen 8k #1" },
          { value: "Pregen08k02", label: "Pregen 8k #2" },
          { value: "Pregen10k01", label: "Pregen 10k #1" },
        ],
      },
      {
        key: "WorldGenSeed",
        label: "World Gen Seed",
        type: "text",
        description: "Seed for random world generation (RWG only)",
      },
      {
        key: "WorldGenSize",
        label: "World Gen Size",
        type: "select",
        description: "Map size in blocks (RWG only, must be multiple of 2048)",
        options: [
          { value: "6144", label: "6144 (Small)" },
          { value: "8192", label: "8192 (Medium)" },
          { value: "10240", label: "10240 (Large)" },
        ],
      },
      {
        key: "GameName",
        label: "Game Name",
        type: "text",
        description: "Save game folder name and decoration seed",
      },
      {
        key: "GameMode",
        label: "Game Mode",
        type: "select",
        options: [{ value: "GameModeSurvival", label: "Survival" }],
      },
    ],
  },
  {
    title: "Difficulty",
    description: "Difficulty level, damage multipliers, and safe zone settings",
    fields: [
      {
        key: "GameDifficulty",
        label: "Difficulty",
        type: "select",
        options: [
          { value: "0", label: "Scavenger (Easiest)" },
          { value: "1", label: "Adventurer" },
          { value: "2", label: "Nomad" },
          { value: "3", label: "Warrior" },
          { value: "4", label: "Survivalist" },
          { value: "5", label: "Insane (Hardest)" },
        ],
      },
      {
        key: "BlockDamagePlayer",
        label: "Player Block Damage (%)",
        type: "number",
        min: 0,
      },
      {
        key: "BlockDamageAI",
        label: "AI Block Damage (%)",
        type: "number",
        min: 0,
      },
      {
        key: "BlockDamageAIBM",
        label: "AI Blood Moon Block Damage (%)",
        type: "number",
        min: 0,
      },
      {
        key: "XPMultiplier",
        label: "XP Multiplier (%)",
        type: "number",
        min: 0,
      },
      {
        key: "PlayerSafeZoneLevel",
        label: "Safe Zone Level",
        type: "number",
        min: 0,
        description: "Players at or below this level create a safe zone",
      },
      {
        key: "PlayerSafeZoneHours",
        label: "Safe Zone Duration (hours)",
        type: "number",
        min: 0,
      },
    ],
  },
  {
    title: "Game Rules",
    description: "Day/night cycle, death penalties, and general gameplay rules",
    fields: [
      {
        key: "BuildCreate",
        label: "Creative Mode",
        type: "boolean",
        description: "Cheat mode on/off",
      },
      {
        key: "DayNightLength",
        label: "Day/Night Length (minutes)",
        type: "number",
        min: 10,
        max: 480,
        description: "Real-time minutes per in-game day",
      },
      {
        key: "DayLightLength",
        label: "Daylight Hours",
        type: "number",
        min: 0,
        max: 24,
        description: "In-game hours of daylight per day",
      },
      {
        key: "BiomeProgression",
        label: "Biome Progression",
        type: "boolean",
        description: "Biome hazards and loot stage caps",
      },
      {
        key: "StormFreq",
        label: "Storm Frequency (%)",
        type: "number",
        min: 0,
        description: "0 = off. Vanilla: 0, 50, 100, 150, 200, 300, 400, 500",
      },
      {
        key: "DeathPenalty",
        label: "Death Penalty",
        type: "select",
        options: [
          { value: "0", label: "Nothing" },
          { value: "1", label: "Default (XP Penalty)" },
          { value: "2", label: "Injured (Keep debuffs)" },
          { value: "3", label: "Permanent Death (Full reset)" },
        ],
      },
      {
        key: "DropOnDeath",
        label: "Drop on Death",
        type: "select",
        options: [
          { value: "0", label: "Nothing" },
          { value: "1", label: "Everything" },
          { value: "2", label: "Toolbelt Only" },
          { value: "3", label: "Backpack Only" },
          { value: "4", label: "Delete All" },
        ],
      },
      {
        key: "DropOnQuit",
        label: "Drop on Quit",
        type: "select",
        options: [
          { value: "0", label: "Nothing" },
          { value: "1", label: "Everything" },
          { value: "2", label: "Toolbelt Only" },
          { value: "3", label: "Backpack Only" },
        ],
      },
      {
        key: "BedrollDeadZoneSize",
        label: "Bedroll Dead Zone Size",
        type: "number",
        min: 0,
        description: "Box radius where no zombies spawn",
      },
      {
        key: "BedrollExpiryTime",
        label: "Bedroll Expiry (days)",
        type: "number",
        min: 0,
        description: "Real-world days before inactive bedroll expires",
      },
      {
        key: "AllowSpawnNearFriend",
        label: "Spawn Near Friend",
        type: "select",
        options: [
          { value: "0", label: "Disabled" },
          { value: "1", label: "Always" },
          { value: "2", label: "Only in Forest Biome" },
        ],
      },
      {
        key: "CameraRestrictionMode",
        label: "Camera Mode",
        type: "select",
        options: [
          { value: "0", label: "Free (First & Third Person)" },
          { value: "1", label: "First Person Only" },
          { value: "2", label: "Third Person Only" },
        ],
      },
      {
        key: "JarRefund",
        label: "Jar Refund (%)",
        type: "number",
        min: 0,
        max: 100,
        description: "Empty jar refund after consuming an item",
      },
    ],
  },
  {
    title: "Zombies & Blood Moon",
    description: "Zombie behavior, movement speeds, and blood moon settings",
    fields: [
      {
        key: "EnemySpawnMode",
        label: "Enemy Spawning",
        type: "boolean",
      },
      {
        key: "EnemyDifficulty",
        label: "Enemy Difficulty",
        type: "select",
        options: [
          { value: "0", label: "Normal" },
          { value: "1", label: "Feral" },
        ],
      },
      {
        key: "ZombieFeralSense",
        label: "Feral Sense",
        type: "select",
        options: [
          { value: "0", label: "Off" },
          { value: "1", label: "Day" },
          { value: "2", label: "Night" },
          { value: "3", label: "All" },
        ],
      },
      {
        key: "ZombieMove",
        label: "Zombie Speed (Day)",
        type: "select",
        options: MOVEMENT_OPTIONS,
      },
      {
        key: "ZombieMoveNight",
        label: "Zombie Speed (Night)",
        type: "select",
        options: MOVEMENT_OPTIONS,
      },
      {
        key: "ZombieFeralMove",
        label: "Feral Speed",
        type: "select",
        options: MOVEMENT_OPTIONS,
      },
      {
        key: "ZombieBMMove",
        label: "Blood Moon Speed",
        type: "select",
        options: MOVEMENT_OPTIONS,
      },
      {
        key: "AISmellMode",
        label: "AI Smell Mode",
        type: "select",
        options: [
          { value: "0", label: "Off" },
          { value: "1", label: "Walk" },
          { value: "2", label: "Jog" },
          { value: "3", label: "Run" },
          { value: "4", label: "Sprint" },
          { value: "5", label: "Nightmare" },
        ],
      },
      {
        key: "BloodMoonFrequency",
        label: "Blood Moon Frequency (days)",
        type: "number",
        min: 0,
        description: "0 = no blood moons",
      },
      {
        key: "BloodMoonRange",
        label: "Blood Moon Variation (days)",
        type: "number",
        min: 0,
        description: "Random deviation from frequency",
      },
      {
        key: "BloodMoonWarning",
        label: "Blood Moon Warning Hour",
        type: "number",
        min: -1,
        max: 24,
        description: "Hour the red day number shows (-1 = never)",
      },
      {
        key: "BloodMoonEnemyCount",
        label: "Blood Moon Enemies per Player",
        type: "number",
        min: 0,
        description: "Max zombies per player during blood moon",
      },
    ],
  },
  {
    title: "Loot & Airdrops",
    description: "Loot abundance, respawn, and airdrop settings",
    fields: [
      {
        key: "LootAbundance",
        label: "Loot Abundance (%)",
        type: "number",
        min: 0,
      },
      {
        key: "LootRespawnDays",
        label: "Loot Respawn (days)",
        type: "number",
        min: 0,
      },
      {
        key: "AirDropFrequency",
        label: "Airdrop Frequency (game hours)",
        type: "number",
        min: 0,
        description: "0 = never",
      },
      {
        key: "AirDropMarker",
        label: "Airdrop Map Marker",
        type: "boolean",
      },
    ],
  },
  {
    title: "Multiplayer",
    description: "Party and player killing settings",
    fields: [
      {
        key: "PartySharedKillRange",
        label: "Party Shared Kill Range",
        type: "number",
        min: 0,
        description: "Distance for shared XP and quest credit",
      },
      {
        key: "PlayerKillingMode",
        label: "Player Killing",
        type: "select",
        options: [
          { value: "0", label: "No Killing" },
          { value: "1", label: "Kill Allies Only" },
          { value: "2", label: "Kill Strangers Only" },
          { value: "3", label: "Kill Everyone" },
        ],
      },
    ],
  },
  {
    title: "Land Claims",
    description: "Land claim protection, decay, and durability",
    fields: [
      {
        key: "LandClaimCount",
        label: "Max Claims per Player",
        type: "number",
        min: 0,
      },
      {
        key: "LandClaimSize",
        label: "Claim Size (blocks)",
        type: "number",
        min: 0,
        description: "Size protected by a keystone",
      },
      {
        key: "LandClaimDeadZone",
        label: "Dead Zone (blocks)",
        type: "number",
        min: 0,
        description: "Minimum distance between keystones",
      },
      {
        key: "LandClaimExpiryTime",
        label: "Expiry (days)",
        type: "number",
        min: 0,
        description: "Real-world days offline before claims expire",
      },
      {
        key: "LandClaimDecayMode",
        label: "Decay Mode",
        type: "select",
        options: [
          { value: "0", label: "Slow (Linear)" },
          { value: "1", label: "Fast (Exponential)" },
          { value: "2", label: "None (Full Protection)" },
        ],
      },
      {
        key: "LandClaimOnlineDurabilityModifier",
        label: "Online Durability Multiplier",
        type: "number",
        min: 0,
        description: "0 = infinite (no damage)",
      },
      {
        key: "LandClaimOfflineDurabilityModifier",
        label: "Offline Durability Multiplier",
        type: "number",
        min: 0,
        description: "0 = infinite (no damage)",
      },
      {
        key: "LandClaimOfflineDelay",
        label: "Offline Delay (minutes)",
        type: "number",
        min: 0,
        description: "Delay before switching to offline durability",
      },
    ],
  },
  {
    title: "Performance",
    description: "Spawn limits, view distance, and rendering settings",
    fields: [
      {
        key: "MaxSpawnedZombies",
        label: "Max Spawned Zombies",
        type: "number",
        min: 0,
        description: "Total zombie limit for entire map",
      },
      {
        key: "MaxSpawnedAnimals",
        label: "Max Spawned Animals",
        type: "number",
        min: 0,
      },
      {
        key: "ServerMaxAllowedViewDistance",
        label: "Max View Distance",
        type: "number",
        min: 6,
        max: 12,
        description: "High impact on memory and performance",
      },
      {
        key: "MaxQueuedMeshLayers",
        label: "Max Queued Mesh Layers",
        type: "number",
        min: 0,
        description: "Lower = less memory, slower chunk generation",
      },
    ],
  },
  {
    title: "Admin Interfaces",
    description: "Web dashboard and telnet (RCON) configuration",
    fields: [
      {
        key: "WebDashboardEnabled",
        label: "Web Dashboard",
        type: "boolean",
      },
      {
        key: "WebDashboardPort",
        label: "Dashboard Port",
        type: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "WebDashboardUrl",
        label: "Dashboard External URL",
        type: "text",
        placeholder: "https://...",
        description: "Leave empty to use public IP directly",
      },
      {
        key: "EnableMapRendering",
        label: "Map Rendering",
        type: "boolean",
        description: "Render map tiles while exploring",
      },
      {
        key: "TelnetEnabled",
        label: "Telnet (RCON)",
        type: "boolean",
        description: "Required for player tracking and scheduled messages",
      },
      {
        key: "TelnetPort",
        label: "Telnet Port",
        type: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "TelnetPassword",
        label: "Telnet Password",
        type: "password",
        placeholder: "Required for remote access",
        description: "Must be set for Game-Servum RCON features",
      },
      {
        key: "TelnetFailedLoginLimit",
        label: "Failed Login Limit",
        type: "number",
        min: 0,
        description: "Max wrong passwords before blocking client",
      },
      {
        key: "TelnetFailedLoginsBlocktime",
        label: "Failed Login Blocktime (seconds)",
        type: "number",
        min: 0,
      },
      {
        key: "TerminalWindowEnabled",
        label: "Terminal Window",
        type: "boolean",
        description: "Show log output window (Windows only)",
      },
    ],
  },
  {
    title: "Advanced",
    description: "Anti-cheat, technical settings, dynamic mesh, and more",
    fields: [
      {
        key: "AdminFileName",
        label: "Admin File Name",
        type: "text",
        description: "Relative to UserDataFolder/Saves",
      },
      {
        key: "ServerAllowCrossplay",
        label: "Crossplay",
        type: "boolean",
      },
      { key: "EACEnabled", label: "EasyAntiCheat", type: "boolean" },
      {
        key: "IgnoreEOSSanctions",
        label: "Ignore EOS Sanctions",
        type: "boolean",
      },
      {
        key: "HideCommandExecutionLog",
        label: "Hide Command Log",
        type: "select",
        options: [
          { value: "0", label: "Show Everything" },
          { value: "1", label: "Hide from Telnet/Panel" },
          { value: "2", label: "Also Hide from Clients" },
          { value: "3", label: "Hide Everything" },
        ],
      },
      {
        key: "MaxUncoveredMapChunksPerPlayer",
        label: "Max Uncovered Map Chunks",
        type: "number",
        min: 0,
        description: "Max map file size per player = value \u00d7 512 bytes",
      },
      {
        key: "PersistentPlayerProfiles",
        label: "Persistent Profiles",
        type: "boolean",
        description: "Lock players to their last used profile",
      },
      {
        key: "MaxChunkAge",
        label: "Max Chunk Age (days)",
        type: "number",
        description: "-1 = never reset unvisited chunks",
      },
      {
        key: "SaveDataLimit",
        label: "Save Data Limit (MB)",
        type: "number",
        description: "-1 = no limit",
      },
      {
        key: "DynamicMeshEnabled",
        label: "Dynamic Mesh",
        type: "boolean",
      },
      {
        key: "DynamicMeshLandClaimOnly",
        label: "Dynamic Mesh LCB Only",
        type: "boolean",
        description: "Only active in land claim areas",
      },
      {
        key: "DynamicMeshLandClaimBuffer",
        label: "Dynamic Mesh LCB Buffer",
        type: "number",
        min: 0,
        description: "Chunk radius around land claims",
      },
      {
        key: "DynamicMeshMaxItemCache",
        label: "Dynamic Mesh Max Cache",
        type: "number",
        min: 0,
        description: "Concurrent items processed (more = more RAM)",
      },
      {
        key: "TwitchServerPermission",
        label: "Twitch Permission Level",
        type: "number",
        min: 0,
      },
      {
        key: "TwitchBloodMoonAllowed",
        label: "Twitch Blood Moon Actions",
        type: "boolean",
        description: "Allow Twitch actions during blood moon (may cause lag)",
      },
      {
        key: "QuestProgressionDailyLimit",
        label: "Quest Progression Daily Limit",
        type: "number",
        min: 0,
        description: "Quests per day that count toward tier progression",
      },
    ],
  },
];

function renderField(
  field: FieldDef,
  config: SevenDaysConfig,
  handleChange: (key: keyof SevenDaysConfig, value: string | number) => void,
) {
  const colClass =
    field.colSpan === 2 ? "space-y-2 md:col-span-2" : "space-y-2";
  const value = config[field.key];

  switch (field.type) {
    case "text":
    case "password":
      return (
        <div className={colClass} key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            type={field.type}
            value={String(value)}
            onChange={(e) => handleChange(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );

    case "number":
      return (
        <div className={colClass} key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            type="number"
            min={field.min}
            max={field.max}
            value={Number(value)}
            onChange={(e) =>
              handleChange(field.key, parseInt(e.target.value, 10) || 0)
            }
          />
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );

    case "boolean":
      return (
        <div className={colClass} key={field.key}>
          <Label>{field.label}</Label>
          <Select
            value={String(value)}
            onValueChange={(val) => handleChange(field.key, val)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Enabled</SelectItem>
              <SelectItem value="false">Disabled</SelectItem>
            </SelectContent>
          </Select>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );

    case "select":
      return (
        <div className={colClass} key={field.key}>
          <Label>{field.label}</Label>
          <Select
            value={String(value)}
            onValueChange={(val) => {
              const def = DEFAULTS[field.key];
              handleChange(
                field.key,
                typeof def === "number" ? parseInt(val, 10) : val,
              );
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );
  }
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

  function handleChange(key: keyof SevenDaysConfig, value: string | number) {
    const newConfig = { ...config, [key]: value };
    onContentChange(generateConfig(newConfig, originalContent));
  }

  return (
    <>
      {SECTIONS.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {section.fields.map((field) =>
              renderField(field, config, handleChange),
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
