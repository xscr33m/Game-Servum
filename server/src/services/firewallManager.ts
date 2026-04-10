/**
 * Firewall Manager — Manages Windows Firewall rules for game servers
 *
 * Creates/removes inbound port rules + executable program rules via
 * `netsh advfirewall firewall` commands. All operations are no-ops on
 * non-Windows platforms (dev environments).
 *
 * Rule naming convention: "Game-Servum - {ServerName} ({Description})"
 * Executable rule: "Game-Servum - {ServerName} (Program)"
 */

import { execFile } from "child_process";
import path from "path";
import { logger } from "../core/logger.js";
import { getGameDefinition } from "../games/index.js";
import type {
  FirewallRuleDefinition,
  FirewallStatus,
  FirewallRuleStatus,
  FirewallResult,
} from "@game-servum/shared";

const RULE_PREFIX = "Game-Servum";

interface ServerInfo {
  name: string;
  port: number;
  installPath: string;
  executable: string;
  gameId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateRuleName(serverName: string, description: string): string {
  return `${RULE_PREFIX} - ${serverName} (${description})`;
}

function generateExeRuleName(serverName: string): string {
  return `${RULE_PREFIX} - ${serverName} (Program)`;
}

/**
 * Build a port range string from base port + rule definition.
 * Examples: "2302-2305" for offset=0,count=4 or "27016" for offset=24714,count=1
 */
function buildPortRange(
  basePort: number,
  rule: FirewallRuleDefinition,
): string {
  const start = basePort + rule.portOffset;
  if (rule.portCount <= 1) return start.toString();
  return `${start}-${start + rule.portCount - 1}`;
}

/**
 * Execute a netsh command and return stdout. Rejects on error.
 */
function runNetsh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("netsh", args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Check if a specific firewall rule name exists.
 */
async function ruleExists(ruleName: string): Promise<boolean> {
  try {
    const output = await runNetsh([
      "advfirewall",
      "firewall",
      "show",
      "rule",
      `name=${ruleName}`,
    ]);
    // If a rule is found, output contains "Rule Name:" line
    return output.includes("Rule Name:");
  } catch {
    // netsh returns error code 1 when no rule is found
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Check which firewall rules exist for a server.
 */
export async function checkFirewallRules(
  server: ServerInfo,
): Promise<FirewallStatus> {
  const gameDef = getGameDefinition(server.gameId);
  const firewallDefs = gameDef?.firewallRules ?? [];

  if (process.platform !== "win32") {
    // Non-Windows: report all rules as "not present" so UI shows correct state
    const rules: FirewallRuleStatus[] = firewallDefs.map((rule) => ({
      name: generateRuleName(server.name, rule.description),
      exists: false,
      protocol: rule.protocol,
      ports: buildPortRange(server.port, rule),
      description: rule.description,
    }));
    return {
      rules,
      allPresent: false,
      executableRule: {
        name: generateExeRuleName(server.name),
        exists: false,
      },
    };
  }

  const rules: FirewallRuleStatus[] = [];

  for (const rule of firewallDefs) {
    // For TCP/UDP rules, we need two separate Windows Firewall rules
    const protocols =
      rule.protocol === "TCP/UDP" ? ["TCP", "UDP"] : [rule.protocol];

    for (const proto of protocols) {
      const ruleName = generateRuleName(
        server.name,
        `${rule.description} ${proto}`,
      );
      const exists = await ruleExists(ruleName);
      rules.push({
        name: ruleName,
        exists,
        protocol: proto,
        ports: buildPortRange(server.port, rule),
        description: rule.description,
      });
    }
  }

  // Check executable rule
  const exeRuleName = generateExeRuleName(server.name);
  const exeExists = await ruleExists(exeRuleName);

  const allPresent = rules.every((r) => r.exists) && exeExists;

  return {
    rules,
    allPresent,
    executableRule: {
      name: exeRuleName,
      exists: exeExists,
    },
  };
}

/**
 * Add all firewall rules for a server. Skips rules that already exist.
 */
export async function addFirewallRules(
  server: ServerInfo,
): Promise<FirewallResult> {
  if (process.platform !== "win32") {
    logger.info("[Firewall] Skipping firewall rules (non-Windows platform)");
    return { success: true, message: "Skipped (non-Windows)", errors: [] };
  }

  const gameDef = getGameDefinition(server.gameId);
  const firewallDefs = gameDef?.firewallRules ?? [];

  if (firewallDefs.length === 0) {
    return {
      success: true,
      message: "No firewall rules defined for this game",
      errors: [],
    };
  }

  const errors: string[] = [];
  let rulesCreated = 0;

  // Add port-based rules
  for (const rule of firewallDefs) {
    const portRange = buildPortRange(server.port, rule);
    const protocols =
      rule.protocol === "TCP/UDP" ? ["TCP", "UDP"] : [rule.protocol];

    for (const proto of protocols) {
      const ruleName = generateRuleName(
        server.name,
        `${rule.description} ${proto}`,
      );

      try {
        // Check if rule already exists
        if (await ruleExists(ruleName)) {
          logger.info(`[Firewall] Rule already exists: ${ruleName}`);
          continue;
        }

        await runNetsh([
          "advfirewall",
          "firewall",
          "add",
          "rule",
          `name=${ruleName}`,
          "dir=in",
          "action=allow",
          `protocol=${proto}`,
          `localport=${portRange}`,
        ]);
        rulesCreated++;
        logger.info(
          `[Firewall] Created rule: ${ruleName} (${proto} ${portRange})`,
        );
      } catch (err) {
        const msg = `Failed to create rule "${ruleName}": ${(err as Error).message}`;
        logger.error(`[Firewall] ${msg}`);
        errors.push(msg);
      }
    }
  }

  // Add executable/program rule
  const exeRuleName = generateExeRuleName(server.name);
  const exePath = path.join(server.installPath, server.executable);

  try {
    if (await ruleExists(exeRuleName)) {
      logger.info(`[Firewall] Executable rule already exists: ${exeRuleName}`);
    } else {
      await runNetsh([
        "advfirewall",
        "firewall",
        "add",
        "rule",
        `name=${exeRuleName}`,
        "dir=in",
        "action=allow",
        `program=${exePath}`,
        "enable=yes",
      ]);
      rulesCreated++;
      logger.info(`[Firewall] Created executable rule: ${exeRuleName}`);
    }
  } catch (err) {
    const msg = `Failed to create executable rule "${exeRuleName}": ${(err as Error).message}`;
    logger.error(`[Firewall] ${msg}`);
    errors.push(msg);
  }

  const success = errors.length === 0;
  return {
    success,
    message: success
      ? `${rulesCreated} firewall rule(s) created`
      : `Created ${rulesCreated} rule(s) with ${errors.length} error(s)`,
    rulesCreated,
    errors,
  };
}

/**
 * Remove all firewall rules for a server.
 */
export async function removeFirewallRules(
  serverName: string,
  gameId: string,
  _port: number,
): Promise<FirewallResult> {
  if (process.platform !== "win32") {
    logger.info(
      "[Firewall] Skipping firewall rule removal (non-Windows platform)",
    );
    return { success: true, message: "Skipped (non-Windows)", errors: [] };
  }

  const gameDef = getGameDefinition(gameId);
  const firewallDefs = gameDef?.firewallRules ?? [];

  const errors: string[] = [];
  let rulesRemoved = 0;

  // Remove port-based rules
  for (const rule of firewallDefs) {
    const protocols =
      rule.protocol === "TCP/UDP" ? ["TCP", "UDP"] : [rule.protocol];

    for (const proto of protocols) {
      const ruleName = generateRuleName(
        serverName,
        `${rule.description} ${proto}`,
      );

      try {
        await runNetsh([
          "advfirewall",
          "firewall",
          "delete",
          "rule",
          `name=${ruleName}`,
        ]);
        rulesRemoved++;
        logger.info(`[Firewall] Removed rule: ${ruleName}`);
      } catch {
        // Rule may not exist — not an error during cleanup
        logger.info(
          `[Firewall] Rule not found (already removed?): ${ruleName}`,
        );
      }
    }
  }

  // Remove executable rule
  const exeRuleName = generateExeRuleName(serverName);
  try {
    await runNetsh([
      "advfirewall",
      "firewall",
      "delete",
      "rule",
      `name=${exeRuleName}`,
    ]);
    rulesRemoved++;
    logger.info(`[Firewall] Removed executable rule: ${exeRuleName}`);
  } catch {
    logger.info(
      `[Firewall] Executable rule not found (already removed?): ${exeRuleName}`,
    );
  }

  return {
    success: true,
    message: `${rulesRemoved} firewall rule(s) removed`,
    rulesRemoved,
    errors,
  };
}

/**
 * Update firewall rules when server name or ports change.
 * Removes old rules, then adds new ones.
 */
export async function updateFirewallRules(
  oldServer: ServerInfo,
  newServer: ServerInfo,
): Promise<FirewallResult> {
  if (process.platform !== "win32") {
    return { success: true, message: "Skipped (non-Windows)", errors: [] };
  }

  // Remove old rules
  const removeResult = await removeFirewallRules(
    oldServer.name,
    oldServer.gameId,
    oldServer.port,
  );

  // Add new rules
  const addResult = await addFirewallRules(newServer);

  const errors = [...removeResult.errors, ...addResult.errors];
  const success = errors.length === 0;

  return {
    success,
    message: success
      ? `Firewall rules updated (${removeResult.rulesRemoved ?? 0} removed, ${addResult.rulesCreated ?? 0} created)`
      : `Updated with ${errors.length} error(s)`,
    rulesRemoved: removeResult.rulesRemoved,
    rulesCreated: addResult.rulesCreated,
    errors,
  };
}
