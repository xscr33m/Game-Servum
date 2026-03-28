import { useEffect, useState, useRef, useCallback } from "react";
import {
  FaMicrochip,
  FaMemory,
  FaHardDrive,
  FaNetworkWired,
  FaArrowUp,
  FaArrowDown,
  FaServer,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";
import { Tip } from "@/components/ui/tooltip";
import type { SystemMetrics } from "@/types";

/** Polling interval in ms */
const POLL_INTERVAL = 2000;

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return `${(bytesPerSec / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Circular progress ring with accent color */
function UsageRing({
  percent,
  size = 48,
  strokeWidth = 4,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/30"
      />
      {/* Fill — accent color */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="text-ring transition-all duration-700 ease-out"
      />
    </svg>
  );
}

export function SystemMonitor() {
  const { api, activeConnection, isConnected } = useBackend();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await api.system.getMetrics();
      setMetrics(data);
      setError(false);
    } catch {
      setError(true);
    }
  }, [api.system]);

  // Poll only while connected; clear stale data when disconnected
  useEffect(() => {
    if (!isConnected) return;
    const initialTimeout = window.setTimeout(fetchMetrics, 0);
    intervalRef.current = window.setInterval(fetchMetrics, POLL_INTERVAL);
    return () => {
      window.clearTimeout(initialTimeout);
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      // Clear stale metrics and reset error when polling stops (disconnect)
      setMetrics(null);
      setError(false);
    };
  }, [fetchMetrics, isConnected]);

  if (error && isConnected) {
    return null;
  }

  const agentName = activeConnection?.name;

  if (!metrics) {
    return (
      <div className="space-y-2">
        {/* Agent hint skeleton */}
        {agentName && (
          <div className="flex items-center gap-1.5 p-1">
            <div className="h-3 w-3 rounded bg-muted/30 animate-pulse" />
            <div className="h-3 w-32 rounded bg-muted/30 animate-pulse" />
          </div>
        )}
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {/* CPU, Memory, Disk skeletons */}
          {["CPU", "Memory", "Disk"].map((label) => (
            <div
              key={label}
              className="rounded-lg sm:rounded-xl border border-border/50 bg-card/60 p-2 sm:p-3.5 lg:p-5 flex flex-col min-w-0 overflow-hidden animate-pulse"
            >
              <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3 lg:mb-4">
                <div className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded bg-muted/30 animate-pulse" />
                <div className="h-3 w-12 sm:w-16 rounded bg-muted/30 animate-pulse" />
              </div>
              <div className="flex items-end justify-between gap-2 mb-1 sm:mb-2 lg:mb-3">
                <div className="h-[22px] sm:h-[32px] lg:h-[42px] w-16 sm:w-24 rounded bg-muted/30 animate-pulse" />
                <div className="relative shrink-0 hidden md:block">
                  <div className="h-12 w-12 rounded-full bg-muted/30 animate-pulse" />
                </div>
              </div>
              <div className="h-[10px] sm:h-[11px] w-full rounded bg-muted/30 mt-1.5 hidden sm:block animate-pulse" />
            </div>
          ))}

          {/* Network skeleton - different structure */}
          <div className="rounded-lg sm:rounded-xl border border-border/50 bg-card/60 p-3 sm:p-3.5 lg:p-5 flex flex-col min-w-0 overflow-hidden">
            <div className="mb-2 sm:mb-3 lg:mb-4">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded bg-muted/30 animate-pulse" />
                <div className="h-3 w-16 rounded bg-muted/30" />
                <div className="h-[9px] sm:h-[10px] w-12 rounded bg-muted/30 ml-auto hidden sm:block animate-pulse" />
              </div>
            </div>
            <div className="space-y-1 sm:space-y-2 lg:space-y-2.5 flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded bg-muted/30 animate-pulse" />
                <div className="h-3 sm:h-4 lg:h-[22px] w-20 sm:w-24 rounded bg-muted/30 animate-pulse" />
              </div>
              <div className="border-t border-border/30" />
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded bg-muted/30 animate-pulse" />
                <div className="h-3 sm:h-4 lg:h-[22px] w-20 sm:w-24 rounded bg-muted/30 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Agent hint */}
      {agentName && (
        <div className="flex items-center gap-1.5 px-1">
          <FaServer className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-[11px] text-muted-foreground/60">
            Hardware metrics from{" "}
            <span className="text-muted-foreground font-medium">
              {agentName}
            </span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {/* CPU */}
        <div className="rounded-lg sm:rounded-xl border border-border/50 bg-card/60 p-2.5 sm:p-3.5 lg:p-5 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3 lg:mb-4">
            <FaMicrochip className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-ring shrink-0" />
            <span className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider">
              CPU
            </span>
          </div>
          <div className="flex items-end justify-between gap-2 mb-1 sm:mb-2 lg:mb-3">
            <p className="text-lg sm:text-2xl lg:text-3xl font-semibold tabular-nums text-foreground leading-none">
              {metrics.cpu.usagePercent.toFixed(1)}
              <span className="text-xs sm:text-base lg:text-lg text-muted-foreground ml-0.5">
                %
              </span>
            </p>
            <div className="relative shrink-0 hidden md:block">
              <UsageRing
                percent={metrics.cpu.usagePercent}
                size={48}
                strokeWidth={4}
              />
              <FaMicrochip className="absolute inset-0 m-auto h-3.5 w-3.5 text-ring/40" />
            </div>
          </div>
          <Tip content={metrics.cpu.model}>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate mt-auto min-w-0 hidden sm:block">
              {metrics.cpu.cores} Cores &middot;{" "}
              {metrics.cpu.model.split("@")[0].trim().replace(/\s+/g, " ")}
            </p>
          </Tip>
        </div>

        {/* Memory */}
        <div className="rounded-lg sm:rounded-xl border border-border/50 bg-card/60 p-2.5 sm:p-3.5 lg:p-5 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3 lg:mb-4">
            <FaMemory className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-ring shrink-0" />
            <span className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Memory
            </span>
          </div>
          <div className="flex items-end justify-between gap-2 mb-1 sm:mb-2 lg:mb-3">
            <p className="text-lg sm:text-2xl lg:text-3xl font-semibold tabular-nums text-foreground leading-none">
              {metrics.memory.usagePercent.toFixed(1)}
              <span className="text-xs sm:text-base lg:text-lg text-muted-foreground ml-0.5">
                %
              </span>
            </p>
            <div className="relative shrink-0 hidden md:block">
              <UsageRing
                percent={metrics.memory.usagePercent}
                size={48}
                strokeWidth={4}
              />
              <FaMemory className="absolute inset-0 m-auto h-3.5 w-3.5 text-ring/40" />
            </div>
          </div>
          <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-auto truncate min-w-0 hidden sm:block">
            {formatBytes(metrics.memory.usedBytes)} used{" "}
            <span className="text-muted-foreground/50">
              / {formatBytes(metrics.memory.totalBytes)}
            </span>
          </p>
        </div>

        {/* Disk */}
        <div className="rounded-lg sm:rounded-xl border border-border/50 bg-card/60 p-2.5 sm:p-3.5 lg:p-5 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3 lg:mb-4">
            <FaHardDrive className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-ring shrink-0" />
            <span className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
              Disk ({metrics.disk.drive})
            </span>
          </div>
          <div className="flex items-end justify-between gap-2 mb-1 sm:mb-2 lg:mb-3">
            <p className="text-lg sm:text-2xl lg:text-3xl font-semibold tabular-nums text-foreground leading-none">
              {metrics.disk.usagePercent.toFixed(1)}
              <span className="text-xs sm:text-base lg:text-lg text-muted-foreground ml-0.5">
                %
              </span>
            </p>
            <div className="relative shrink-0 hidden md:block">
              <UsageRing
                percent={metrics.disk.usagePercent}
                size={48}
                strokeWidth={4}
              />
              <FaHardDrive className="absolute inset-0 m-auto h-3.5 w-3.5 text-ring/40" />
            </div>
          </div>
          <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-auto truncate min-w-0 hidden sm:block">
            {formatBytes(metrics.disk.freeBytes)} free{" "}
            <span className="text-muted-foreground/50">
              / {formatBytes(metrics.disk.totalBytes)}
            </span>
          </p>
        </div>

        {/* Network */}
        <div className="rounded-lg sm:rounded-xl border border-border/50 bg-card/60 p-2.5 sm:p-3.5 lg:p-5 flex flex-col min-w-0 overflow-hidden">
          <div className="mb-2 sm:mb-3 lg:mb-4">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <FaNetworkWired className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-ring shrink-0" />
              <span className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Network
              </span>
              <span className="text-[9px] sm:text-[10px] text-muted-foreground/50 tabular-nums ml-auto whitespace-nowrap hidden sm:inline">
                {formatUptime(metrics.uptime)}
              </span>
            </div>
          </div>
          <div className="space-y-1 sm:space-y-2 lg:space-y-2.5 flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <FaArrowUp className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-ring/60 shrink-0" />
              <span className="text-xs sm:text-base lg:text-lg font-semibold tabular-nums text-foreground truncate">
                {formatRate(metrics.network.sendRate)}
              </span>
            </div>
            <div className="border-t border-border/30" />
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <FaArrowDown className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-ring/60 shrink-0" />
              <span className="text-xs sm:text-base lg:text-lg font-semibold tabular-nums text-foreground truncate">
                {formatRate(metrics.network.receiveRate)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
