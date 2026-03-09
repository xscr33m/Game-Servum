/**
 * Game Definitions - Central registry for all supported game servers
 *
 * Each game definition includes:
 * - Basic info (name, appId, executable)
 * - Default configuration (ports, launch params)
 * - Post-install hooks for initial setup
 * - Whether login is required (some servers need Steam account)
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { logger } from "../index.js";
import type {
  FirewallRuleDefinition,
  GameCapabilities,
} from "@game-servum/shared";

export interface GameDefinition {
  id: string; // Unique identifier (e.g., "dayz", "7dtd")
  name: string; // Display name
  appId: number; // Steam App ID for server installation
  workshopAppId?: number; // Steam App ID for Workshop mods (if different from appId, e.g. DayZ game=221100 vs server=223350)
  executable: string; // Server executable name
  defaultPort: number; // Default game port
  portCount: number; // Number of consecutive ports used starting from base port (e.g. DayZ uses 5: game[4] + RCON[1])
  portStride?: number; // Increment between server instances (e.g. DayZ uses 100: 2302, 2402, 2502...). Defaults to portCount.
  queryPort?: number; // Default Steam query port
  queryPortOffset?: number; // Query port = base port + offset (for auto-calculation when base port changes)
  requiresLogin: boolean; // Whether Steam login is required
  defaultLaunchParams: string; // Default launch parameters
  description: string; // Brief description
  configFiles?: string[]; // Important config files to note
  firewallRules?: FirewallRuleDefinition[]; // Port/protocol rules for Windows Firewall
  capabilities: GameCapabilities; // Feature flags for this game
  broadcastCommand?: string; // RCON command template to broadcast a message (use {MESSAGE} placeholder)
  playerListCommand?: string; // RCON command to list players
  rconPortOffset?: number; // RCON port = base port + offset (for auto-calculation)
  postInstall?: (
    installPath: string,
    serverName: string,
    port: number,
  ) => Promise<void>; // Post-install hook
}

// Helper to create directories
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Helper to create a file with content
function createFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf-8");
}

// Helper to set an XML property value: <property name="Key" value="Value"/>
function setXmlProperty(content: string, name: string, value: string): string {
  const regex = new RegExp(
    `(<property\\s+name\\s*=\\s*"${name}"\\s+value\\s*=\\s*")[^"]*"`,
    "i",
  );
  if (regex.test(content)) {
    return content.replace(regex, `$1${value}"`);
  }
  return content;
}

// Helper to generate a secure random password
function generatePassword(length: number = 16): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

/**
 * DayZ Server Post-Install Configuration
 *
 * Modifies the auto-generated serverDZ.cfg to set:
 * - hostname to the user-chosen server name
 * - description to include Game-Servum branding
 *
 * Also creates:
 * - profiles folder for server data
 * - BattlEye configuration
 */
async function dayZPostInstall(
  installPath: string,
  serverName: string,
  port: number,
): Promise<void> {
  logger.info(`[DayZ] Running post-install for ${serverName}...`);

  // Create profiles directory (needed for logs and BattlEye)
  const profilesPath = path.join(installPath, "profiles");
  ensureDir(profilesPath);
  logger.info(`[DayZ] Created profiles directory: ${profilesPath}`);

  // Modify serverDZ.cfg to set hostname and description
  const configPath = path.join(installPath, "serverDZ.cfg");
  if (fs.existsSync(configPath)) {
    let configContent = fs.readFileSync(configPath, "utf-8");

    // Update hostname
    configContent = configContent.replace(
      /^hostname\s*=\s*"[^"]*";/m,
      `hostname = "${serverName}";`,
    );

    // Update description
    configContent = configContent.replace(
      /^description\s*=\s*"[^"]*";/m,
      `description = "**Managed by Game-Servum**";`,
    );

    // Update Admin Password
    configContent = configContent.replace(
      /^passwordAdmin\s*=\s*"[^"]*";/m,
      `passwordAdmin = "${generatePassword(20)}";`,
    );

    fs.writeFileSync(configPath, configContent, "utf-8");
    logger.info(`[DayZ] Updated serverDZ.cfg with hostname: ${serverName}`);
  } else {
    logger.info(
      `[DayZ] Warning: serverDZ.cfg not found, will be created on first server start`,
    );
  }

  // Create BattlEye directory and config if it doesn't exist
  // BattlEye is required for DayZ servers
  const battleEyePath = path.join(profilesPath, "BattlEye");
  ensureDir(battleEyePath);

  const beServerCfgPath = path.join(battleEyePath, "BEServer_x64.cfg");
  if (!fs.existsSync(beServerCfgPath)) {
    const rconPassword = generatePassword(20);
    const rconPort = port + 4; // RCON port = base port + rconPortOffset (4)
    const beConfig = `RConPassword ${rconPassword}
RConPort ${rconPort}
RestrictRCon 0
`;
    createFile(beServerCfgPath, beConfig);
    logger.info(`[DayZ] Created BattlEye config with secure RCon password`);
  }

  logger.info(`[DayZ] Post-install complete for ${serverName}`);
}

/**
 * 7 Days to Die Post-Install Configuration
 */
async function sevenDaysPostInstall(
  installPath: string,
  serverName: string,
  port: number,
): Promise<void> {
  logger.info(`[7DTD] Running post-install for ${serverName}...`);

  // Prepare data folder
  const dataPath = path.join(installPath, "Data");
  ensureDir(dataPath);

  // Patch serverconfig.xml with server name, port, and Telnet settings
  const configPath = path.join(installPath, "serverconfig.xml");
  if (fs.existsSync(configPath)) {
    try {
      let content = fs.readFileSync(configPath, "utf-8");
      content = setXmlProperty(content, "ServerName", serverName);
      content = setXmlProperty(
        content,
        "ServerDescription",
        `${serverName} - powered by Game Servum`,
      );

      // Set game server port to the user-chosen port
      content = setXmlProperty(content, "ServerPort", String(port));

      // Generate secure Telnet password so Game-Servum can connect via RCON
      const telnetPassword = generatePassword(20);
      content = setXmlProperty(content, "TelnetPassword", telnetPassword);

      fs.writeFileSync(configPath, content, "utf-8");
      logger.info(
        `[7DTD] Updated serverconfig.xml: ServerName, ServerPort=${port}, TelnetPassword set`,
      );
    } catch (err) {
      logger.error(`[7DTD] Failed to patch serverconfig.xml:`, err);
    }
  } else {
    logger.warn(
      `[7DTD] serverconfig.xml not found at ${configPath}, skipping config patch`,
    );
  }

  logger.info(`[7DTD] Post-install complete for ${serverName}`);
}

/**
 * ARK Post-Install Configuration
 */
async function arkPostInstall(
  installPath: string,
  serverName: string,
  _port: number,
): Promise<void> {
  logger.info(`[ARK] Running post-install for ${serverName}...`);

  // ARK needs ShooterGame/Saved directory
  const savedPath = path.join(
    installPath,
    "ShooterGame",
    "Saved",
    "Config",
    "WindowsServer",
  );
  ensureDir(savedPath);

  logger.info(`[ARK] Post-install complete for ${serverName}`);
}

/**
 * Game Definitions Registry
 */
export const GAME_DEFINITIONS: Record<string, GameDefinition> = {
  dayz: {
    id: "dayz",
    name: "DayZ",
    appId: 223350,
    workshopAppId: 221100, // Workshop mods are under the game AppID, not the server
    executable: "DayZServer_x64.exe",
    defaultPort: 2302,
    portCount: 5, // Ports 2302-2306: game (4 ports) + RCON (1 port)
    portStride: 100, // Next server at 2402, 2502, etc. (DayZ convention)
    queryPort: 27016, // Steam Query port (auto-managed: gamePort + 24714)
    queryPortOffset: 24714,
    requiresLogin: true,
    defaultLaunchParams:
      "-config=serverDZ.cfg -port={PORT} -profiles={PROFILES} -doLogs -adminLog -netLog -freezeCheck",
    description:
      "Post-apocalyptic survival game. Requires Steam login to download.",
    configFiles: ["serverDZ.cfg", "profiles/"],
    firewallRules: [
      { portOffset: 0, portCount: 4, protocol: "UDP", description: "Game" },
      { portOffset: 4, portCount: 1, protocol: "UDP", description: "RCON" },
      {
        portOffset: 24714,
        portCount: 1,
        protocol: "UDP",
        description: "Steam Query",
      },
    ],
    capabilities: {
      rcon: "battleye",
      workshopMods: true,
      configEditor: true,
      playerTracking: true,
      scheduledMessages: true,
      whitelist: "file",
      banList: "file",
      logParsing: true,
    },
    broadcastCommand: "say -1 {MESSAGE}",
    playerListCommand: "players",
    rconPortOffset: 4,
    postInstall: dayZPostInstall,
  },

  "7dtd": {
    id: "7dtd",
    name: "7 Days to Die",
    appId: 294420,
    executable: "7DaysToDieServer.exe",
    defaultPort: 26900,
    portCount: 4, // Game port (26900) + network traffic (26901-26903)
    queryPort: 26901,
    queryPortOffset: 1,
    requiresLogin: false,
    defaultLaunchParams:
      '-configfile=serverconfig.xml -logfile "output_log.txt" -quit -batchmode -nographics -dedicated',
    description:
      "Zombie survival with base building. Can be downloaded anonymously.",
    configFiles: ["serverconfig.xml"],
    firewallRules: [
      {
        portOffset: 0,
        portCount: 4,
        protocol: "TCP/UDP",
        description: "Game + Network",
      },
    ],
    capabilities: {
      rcon: "telnet",
      workshopMods: false,
      configEditor: true,
      playerTracking: true,
      scheduledMessages: true,
      whitelist: false,
      banList: false,
      logParsing: false,
    },
    broadcastCommand: 'say "{MESSAGE}"',
    playerListCommand: "listplayers",
    rconPortOffset: undefined, // RCON port configured in serverconfig.xml (TelnetPort, default 8081)
    postInstall: sevenDaysPostInstall,
  },

  ark: {
    id: "ark",
    name: "ARK: Survival Evolved",
    appId: 376030,
    executable: "ShooterGameServer.exe",
    defaultPort: 7777,
    portCount: 2, // Game port + Raw UDP (7777-7778)
    queryPort: 27015,
    queryPortOffset: 19238, // 27015 - 7777
    requiresLogin: false,
    defaultLaunchParams:
      "TheIsland?listen?SessionName=MyARKServer -server -log",
    description: "Dinosaur survival game. Can be downloaded anonymously.",
    configFiles: [
      "ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini",
    ],
    firewallRules: [
      {
        portOffset: 0,
        portCount: 2,
        protocol: "UDP",
        description: "Game + Peer",
      },
      {
        portOffset: 19238,
        portCount: 1,
        protocol: "UDP",
        description: "Steam Query",
      },
      { portOffset: 19243, portCount: 1, protocol: "TCP", description: "RCON" },
    ],
    capabilities: {
      rcon: "source",
      workshopMods: true,
      configEditor: true,
      playerTracking: true,
      scheduledMessages: true,
      whitelist: false,
      banList: false,
      logParsing: false,
    },
    broadcastCommand: "ServerChat {MESSAGE}",
    playerListCommand: "ListPlayers",
    rconPortOffset: 19243, // Default RCON port 27020 = 7777 + 19243
    postInstall: arkPostInstall,
  },
};

/**
 * Get a game definition by its ID
 */
export function getGameDefinition(gameId: string): GameDefinition | undefined {
  return GAME_DEFINITIONS[gameId];
}

/**
 * Get a game definition by Steam App ID
 */
export function getGameDefinitionByAppId(
  appId: number,
): GameDefinition | undefined {
  return Object.values(GAME_DEFINITIONS).find((game) => game.appId === appId);
}

/**
 * Get all available game definitions
 */
export function getAllGameDefinitions(): GameDefinition[] {
  return Object.values(GAME_DEFINITIONS);
}

/**
 * Run post-install hook for a game if it exists
 */
export async function runPostInstall(
  gameId: string,
  installPath: string,
  serverName: string,
  port: number,
): Promise<void> {
  const game = getGameDefinition(gameId);
  if (game?.postInstall) {
    await game.postInstall(installPath, serverName, port);
  }
}
