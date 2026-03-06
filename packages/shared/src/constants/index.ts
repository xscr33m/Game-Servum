/**
 * Game-Servum — Centralized Version & Constants
 */

/** Current application version (SemVer) */
export const APP_VERSION = "0.9.1";

/** API version identifier */
export const API_VERSION = "v1";

/** Minimum agent version the dashboard is compatible with */
export const MIN_COMPATIBLE_AGENT_VERSION = "1.0.0";

/** Default ports */
export const DEFAULT_AGENT_PORT = 3001;
export const DEFAULT_DASHBOARD_PORT = 5173;

/** API path prefixes */
export const API_PREFIX = "/api";
export const API_V1_PREFIX = "/api/v1";

/** WebSocket path */
export const WS_PATH = "/ws";

/** Token lifetime in seconds (24h) */
export const TOKEN_LIFETIME_SECONDS = 86400;

/**
 * Compare two SemVer strings.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSemVer(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Check whether an agent version is compatible with the dashboard.
 * Compatible if agent >= MIN_COMPATIBLE_AGENT_VERSION and same major.
 */
export function isAgentCompatible(agentVersion: string): boolean {
  const agentMajor = parseInt(agentVersion.split(".")[0] ?? "0", 10);
  const dashMajor = parseInt(APP_VERSION.split(".")[0] ?? "0", 10);
  if (agentMajor !== dashMajor) return false;
  return compareSemVer(agentVersion, MIN_COMPATIBLE_AGENT_VERSION) >= 0;
}
