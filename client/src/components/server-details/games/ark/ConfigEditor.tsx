import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess, toastError } from "@/lib/toast";
import { FaFloppyDisk } from "react-icons/fa6";

// ── ARK Maps ───────────────────────────────────────────────────────

const ARK_MAPS = [
  { value: "TheIsland", label: "The Island" },
  { value: "TheCenter", label: "The Center" },
  { value: "ScorchedEarth_P", label: "Scorched Earth" },
  { value: "Ragnarok", label: "Ragnarok" },
  { value: "Aberration_P", label: "Aberration" },
  { value: "Extinction", label: "Extinction" },
  { value: "Valguero_P", label: "Valguero" },
  { value: "Genesis", label: "Genesis: Part 1" },
  { value: "Gen2", label: "Genesis: Part 2" },
  { value: "CrystalIsles", label: "Crystal Isles" },
  { value: "LostIsland", label: "Lost Island" },
  { value: "Fjordur", label: "Fjordur" },
] as const;

/** Extract the map name (first token before '?') from launch params */
function getMapFromLaunchParams(launchParams: string): string {
  const firstQ = launchParams.indexOf("?");
  return firstQ !== -1
    ? launchParams.slice(0, firstQ)
    : launchParams.split(/\s/)[0] || "TheIsland";
}

// ── Section-aware INI helpers ──────────────────────────────────────
/** Strip UTF-8 BOM that Unreal Engine prepends to INI files. */
function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
function getIniValue(
  content: string,
  section: string,
  key: string,
): string | null {
  const clean = stripBom(content);
  const lines = clean.split("\n");
  const sectionHeader = `[${section}]`;
  let inSection = false;
  const keyLower = key.toLowerCase();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === sectionHeader.toLowerCase()) {
      inSection = true;
      continue;
    }
    if (trimmed.startsWith("[")) {
      if (inSection) break;
      continue;
    }
    if (inSection) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const existingKey = trimmed.substring(0, eqIdx).trim();
        if (existingKey.toLowerCase() === keyLower) {
          return trimmed.substring(eqIdx + 1).trim();
        }
      }
    }
  }
  return null;
}

function setIniValue(
  content: string,
  section: string,
  key: string,
  value: string,
): string {
  const clean = stripBom(content);
  const lines = clean.split("\n");
  const sectionHeader = `[${section}]`;
  let sectionStart = -1;
  let sectionEnd = lines.length;
  const keyLower = key.toLowerCase();

  // Find the section
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.toLowerCase() === sectionHeader.toLowerCase()) {
      sectionStart = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim().startsWith("[")) {
          sectionEnd = j;
          break;
        }
      }
      break;
    }
  }

  if (sectionStart === -1) {
    // Section not found — append section + key
    const newLines = clean.endsWith("\n") ? [] : [""];
    newLines.push(sectionHeader, `${key}=${value}`);
    return clean + newLines.join("\n") + "\n";
  }

  // Look for existing key in section
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const trimmed = lines[i].trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const existingKey = trimmed.substring(0, eqIdx).trim();
      if (existingKey.toLowerCase() === keyLower) {
        lines[i] = `${existingKey}=${value}`;
        return lines.join("\n");
      }
    }
  }

  // Key not found in section — insert before section end
  lines.splice(sectionEnd, 0, `${key}=${value}`);
  return lines.join("\n");
}

function hasIniKey(content: string, section: string, key: string): boolean {
  return getIniValue(stripBom(content), section, key) !== null;
}

// ── Field & Section definitions ────────────────────────────────────

type FieldType =
  | "text"
  | "number"
  | "float"
  | "password"
  | "boolean"
  | "select";

interface FieldDef {
  key: string;
  section: string;
  label: string;
  type: FieldType;
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  colSpan?: 2;
  /** Default value shown for Game.ini fields when not yet in the file */
  defaultValue?: string | number;
  /** Regex matching characters to strip from input (applied on every change) */
  sanitizePattern?: RegExp;
}

interface SectionDef {
  title: string;
  description: string;
  fields: FieldDef[];
}

// ── GameUserSettings.ini sections ──────────────────────────────────

const GUS_SECTIONS: SectionDef[] = [
  {
    title: "Server Identity",
    description: "Server name, password, and player slots",
    fields: [
      {
        key: "SessionName",
        section: "SessionSettings",
        label: "Session Name",
        type: "text",
        description: "Only letters, digits, hyphens and underscores",
        sanitizePattern: /[^a-zA-Z0-9_-]/g,
      },
      {
        key: "ServerPassword",
        section: "ServerSettings",
        label: "Server Password",
        type: "password",
        placeholder: "Leave empty for public server",
        description: "Empty = public server",
      },
      {
        key: "ServerAdminPassword",
        section: "ServerSettings",
        label: "Admin Password",
        type: "password",
        description: "Required for RCON and in-game admin access",
      },
      {
        key: "MaxPlayers",
        section: "/Script/Engine.GameSession",
        label: "Max Players",
        type: "number",
        min: 1,
        max: 500,
      },
    ],
  },
  {
    title: "Gameplay Options",
    description: "Player and visual options",
    fields: [
      {
        key: "AllowThirdPersonPlayer",
        section: "ServerSettings",
        label: "Third Person",
        type: "boolean",
      },
      {
        key: "ShowMapPlayerLocation",
        section: "ServerSettings",
        label: "Show Player Map Location",
        type: "boolean",
      },
      {
        key: "ServerCrosshair",
        section: "ServerSettings",
        label: "Crosshair",
        type: "boolean",
      },
      {
        key: "AllowHitMarkers",
        section: "ServerSettings",
        label: "Hit Markers",
        type: "boolean",
      },
      {
        key: "EnablePvPGamma",
        section: "ServerSettings",
        label: "PvP Gamma",
        type: "boolean",
      },
      {
        key: "AllowFlyerCarryPvE",
        section: "ServerSettings",
        label: "Flyer Carry (PvE)",
        type: "boolean",
      },
      {
        key: "ShowAnniversaryContent",
        section: "ServerSettings",
        label: "Anniversary Content",
        type: "boolean",
        description: "Show anniversary event content",
      },
    ],
  },
  {
    title: "Difficulty & Rates",
    description: "Difficulty and item scaling",
    fields: [
      {
        key: "DifficultyOffset",
        section: "ServerSettings",
        label: "Difficulty Offset",
        type: "float",
        min: 0,
        step: 0.1,
        description: "0 = easiest, 1 = hardest (official)",
      },
      {
        key: "OverrideOfficialDifficulty",
        section: "ServerSettings",
        label: "Override Official Difficulty",
        type: "float",
        min: 0,
        step: 0.5,
        description: "Max wild dino level = 30 x this value",
      },
      {
        key: "MaxTamedDinos",
        section: "ServerSettings",
        label: "Max Tamed Dinos",
        type: "float",
        min: 0,
        step: 100,
      },
      {
        key: "ItemStackSizeMultiplier",
        section: "ServerSettings",
        label: "Item Stack Size Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
      },
      {
        key: "GreaterRiftActivationMultiplier",
        section: "ServerSettings",
        label: "Greater Rift Activation Multiplier",
        type: "float",
        min: 0,
        step: 0.1,
        description: "Multiplier for Greater Rift activation (Fjordur)",
      },
    ],
  },
  {
    title: "Building & Structures",
    description: "Structure limits, pickup, and decay",
    fields: [
      {
        key: "TheMaxStructuresInRange",
        section: "ServerSettings",
        label: "Max Structures in Range",
        type: "float",
        min: 0,
        step: 500,
      },
      {
        key: "PerPlatformMaxStructuresMultiplier",
        section: "ServerSettings",
        label: "Platform Structure Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
      },
      {
        key: "PlatformSaddleBuildAreaBoundsMultiplier",
        section: "ServerSettings",
        label: "Platform Saddle Area Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
      },
      {
        key: "StructurePickupTimeAfterPlacement",
        section: "ServerSettings",
        label: "Pickup Time After Placement (s)",
        type: "float",
        min: 0,
        step: 5,
        description: "Seconds a structure can be picked up after placing",
      },
      {
        key: "StructurePickupHoldDuration",
        section: "ServerSettings",
        label: "Pickup Hold Duration (s)",
        type: "float",
        min: 0,
        step: 0.1,
        description: "How long you must hold to pick up",
      },
      {
        key: "StructurePreventResourceRadiusMultiplier",
        section: "ServerSettings",
        label: "Resource Prevention Radius",
        type: "float",
        min: 0,
        step: 0.1,
        description: "Resource respawn prevention radius around structures",
      },
      {
        key: "AllowIntegratedSPlusStructures",
        section: "ServerSettings",
        label: "Integrated S+ Structures",
        type: "boolean",
      },
      {
        key: "DisableStructureDecayPvE",
        section: "ServerSettings",
        label: "Disable Structure Decay (PvE)",
        type: "boolean",
      },
      {
        key: "PvEDinoDecayPeriodMultiplier",
        section: "ServerSettings",
        label: "PvE Dino Decay Multiplier",
        type: "float",
        min: 0,
        step: 0.1,
      },
    ],
  },
  {
    title: "Server Management",
    description: "Auto-save, idle kicks, and logging",
    fields: [
      {
        key: "AutoSavePeriodMinutes",
        section: "ServerSettings",
        label: "Auto-Save Interval (minutes)",
        type: "float",
        min: 1,
        step: 1,
      },
      {
        key: "KickIdlePlayersPeriod",
        section: "ServerSettings",
        label: "Kick Idle Players (seconds)",
        type: "float",
        min: 0,
        step: 60,
        description: "0 = disabled",
      },
      {
        key: "TribeNameChangeCooldown",
        section: "ServerSettings",
        label: "Tribe Name Change Cooldown (min)",
        type: "float",
        min: 0,
        step: 1,
      },
      {
        key: "AllowHideDamageSourceFromLogs",
        section: "ServerSettings",
        label: "Hide Damage Source from Logs",
        type: "boolean",
      },
      {
        key: "RCONServerGameLogBuffer",
        section: "ServerSettings",
        label: "RCON Game Log Buffer",
        type: "float",
        min: 0,
        step: 100,
        description: "Max log entries buffered for RCON",
      },
      {
        key: "RaidDinoCharacterFoodDrainMultiplier",
        section: "ServerSettings",
        label: "Raid Dino Food Drain Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
      },
      {
        key: "OxygenSwimSpeedStatMultiplier",
        section: "ServerSettings",
        label: "Oxygen Swim Speed Multiplier",
        type: "float",
        min: 0,
        step: 0.1,
      },
      {
        key: "ListenServerTetherDistanceMultiplier",
        section: "ServerSettings",
        label: "Tether Distance Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Non-dedicated session tether distance",
      },
    ],
  },
  {
    title: "Network & RCON",
    description: "Remote console and query configuration",
    fields: [
      {
        key: "RCONEnabled",
        section: "ServerSettings",
        label: "RCON",
        type: "boolean",
        description: "Required for player tracking and scheduled messages",
      },
      {
        key: "RCONPort",
        section: "ServerSettings",
        label: "RCON Port",
        type: "number",
      },
    ],
  },
];

// ── Game.ini sections ──────────────────────────────────────────────

const GAME_MODE = "/Script/ShooterGame.ShooterGameMode";

const GAME_INI_SECTIONS: SectionDef[] = [
  {
    title: "XP Rates",
    description: "Experience point multipliers",
    fields: [
      {
        key: "XPMultiplier",
        section: GAME_MODE,
        label: "Global XP Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "KillXPMultiplier",
        section: GAME_MODE,
        label: "Kill XP Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "HarvestXPMultiplier",
        section: GAME_MODE,
        label: "Harvest XP Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "CraftXPMultiplier",
        section: GAME_MODE,
        label: "Craft XP Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "GenericXPMultiplier",
        section: GAME_MODE,
        label: "Generic XP Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "SpecialXPMultiplier",
        section: GAME_MODE,
        label: "Special XP Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Taming & Breeding",
    description: "Taming speed, breeding, and maturation",
    fields: [
      {
        key: "TamingSpeedMultiplier",
        section: GAME_MODE,
        label: "Taming Speed Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "EggHatchSpeedMultiplier",
        section: GAME_MODE,
        label: "Egg Hatch Speed Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "BabyMatureSpeedMultiplier",
        section: GAME_MODE,
        label: "Baby Mature Speed Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "MatingIntervalMultiplier",
        section: GAME_MODE,
        label: "Mating Interval Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more frequent mating",
        defaultValue: 1.0,
      },
      {
        key: "MatingSpeedMultiplier",
        section: GAME_MODE,
        label: "Mating Speed Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = faster mating process",
        defaultValue: 1.0,
      },
      {
        key: "BabyFoodConsumptionSpeedMultiplier",
        section: GAME_MODE,
        label: "Baby Food Consumption Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "LayEggIntervalMultiplier",
        section: GAME_MODE,
        label: "Lay Egg Interval Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more frequent egg laying",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Imprinting",
    description: "Baby imprinting and cuddle settings",
    fields: [
      {
        key: "BabyImprintingStatScaleMultiplier",
        section: GAME_MODE,
        label: "Imprint Stat Scale Multiplier",
        type: "float",
        min: 0,
        step: 0.1,
        description: "Bonus stats per imprint %",
        defaultValue: 1.0,
      },
      {
        key: "BabyImprintAmountMultiplier",
        section: GAME_MODE,
        label: "Imprint Amount Multiplier",
        type: "float",
        min: 0,
        step: 0.1,
        description: "Imprint % gained per cuddle",
        defaultValue: 1.0,
      },
      {
        key: "BabyCuddleIntervalMultiplier",
        section: GAME_MODE,
        label: "Cuddle Interval Multiplier",
        type: "float",
        min: 0.01,
        step: 0.1,
        description: "Lower = more frequent cuddle requests",
        defaultValue: 1.0,
      },
      {
        key: "BabyCuddleGracePeriodMultiplier",
        section: GAME_MODE,
        label: "Cuddle Grace Period Multiplier",
        type: "float",
        min: 0,
        step: 0.1,
        description: "Time window to complete cuddle",
        defaultValue: 1.0,
      },
      {
        key: "BabyCuddleLoseImprintQualitySpeedMultiplier",
        section: GAME_MODE,
        label: "Lose Imprint Quality Speed",
        type: "float",
        min: 0,
        step: 0.1,
        description: "Rate of imprint loss on missed cuddles (0 = no loss)",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Harvesting & Resources",
    description: "Harvest amounts and resource respawn",
    fields: [
      {
        key: "HarvestAmountMultiplier",
        section: GAME_MODE,
        label: "Harvest Amount Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "HarvestHealthMultiplier",
        section: GAME_MODE,
        label: "Harvest Health Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "HP of harvestable resources",
        defaultValue: 1.0,
      },
      {
        key: "ResourcesRespawnPeriodMultiplier",
        section: GAME_MODE,
        label: "Resource Respawn Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = faster respawn",
        defaultValue: 1.0,
      },
      {
        key: "CropGrowthSpeedMultiplier",
        section: GAME_MODE,
        label: "Crop Growth Speed Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "FuelConsumptionIntervalMultiplier",
        section: GAME_MODE,
        label: "Fuel Consumption Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = fuel lasts longer",
        defaultValue: 1.0,
      },
      {
        key: "CustomRecipeEffectivenessMultiplier",
        section: GAME_MODE,
        label: "Custom Recipe Effectiveness",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Effectiveness of custom consumables",
        defaultValue: 1.0,
      },
      {
        key: "CustomRecipeSkillMultiplier",
        section: GAME_MODE,
        label: "Custom Recipe Skill Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Crafting skill effect on custom recipes",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Spoilage & Decomposition",
    description: "Item spoilage and corpse decomposition rates",
    fields: [
      {
        key: "GlobalSpoilingTimeMultiplier",
        section: GAME_MODE,
        label: "Global Spoiling Time Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = items spoil slower",
        defaultValue: 1.0,
      },
      {
        key: "GlobalItemDecompositionTimeMultiplier",
        section: GAME_MODE,
        label: "Item Decomposition Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = dropped items last longer",
        defaultValue: 1.0,
      },
      {
        key: "GlobalCorpseDecompositionTimeMultiplier",
        section: GAME_MODE,
        label: "Corpse Decomposition Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = corpses last longer",
        defaultValue: 1.0,
      },
      {
        key: "CropDecaySpeedMultiplier",
        section: GAME_MODE,
        label: "Crop Decay Speed Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = crops decay slower",
        defaultValue: 1.0,
      },
      {
        key: "PoopIntervalMultiplier",
        section: GAME_MODE,
        label: "Poop Interval Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more frequent (more fertilizer)",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Day/Night Cycle",
    description: "Day and night speed settings",
    fields: [
      {
        key: "DayCycleSpeedScale",
        section: GAME_MODE,
        label: "Day Cycle Speed",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "1.0 = default, higher = faster days",
        defaultValue: 1.0,
      },
      {
        key: "NightTimeSpeedScale",
        section: GAME_MODE,
        label: "Night Time Speed",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "1.0 = default, higher = shorter nights",
        defaultValue: 1.0,
      },
      {
        key: "DayTimeSpeedScale",
        section: GAME_MODE,
        label: "Day Time Speed",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Speed scale during the day portion",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Damage & Resistance",
    description: "Player, dino, and structure damage multipliers",
    fields: [
      {
        key: "PlayerDamageMultiplier",
        section: GAME_MODE,
        label: "Player Damage Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "DinoDamageMultiplier",
        section: GAME_MODE,
        label: "Dino Damage Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "StructureDamageMultiplier",
        section: GAME_MODE,
        label: "Structure Damage Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "PlayerResistanceMultiplier",
        section: GAME_MODE,
        label: "Player Resistance Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more resistant",
        defaultValue: 1.0,
      },
      {
        key: "DinoResistanceMultiplier",
        section: GAME_MODE,
        label: "Dino Resistance Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more resistant",
        defaultValue: 1.0,
      },
      {
        key: "StructureResistanceMultiplier",
        section: GAME_MODE,
        label: "Structure Resistance Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more resistant",
        defaultValue: 1.0,
      },
      {
        key: "TamedDinoDamageMultiplier",
        section: GAME_MODE,
        label: "Tamed Dino Damage Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        defaultValue: 1.0,
      },
      {
        key: "TamedDinoResistanceMultiplier",
        section: GAME_MODE,
        label: "Tamed Dino Resistance Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = more resistant",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Player Stats",
    description: "Player food, water, stamina, and stat drain rates",
    fields: [
      {
        key: "PlayerCharacterFoodDrainMultiplier",
        section: GAME_MODE,
        label: "Food Drain Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = less food consumed",
        defaultValue: 1.0,
      },
      {
        key: "PlayerCharacterWaterDrainMultiplier",
        section: GAME_MODE,
        label: "Water Drain Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = less water consumed",
        defaultValue: 1.0,
      },
      {
        key: "PlayerCharacterStaminaDrainMultiplier",
        section: GAME_MODE,
        label: "Stamina Drain Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = less stamina consumed",
        defaultValue: 1.0,
      },
      {
        key: "PlayerCharacterHealthRecoveryMultiplier",
        section: GAME_MODE,
        label: "Health Recovery Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = faster health regen",
        defaultValue: 1.0,
      },
      {
        key: "DinoCharacterFoodDrainMultiplier",
        section: GAME_MODE,
        label: "Dino Food Drain Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = tamed dinos eat less",
        defaultValue: 1.0,
      },
      {
        key: "DinoCharacterStaminaDrainMultiplier",
        section: GAME_MODE,
        label: "Dino Stamina Drain Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Lower = dinos use less stamina",
        defaultValue: 1.0,
      },
      {
        key: "DinoCharacterHealthRecoveryMultiplier",
        section: GAME_MODE,
        label: "Dino Health Recovery Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Higher = faster dino health regen",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Wild Dinos",
    description: "Wild dinosaur population settings",
    fields: [
      {
        key: "DinoCountMultiplier",
        section: GAME_MODE,
        label: "Dino Count Multiplier",
        type: "float",
        min: 0.1,
        step: 0.1,
        description: "Wild dino spawn density",
        defaultValue: 1.0,
      },
    ],
  },
  {
    title: "Tribe Settings",
    description: "Tribe and alliance limits",
    fields: [
      {
        key: "MaxNumberOfPlayersInTribe",
        section: GAME_MODE,
        label: "Max Players in Tribe",
        type: "number",
        min: 0,
        description: "0 = unlimited",
        defaultValue: 0,
      },
      {
        key: "MaxAlliancesPerTribe",
        section: GAME_MODE,
        label: "Max Alliances per Tribe",
        type: "number",
        min: 0,
        defaultValue: 10,
      },
      {
        key: "MaxTribesPerAlliance",
        section: GAME_MODE,
        label: "Max Tribes per Alliance",
        type: "number",
        min: 0,
        defaultValue: 10,
      },
      {
        key: "MaxTribeLogs",
        section: GAME_MODE,
        label: "Max Tribe Log Entries",
        type: "number",
        min: 0,
        defaultValue: 100,
      },
    ],
  },
  {
    title: "PvP / PvE Settings",
    description: "PvP and PvE specific gameplay options",
    fields: [
      {
        key: "bPvPDinoDecay",
        section: GAME_MODE,
        label: "PvP Dino Decay",
        type: "boolean",
        description: "Unclaimed dinos auto-decay in PvP",
        defaultValue: "True",
      },
      {
        key: "bPvPStructureDecay",
        section: GAME_MODE,
        label: "PvP Structure Decay",
        type: "boolean",
        description: "Structures auto-decay in PvP",
        defaultValue: "True",
      },
      {
        key: "bDisableFriendlyFire",
        section: GAME_MODE,
        label: "Disable Friendly Fire",
        type: "boolean",
        defaultValue: "False",
      },
      {
        key: "bAllowFlyerCarryPvE",
        section: GAME_MODE,
        label: "Allow Flyer Carry (PvE)",
        type: "boolean",
        description: "Flyers can carry wild dinos in PvE",
        defaultValue: "False",
      },
      {
        key: "bIncreasePvPRespawnInterval",
        section: GAME_MODE,
        label: "Increase PvP Respawn Interval",
        type: "boolean",
        description: "Progressively longer respawn in PvP",
        defaultValue: "False",
      },
      {
        key: "IncreasePvPRespawnIntervalBaseAmount",
        section: GAME_MODE,
        label: "PvP Respawn Interval Base (seconds)",
        type: "float",
        min: 0,
        step: 5,
        description: "Base respawn time penalty per death",
        defaultValue: 60,
      },
    ],
  },
];

// ── Parse / Generate ───────────────────────────────────────────────

type ArkConfig = Record<string, string | number>;

function parseConfig(
  content: string,
  sections: SectionDef[],
  showDefaults?: boolean,
): ArkConfig {
  const config: ArkConfig = {};
  for (const section of sections) {
    for (const field of section.fields) {
      const raw = getIniValue(content, field.section, field.key);
      if (raw !== null) {
        switch (field.type) {
          case "number":
            config[field.key] = parseInt(raw, 10) || 0;
            break;
          case "float":
            config[field.key] = parseFloat(raw) || 0;
            break;
          default:
            config[field.key] = raw;
        }
      } else if (showDefaults && field.defaultValue !== undefined) {
        config[field.key] = field.defaultValue;
      }
    }
  }
  return config;
}

function generateConfig(
  config: ArkConfig,
  originalContent: string,
  sections: SectionDef[],
): string {
  let content = originalContent;
  for (const section of sections) {
    for (const field of section.fields) {
      if (!(field.key in config)) continue;
      // For fields with defaults: only write if the field already exists in
      // the original content OR the value has been changed from the default.
      // This prevents flooding the file with default values.
      if (field.defaultValue !== undefined) {
        const existsInOriginal = hasIniKey(
          originalContent,
          field.section,
          field.key,
        );
        if (
          !existsInOriginal &&
          String(config[field.key]) === String(field.defaultValue)
        ) {
          continue;
        }
      }
      content = setIniValue(
        content,
        field.section,
        field.key,
        String(config[field.key]),
      );
    }
  }
  return content;
}

// ── Generic Field Renderer ─────────────────────────────────────────

function renderField(
  field: FieldDef,
  config: ArkConfig,
  handleChange: (key: string, value: string | number) => void,
) {
  if (!(field.key in config)) return null;

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
            onChange={(e) => {
              let v = e.target.value;
              if (field.sanitizePattern) {
                v = v.replace(field.sanitizePattern, "");
              }
              handleChange(field.key, v);
            }}
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

    case "float":
      return (
        <div className={colClass} key={field.key}>
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 0.1}
            value={Number(value)}
            onChange={(e) =>
              handleChange(field.key, parseFloat(e.target.value) || 0)
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
              <SelectItem value="True">Enabled</SelectItem>
              <SelectItem value="False">Disabled</SelectItem>
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
            onValueChange={(val) => handleChange(field.key, val)}
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

// ── Component ──────────────────────────────────────────────────────

interface ArkConfigEditorProps {
  rawContent: string;
  originalContent: string;
  onContentChange: (content: string) => void;
  fileName?: string;
  initialMode?: boolean;
  serverId?: number;
  launchParams?: string;
  onLaunchParamsChange?: () => void;
  serverName?: string;
}

/** Extract a ?Key=Value from UE4-style launch params */
function getLaunchParam(params: string, key: string): string | null {
  const regex = new RegExp(`[?]${key}=([^?\\s]*)`, "i");
  const m = params.match(regex);
  return m ? m[1] : null;
}

/** Initial settings form shown before ARK generates its config files */
function ArkInitialSettings({
  serverId,
  launchParams,
  onLaunchParamsChange,
  serverName,
}: {
  serverId: number;
  launchParams?: string;
  onLaunchParamsChange?: () => void;
  serverName?: string;
}) {
  const { api } = useBackend();
  const [saving, setSaving] = useState(false);

  // Pre-populate from existing launch params (if the user saved before)
  // Fall back to sanitized server name so the initial session name is valid
  const lp = launchParams || "";
  const [sessionName, setSessionName] = useState(() => {
    const raw = getLaunchParam(lp, "SessionName");
    // Resolve {SERVER_NAME} placeholder or missing value to sanitized server name
    if (!raw || raw === "{SERVER_NAME}") {
      return (serverName || "ARK-Server").replace(/[^a-zA-Z0-9_-]/g, "_");
    }
    return raw;
  });
  const [adminPassword, setAdminPassword] = useState(
    () => getLaunchParam(lp, "ServerAdminPassword") || "",
  );
  const [serverPassword, setServerPassword] = useState(
    () => getLaunchParam(lp, "ServerPassword") || "",
  );
  const [maxPlayers, setMaxPlayers] = useState(
    () => Number(getLaunchParam(lp, "MaxPlayers")) || 70,
  );
  const savedMap = lp ? getMapFromLaunchParams(lp) : "TheIsland";
  const savedIsKnown = ARK_MAPS.some((m) => m.value === savedMap);
  const [map, setMap] = useState(savedIsKnown ? savedMap : "__custom");
  const [customMap, setCustomMap] = useState(savedIsKnown ? "" : savedMap);

  const effectiveMap = map === "__custom" ? customMap : map;

  async function handleSave() {
    if (!adminPassword) {
      toastError("Admin password is required");
      return;
    }
    if (/[^a-zA-Z0-9_-]/.test(sessionName)) {
      toastError(
        "Session name may only contain letters, digits, hyphens and underscores",
      );
      return;
    }
    setSaving(true);
    try {
      await api.servers.saveInitialSettings(serverId, {
        sessionName,
        adminPassword,
        serverPassword: serverPassword || undefined,
        maxPlayers,
        map: effectiveMap || undefined,
      });
      toastSuccess("Initial settings saved. Start the server to apply them.");
      onLaunchParamsChange?.();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-base font-semibold">Initial Server Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure the basic server settings before the first start. ARK will
          generate its full configuration files during the first launch.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="map">Map</Label>
          <Select
            value={map}
            onValueChange={(v) => {
              setMap(v);
              if (v !== "__custom") setCustomMap("");
            }}
          >
            <SelectTrigger id="map">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARK_MAPS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
              <SelectItem value="__custom">Custom Map...</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The map the server runs on
          </p>
        </div>
        {map === "__custom" && (
          <div className="space-y-2">
            <Label htmlFor="customMap">Custom Map Name</Label>
            <Input
              id="customMap"
              value={customMap}
              onChange={(e) => setCustomMap(e.target.value)}
              placeholder="e.g. Mod_MapName"
            />
            <p className="text-xs text-muted-foreground">
              Enter the exact map name (e.g. from a mod)
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="sessionName">Session Name</Label>
          <Input
            id="sessionName"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="ARK-Server-1"
          />
          {/[^a-zA-Z0-9_-]/.test(sessionName) && (
            <p className="text-xs text-destructive font-medium">
              Only letters, digits, hyphens and underscores allowed
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The name displayed in the server browser
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="adminPassword">Admin Password *</Label>
          <Input
            id="adminPassword"
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="Required"
          />
          <p className="text-xs text-muted-foreground">
            Password for in-game admin access (required)
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="serverPassword">Server Password</Label>
          <Input
            id="serverPassword"
            type="password"
            value={serverPassword}
            onChange={(e) => setServerPassword(e.target.value)}
            placeholder="Optional"
          />
          <p className="text-xs text-muted-foreground">
            Password required to join the server (leave empty for public)
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxPlayers">Max Players</Label>
          <Input
            id="maxPlayers"
            type="number"
            min={1}
            max={500}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Maximum number of concurrent players (default: 70)
          </p>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            <FaFloppyDisk className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Initial Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Map selector for the full config editor (reads/writes launch params) */
function ArkMapSelector({
  serverId,
  launchParams,
  onLaunchParamsChange,
}: {
  serverId: number;
  launchParams: string;
  onLaunchParamsChange?: () => void;
}) {
  const { api } = useBackend();
  const currentMap = getMapFromLaunchParams(launchParams);
  const isKnownMap = ARK_MAPS.some((m) => m.value === currentMap);
  const [selectedMap, setSelectedMap] = useState(
    isKnownMap ? currentMap : "__custom",
  );
  const [customMap, setCustomMap] = useState(isKnownMap ? "" : currentMap);
  const [saving, setSaving] = useState(false);

  const effectiveMap = selectedMap === "__custom" ? customMap : selectedMap;
  const hasChanged = effectiveMap !== currentMap;

  async function handleSave() {
    if (!effectiveMap.trim()) return;
    setSaving(true);
    try {
      await api.servers.saveInitialSettings(serverId, { map: effectiveMap });
      toastSuccess(`Map changed to ${effectiveMap}`);
      onLaunchParamsChange?.();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold">Server Map</h3>
        <p className="text-sm text-muted-foreground">
          Select the map for this server. Changes require a server restart.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mapSelect">Map</Label>
          <Select
            value={selectedMap}
            onValueChange={(v) => {
              setSelectedMap(v);
              if (v !== "__custom") setCustomMap("");
            }}
          >
            <SelectTrigger id="mapSelect">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARK_MAPS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
              <SelectItem value="__custom">Custom Map...</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selectedMap === "__custom" && (
          <div className="space-y-2">
            <Label htmlFor="customMapFull">Custom Map Name</Label>
            <Input
              id="customMapFull"
              value={customMap}
              onChange={(e) => setCustomMap(e.target.value)}
              placeholder="e.g. Mod_MapName"
            />
          </div>
        )}
        <div className="md:col-span-2 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanged || !effectiveMap.trim()}
          >
            <FaFloppyDisk className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save Map"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ArkConfigEditor({
  rawContent,
  originalContent,
  onContentChange,
  fileName,
  initialMode,
  serverId,
  launchParams,
  onLaunchParamsChange,
  serverName,
}: ArkConfigEditorProps) {
  // Initial mode: show simplified form before first start
  if (initialMode && serverId) {
    return (
      <ArkInitialSettings
        serverId={serverId}
        launchParams={launchParams}
        onLaunchParamsChange={onLaunchParamsChange}
        serverName={serverName}
      />
    );
  }
  // Choose sections based on which config file is being edited
  const isGameIni = fileName?.toLowerCase() === "game.ini";
  const isGus = fileName?.toLowerCase() === "gameusersettings.ini" || !fileName;
  const sections = isGameIni ? GAME_INI_SECTIONS : GUS_SECTIONS;

  // For Game.ini: show all fields with defaults since the file is purely additive
  const config = parseConfig(rawContent, sections, isGameIni);

  function handleChange(key: string, value: string | number) {
    const newConfig = { ...config, [key]: value };
    onContentChange(generateConfig(newConfig, originalContent, sections));
  }

  // For GUS: only show sections that have at least one existing key
  // For Game.ini: show all sections (fields use defaults when not in file)
  const visibleSections = isGameIni
    ? sections
    : sections.filter((section) =>
        section.fields.some((field) =>
          hasIniKey(rawContent, field.section, field.key),
        ),
      );

  return (
    <div className="divide-y">
      {/* Map selector — only shown on GameUserSettings.ini tab */}
      {isGus && serverId && launchParams && (
        <ArkMapSelector
          serverId={serverId}
          launchParams={launchParams}
          onLaunchParamsChange={onLaunchParamsChange}
        />
      )}
      {visibleSections.length === 0 && (
        <div className="py-6 text-center text-muted-foreground">
          No configuration fields found. Use the Raw Editor tab to view and edit
          the file directly.
        </div>
      )}
      {visibleSections.map((section) => {
        const renderedFields = section.fields
          .map((field) => renderField(field, config, handleChange))
          .filter(Boolean);

        if (renderedFields.length === 0) return null;

        return (
          <div key={section.title} className="py-6">
            <div className="mb-4">
              <h3 className="text-base font-semibold">{section.title}</h3>
              <p className="text-sm text-muted-foreground">
                {section.description}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">{renderedFields}</div>
          </div>
        );
      })}
    </div>
  );
}
