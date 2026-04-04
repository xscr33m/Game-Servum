import { execFileSync } from "child_process";
import { logger } from "../core/logger.js";

const SERVICE_NAME = "GameServumAgent";

/**
 * Check if agent service auto-start is enabled.
 * Queries the Windows Service start type via `sc qc`.
 * AUTO_START (2) = enabled, DEMAND_START (3) = manual.
 * @returns True if service start type is automatic, false otherwise
 */
export function getAutoStartEnabled(): boolean {
  if (process.platform !== "win32") return false;

  try {
    const result = execFileSync("sc", ["qc", SERVICE_NAME], {
      encoding: "utf-8",
      windowsHide: true,
    });
    // SC output contains "START_TYPE : 2 AUTO_START" or "START_TYPE : 2 AUTO_START (DELAYED)"
    return /START_TYPE\s*:\s*2/.test(result);
  } catch {
    logger.info(
      "[AgentSettings] Could not query service start type (service may not be installed)",
    );
    return false;
  }
}

/**
 * Enable or disable agent service auto-start.
 * Sets the Windows Service start type via `sc config`.
 * @param enable - True for automatic start, false for manual (demand)
 * @throws Error if the sc command fails
 */
export function setAutoStart(enable: boolean): void {
  if (process.platform !== "win32") {
    throw new Error("Service auto-start is only supported on Windows");
  }

  const startType = enable ? "auto" : "demand";
  try {
    // Note: sc config syntax requires "start= auto" with space after "="
    execFileSync("sc", ["config", SERVICE_NAME, "start=", startType], {
      windowsHide: true,
    });
    logger.info(`[AgentSettings] Service start type set to ${startType}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("[AgentSettings] Failed to update service start type:", {
      error: message,
    });
    throw new Error(`Failed to update auto-start setting: ${message}`);
  }
}

/**
 * Query the current service state (running, stopped, etc.).
 * @returns Service state string or null if query fails
 */
export function getServiceState(): string | null {
  if (process.platform !== "win32") return null;

  try {
    const result = execFileSync("sc", ["query", SERVICE_NAME], {
      encoding: "utf-8",
      windowsHide: true,
    });
    // Parse "STATE : 4 RUNNING" or "STATE : 1 STOPPED"
    const match = result.match(/STATE\s*:\s*\d+\s+(\w+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
