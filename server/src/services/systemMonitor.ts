import os from "os";
import { exec } from "child_process";
import { statfs } from "fs/promises";
import type { SystemMetrics } from "@game-servum/shared";

export type { SystemMetrics };

// ─── CPU Usage via os.cpus() delta ──────────────────────────────────────

let previousCpuTimes: { idle: number; total: number } | null = null;

function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }

  if (previousCpuTimes) {
    const idleDelta = idle - previousCpuTimes.idle;
    const totalDelta = total - previousCpuTimes.total;
    previousCpuTimes = { idle, total };
    if (totalDelta === 0) return 0;
    return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
  }

  previousCpuTimes = { idle, total };
  return 0; // First call — no delta yet
}

// ─── Network via netstat -e delta ───────────────────────────────────────

interface NetworkSnapshot {
  bytesSent: number;
  bytesReceived: number;
  timestamp: number;
}

let previousNetworkSnapshot: NetworkSnapshot | null = null;

/**
 * Get network stats using Windows `netstat -e` command.
 * Falls back to zeros if the command fails.
 */
function getNetworkStats(): Promise<{
  bytesSent: number;
  bytesReceived: number;
  sendRate: number;
  receiveRate: number;
}> {
  return new Promise((resolve) => {
    exec("netstat -e", { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({
          bytesSent: 0,
          bytesReceived: 0,
          sendRate: 0,
          receiveRate: 0,
        });
        return;
      }

      let bytesReceived = 0;
      let bytesSent = 0;

      const lines = stdout.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Bytes") || trimmed.startsWith("Byte")) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 3) {
            bytesReceived = parseInt(parts[1], 10) || 0;
            bytesSent = parseInt(parts[2], 10) || 0;
          }
          break;
        }
      }

      const now = Date.now();
      let sendRate = 0;
      let receiveRate = 0;

      if (previousNetworkSnapshot) {
        const elapsed = (now - previousNetworkSnapshot.timestamp) / 1000;
        if (elapsed > 0) {
          sendRate = Math.max(
            0,
            (bytesSent - previousNetworkSnapshot.bytesSent) / elapsed,
          );
          receiveRate = Math.max(
            0,
            (bytesReceived - previousNetworkSnapshot.bytesReceived) / elapsed,
          );
        }
      }

      previousNetworkSnapshot = {
        bytesSent,
        bytesReceived,
        timestamp: now,
      };

      resolve({ bytesSent, bytesReceived, sendRate, receiveRate });
    });
  });
}

// ─── Disk Usage via fs.statfs() (native, no subprocess) ────────────────

async function getDiskUsage(): Promise<{
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  drive: string;
}> {
  const drive = process.cwd().charAt(0).toUpperCase() + ":";
  const defaultResult = {
    totalBytes: 0,
    freeBytes: 0,
    usedBytes: 0,
    usagePercent: 0,
    drive,
  };

  try {
    // statfs works on any path — use cwd root (e.g. "C:\\" on Windows)
    const stats = await statfs(process.cwd());
    const totalBytes = stats.bsize * stats.blocks;
    const freeBytes = stats.bsize * stats.bavail;
    const usedBytes = totalBytes - freeBytes;
    const usagePercent =
      totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

    return { totalBytes, freeBytes, usedBytes, usagePercent, drive };
  } catch {
    return defaultResult;
  }
}

// ─── Cached metrics collection ──────────────────────────────────────────

const COLLECTION_INTERVAL = 2000;
let cachedMetrics: SystemMetrics | null = null;
let collectionTimer: ReturnType<typeof setInterval> | null = null;

async function collectMetrics(): Promise<SystemMetrics> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const [disk, network] = await Promise.all([
    getDiskUsage(),
    getNetworkStats(),
  ]);

  const metrics: SystemMetrics = {
    cpu: {
      usagePercent: getCpuUsage(),
      cores: cpus.length,
      model: cpus[0]?.model || "Unknown",
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      freeBytes: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 1000) / 10,
    },
    disk,
    network,
    uptime: os.uptime(),
    timestamp: new Date().toISOString(),
  };

  cachedMetrics = metrics;
  return metrics;
}

/** Start background metrics collection (call when first client connects). */
export function startMetricsCollection(): void {
  if (collectionTimer) return;
  // Kick off an immediate collection (don't await — runs in background)
  collectMetrics().catch(() => {});
  collectionTimer = setInterval(() => {
    collectMetrics().catch(() => {});
  }, COLLECTION_INTERVAL);
}

/** Stop background metrics collection (call when last client disconnects). */
export function stopMetricsCollection(): void {
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
  }
  // Keep cachedMetrics for quick response on reconnect
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function getSystemMetrics(): Promise<SystemMetrics> {
  if (cachedMetrics) return cachedMetrics;
  // No cache yet (first call or before timer started) — collect once directly
  return collectMetrics();
}
