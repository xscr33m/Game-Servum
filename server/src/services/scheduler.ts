/**
 * Scheduled Restart Service
 *
 * Manages timed server restarts with in-game RCON warnings.
 * Each server can have one schedule with configurable:
 * - Restart interval (hours)
 * - Optional restart time anchor (HH:mm) for fixed clock-time restarts
 * - Warning times before restart (minutes)
 * - Warning message template with {MINUTES} placeholder
 *
 * When restartTime is set (e.g. "06:00" with intervalHours=6), restarts
 * occur at fixed clock times: 06:00, 12:00, 18:00, 00:00.
 * When restartTime is null, restarts are purely interval-based from now.
 *
 * Warnings are sent via the game-specific broadcast command (e.g. `#broadcast` for DayZ).
 * After the final warning, the server is stopped and restarted.
 */

import { broadcast } from "../core/broadcast.js";
import { logger } from "../core/logger.js";
import {
  getScheduleByServerId,
  updateScheduleNextRestart,
  getAllEnabledSchedules,
  getServerById,
  getBackupSettings,
} from "../db/index.js";
import { stopServer, startServer } from "./serverProcess.js";
import { sendGameBroadcast } from "./messageBroadcaster.js";
import { resolveVariables } from "./variableResolver.js";
import { createBackup } from "./backupManager.js";
import type { ServerSchedule } from "../types/index.js";

// Active timers per server
const restartTimers = new Map<number, ReturnType<typeof setTimeout>>();
const warningTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

/**
 * Calculate the next restart time for a time-anchored schedule.
 *
 * Given a restartTime like "06:00" and interval of 6h, this generates
 * all daily restart slots (06:00, 12:00, 18:00, 00:00) and returns
 * the next one after `now`.
 */
function calculateNextTimeBasedRestart(
  restartTime: string,
  intervalHours: number,
  now: Date,
): Date {
  const [hours, minutes] = restartTime.split(":").map(Number);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Build anchor at restartTime today
  const todayAnchor = new Date(now);
  todayAnchor.setHours(hours, minutes, 0, 0);

  // Find the most recent anchor point at or before now
  // by stepping back from todayAnchor if needed
  let anchor = todayAnchor;
  if (anchor > now) {
    // Go back one day first
    anchor = new Date(anchor.getTime() - 24 * 60 * 60 * 1000);
  }

  // Step forward from the anchor by intervalMs to find the next slot after now
  // First, align to the nearest past slot
  while (anchor.getTime() + intervalMs <= now.getTime()) {
    anchor = new Date(anchor.getTime() + intervalMs);
  }

  // The next restart is one interval after the last past slot
  return new Date(anchor.getTime() + intervalMs);
}

/**
 * Start or update a scheduled restart for a server
 */
export function startSchedule(serverId: number): void {
  // Clear any existing timers for this server
  clearSchedule(serverId);

  const schedule = getScheduleByServerId(serverId);
  if (!schedule || !schedule.enabled) {
    return;
  }

  const server = getServerById(serverId);
  if (!server) {
    return;
  }

  // Calculate next restart time
  const now = new Date();
  let nextRestart: Date;

  if (schedule.restartTime) {
    // Time-based scheduling: calculate next fixed clock time
    nextRestart = calculateNextTimeBasedRestart(
      schedule.restartTime,
      schedule.intervalHours,
      now,
    );
  } else if (schedule.nextRestart) {
    const stored = new Date(schedule.nextRestart);
    if (stored > now) {
      nextRestart = stored;
    } else {
      // Scheduled time has passed, calculate next one
      nextRestart = new Date(
        now.getTime() + schedule.intervalHours * 60 * 60 * 1000,
      );
    }
  } else {
    nextRestart = new Date(
      now.getTime() + schedule.intervalHours * 60 * 60 * 1000,
    );
  }

  // Save the calculated next restart time
  updateScheduleNextRestart(serverId, nextRestart.toISOString());

  const msUntilRestart = nextRestart.getTime() - now.getTime();

  logger.info(
    `[Scheduler] Server ${serverId}: next restart in ${Math.round(msUntilRestart / 60000)} minutes at ${nextRestart.toLocaleTimeString()}`,
  );

  // Schedule warning messages
  scheduleWarnings(serverId, schedule, msUntilRestart);

  // Schedule the actual restart
  const timer = setTimeout(() => {
    performRestart(serverId);
  }, msUntilRestart);

  restartTimers.set(serverId, timer);

  // Broadcast schedule update to clients
  broadcastScheduleUpdate(serverId);
}

/**
 * Schedule warning messages before restart
 */
function scheduleWarnings(
  serverId: number,
  schedule: ServerSchedule,
  msUntilRestart: number,
): void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  // Sort warning minutes descending (e.g. [15, 5, 1])
  const sortedWarnings = [...schedule.warningMinutes].sort((a, b) => b - a);

  for (const minutes of sortedWarnings) {
    const msBeforeRestart = minutes * 60 * 1000;
    const msUntilWarning = msUntilRestart - msBeforeRestart;

    if (msUntilWarning > 0) {
      const timer = setTimeout(() => {
        sendWarning(serverId, schedule, minutes);
      }, msUntilWarning);
      timers.push(timer);
    }
  }

  warningTimers.set(serverId, timers);
}

/**
 * Send an in-game warning via RCON
 */
async function sendWarning(
  serverId: number,
  schedule: ServerSchedule,
  minutes: number,
): Promise<void> {
  // Resolve all template variables including {MINUTES}
  const message = resolveVariables(serverId, schedule.warningMessage, {
    MINUTES: minutes.toString(),
  });

  logger.info(`[Scheduler] Server ${serverId}: sending warning - "${message}"`);

  // Send via RCON
  const sent = await sendGameBroadcast(serverId, message);
  if (!sent) {
    logger.warn(
      `[Scheduler] Server ${serverId}: RCON not connected, cannot send warning`,
    );
  }

  // Broadcast warning to UI
  broadcast("schedule:warning", {
    serverId,
    minutes,
    message,
  });
}

/**
 * Perform the scheduled restart
 */
async function performRestart(serverId: number): Promise<void> {
  const server = getServerById(serverId);
  if (!server) {
    logger.error(`[Scheduler] Server ${serverId} not found, skipping restart`);
    return;
  }

  logger.info(`[Scheduler] Server ${serverId}: performing scheduled restart`);

  // Broadcast restart event
  broadcast("schedule:restart", {
    serverId,
    message: `Scheduled restart for ${server.name}`,
  });

  // Pre-restart backup if enabled
  const backupSettings = getBackupSettings(serverId);
  if (backupSettings?.backupBeforeRestart) {
    logger.info(`[Scheduler] Server ${serverId}: creating pre-restart backup`);
    try {
      await createBackup(serverId, {
        trigger: "pre-restart",
        skipServerLifecycle: true,
      });
    } catch (err) {
      logger.error(
        `[Scheduler] Pre-restart backup failed for server ${serverId}: ${(err as Error).message}`,
      );
      // Continue with restart even if backup fails
    }
  }

  // Stop the server
  if (server.status === "running") {
    const stopResult = await stopServer(serverId);
    if (!stopResult.success) {
      logger.error(
        `[Scheduler] Failed to stop server ${serverId}:`,
        stopResult.message,
      );
      // Still try to reschedule
      rescheduleAfterRestart(serverId);
      return;
    }

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Update last restart time
  const now = new Date().toISOString();

  // Start the server again
  const startResult = startServer(serverId);
  if (!startResult.success) {
    logger.error(
      `[Scheduler] Failed to start server ${serverId}:`,
      startResult.message,
    );
  }

  // Reschedule the next restart
  rescheduleAfterRestart(serverId, now);
}

/**
 * Reschedule after a restart completes
 */
function rescheduleAfterRestart(serverId: number, lastRestart?: string): void {
  const schedule = getScheduleByServerId(serverId);
  if (!schedule || !schedule.enabled) return;

  let nextRestart: Date;
  if (schedule.restartTime) {
    // Time-based: calculate the next fixed clock-time slot
    nextRestart = calculateNextTimeBasedRestart(
      schedule.restartTime,
      schedule.intervalHours,
      new Date(),
    );
  } else {
    // Interval-based: next restart is intervalHours from now
    nextRestart = new Date(
      Date.now() + schedule.intervalHours * 60 * 60 * 1000,
    );
  }

  updateScheduleNextRestart(serverId, nextRestart.toISOString(), lastRestart);

  // Re-start the schedule cycle
  startSchedule(serverId);
}

/**
 * Clear all timers for a server
 */
export function clearSchedule(serverId: number): void {
  const restartTimer = restartTimers.get(serverId);
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimers.delete(serverId);
  }

  const warnings = warningTimers.get(serverId);
  if (warnings) {
    for (const timer of warnings) {
      clearTimeout(timer);
    }
    warningTimers.delete(serverId);
  }
}

/**
 * Initialize all enabled schedules (called on server startup)
 */
export function initializeSchedules(): void {
  const schedules = getAllEnabledSchedules();
  logger.info(
    `[Scheduler] Initializing ${schedules.length} enabled schedule(s)`,
  );

  for (const schedule of schedules) {
    const server = getServerById(schedule.serverId);
    if (server && server.status === "running") {
      startSchedule(schedule.serverId);
    }
  }
}

/**
 * Broadcast schedule state update to connected clients
 */
function broadcastScheduleUpdate(serverId: number): void {
  const schedule = getScheduleByServerId(serverId);
  broadcast("schedule:update", {
    serverId,
    schedule,
  });
}
