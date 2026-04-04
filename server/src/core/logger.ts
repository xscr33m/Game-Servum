import { SimpleLogger } from "../services/logger.js";
import { getConfig } from "../services/config.js";
import { DEFAULT_LOG_SETTINGS } from "@game-servum/shared";

const config = getConfig();

/**
 * Singleton application logger — shared across all server modules.
 */
export const logger = new SimpleLogger("agent", config.logsPath, {
  ...DEFAULT_LOG_SETTINGS,
  writeToConsole: process.env.NODE_ENV === "development",
});
