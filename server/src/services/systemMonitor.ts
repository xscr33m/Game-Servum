import os from "os";
import { exec } from "child_process";

export interface SystemMetrics {
  cpu: {
    usagePercent: number;
    cores: number;
    model: string;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
    drive: string;
  };
  network: {
    bytesSent: number;
    bytesReceived: number;
    /** Bytes/s sent (delta since last sample) */
    sendRate: number;
    /** Bytes/s received (delta since last sample) */
    receiveRate: number;
  };
  uptime: number;
  timestamp: string;
}

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

// ─── Network via os.networkInterfaces() delta ───────────────────────────

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
    exec("netstat -e", (error, stdout) => {
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

// ─── Disk Usage via PowerShell (Windows) ────────────────────────────────

function getDiskUsage(): Promise<{
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  drive: string;
}> {
  return new Promise((resolve) => {
    const drive = process.cwd().charAt(0).toUpperCase() + ":";
    const defaultResult = {
      totalBytes: 0,
      freeBytes: 0,
      usedBytes: 0,
      usagePercent: 0,
      drive,
    };

    // Use PowerShell Get-CimInstance (works on all modern Windows versions)
    const psCommand = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_LogicalDisk -Filter \\"DeviceID='${drive}'\\" | Select-Object -Property Size,FreeSpace | ConvertTo-Json"`;

    exec(psCommand, (error, stdout) => {
      if (error) {
        resolve(defaultResult);
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        const totalBytes = parsed.Size || 0;
        const freeBytes = parsed.FreeSpace || 0;
        const usedBytes = totalBytes - freeBytes;
        const usagePercent =
          totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

        resolve({ totalBytes, freeBytes, usedBytes, usagePercent, drive });
      } catch {
        resolve(defaultResult);
      }
    });
  });
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const [disk, network] = await Promise.all([
    getDiskUsage(),
    getNetworkStats(),
  ]);

  return {
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
}
