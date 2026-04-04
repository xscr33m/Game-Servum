import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";
import { execFileSync } from "child_process";
import { APP_VERSION, compareSemVer } from "@game-servum/shared";
import type { UpdateState } from "@game-servum/shared";
import { getConfig } from "./config.js";
import { broadcast } from "../core/broadcast.js";
import { logger } from "../core/logger.js";
import { getRunningServerIds } from "./serverProcess.js";
import { setAppSetting } from "../db/index.js";

const SERVICE_NAME = "GameServumAgent";
const GITHUB_OWNER = "xscr33m";
const GITHUB_REPO = "Game-Servum";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const UPDATE_ASSET_PREFIX = "Game-Servum-Agent-Update-";

const config = getConfig();
const UPDATE_STATE_FILE = path.join(
  config.dataPath,
  ".agent-update-state.json",
);
const STAGING_DIR = path.join(config.dataPath, ".update-staging");

// In-memory state, periodically persisted to disk
let updateState: UpdateState = {
  checking: false,
  updateAvailable: false,
  currentVersion: APP_VERSION,
  downloading: false,
  downloaded: false,
};

let autoCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Persist current update state to disk and broadcast to connected clients.
 */
function persistState(): void {
  try {
    fs.mkdirSync(path.dirname(UPDATE_STATE_FILE), { recursive: true });
    fs.writeFileSync(UPDATE_STATE_FILE, JSON.stringify(updateState, null, 2));
  } catch (err) {
    logger.warn("[AgentUpdater] Failed to persist update state:", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

/**
 * Load persisted state from disk on startup.
 */
function loadPersistedState(): void {
  try {
    if (fs.existsSync(UPDATE_STATE_FILE)) {
      const content = fs.readFileSync(UPDATE_STATE_FILE, "utf-8");
      const persisted = JSON.parse(content) as UpdateState;
      // Restore relevant fields, reset transient states
      updateState = {
        ...updateState,
        updateAvailable: persisted.updateAvailable,
        latestVersion: persisted.latestVersion,
        releaseNotes: persisted.releaseNotes,
        releaseDate: persisted.releaseDate,
        downloaded: persisted.downloaded,
        lastCheck: persisted.lastCheck,
        currentVersion: APP_VERSION,
        checking: false,
        downloading: false,
      };
    }
  } catch {
    // Ignore — start with fresh state
  }
}

/**
 * Return current update state.
 */
export function getUpdateState(): UpdateState {
  return { ...updateState };
}

/**
 * Check GitHub Releases for a newer agent version.
 */
export async function checkForUpdates(): Promise<void> {
  if (updateState.checking) return;

  updateState.checking = true;
  updateState.error = undefined;
  persistState();

  try {
    logger.info("[AgentUpdater] Checking for updates...");

    const response = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": `GameServumAgent/${APP_VERSION}`,
      },
    });

    if (!response.ok) {
      // 404 = no production release exists yet (e.g. only pre-releases)
      if (response.status === 404) {
        updateState.updateAvailable = false;
        updateState.lastCheck = Date.now();
        logger.info(
          "[AgentUpdater] No production release found (only pre-releases or no releases yet)",
        );
        broadcast("update-check:complete", {
          updateAvailable: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
        });
        return;
      }
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const release = (await response.json()) as {
      tag_name: string;
      body?: string;
      published_at?: string;
      assets?: Array<{
        name: string;
        browser_download_url: string;
        size: number;
      }>;
    };

    // Tag format: "v1.2.3" → strip leading "v"
    const latestVersion = release.tag_name.replace(/^v/, "");
    updateState.lastCheck = Date.now();

    if (compareSemVer(latestVersion, APP_VERSION) > 0) {
      updateState.updateAvailable = true;
      updateState.latestVersion = latestVersion;
      updateState.releaseNotes = release.body || undefined;
      updateState.releaseDate = release.published_at || undefined;
      // Reset download state for new version
      updateState.downloaded = false;
      updateState.downloadProgress = undefined;

      logger.info("[AgentUpdater] Update available", {
        current: APP_VERSION,
        latest: latestVersion,
      });

      broadcast("update:detected", {
        currentVersion: APP_VERSION,
        latestVersion,
        releaseNotes: release.body,
        releaseDate: release.published_at,
      });
    } else {
      updateState.updateAvailable = false;
      updateState.latestVersion = latestVersion;
      logger.info("[AgentUpdater] Agent is up to date", {
        version: APP_VERSION,
      });
    }

    broadcast("update-check:complete", {
      updateAvailable: updateState.updateAvailable,
      currentVersion: APP_VERSION,
      latestVersion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    updateState.error = message;
    logger.error("[AgentUpdater] Update check failed:", { error: message });
  } finally {
    updateState.checking = false;
    persistState();
  }
}

/**
 * Download the update ZIP from GitHub Releases.
 */
export async function downloadUpdate(): Promise<void> {
  if (updateState.downloading) {
    throw new Error("Download already in progress");
  }
  if (!updateState.updateAvailable || !updateState.latestVersion) {
    throw new Error("No update available to download");
  }
  if (updateState.downloaded) {
    throw new Error("Update already downloaded");
  }

  updateState.downloading = true;
  updateState.downloadProgress = 0;
  updateState.error = undefined;
  persistState();

  try {
    const version = updateState.latestVersion;
    const assetName = `${UPDATE_ASSET_PREFIX}v${version}.zip`;

    logger.info("[AgentUpdater] Downloading update...", { version, assetName });

    // Fetch release to find the asset URL
    const releaseResp = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": `GameServumAgent/${APP_VERSION}`,
      },
    });

    if (!releaseResp.ok) {
      throw new Error(`GitHub API returned ${releaseResp.status}`);
    }

    const release = (await releaseResp.json()) as {
      assets?: Array<{
        name: string;
        browser_download_url: string;
        size: number;
      }>;
    };

    const asset = release.assets?.find((a) => a.name === assetName);
    if (!asset) {
      throw new Error(
        `Update asset "${assetName}" not found in release. Available: ${release.assets?.map((a) => a.name).join(", ") || "none"}`,
      );
    }

    // Download the asset
    const downloadResp = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": `GameServumAgent/${APP_VERSION}` },
    });

    if (!downloadResp.ok || !downloadResp.body) {
      throw new Error(`Download failed with status ${downloadResp.status}`);
    }

    // Prepare staging directory
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    const zipPath = path.join(STAGING_DIR, assetName);

    // Stream download with progress tracking
    const totalSize = asset.size;
    let downloadedBytes = 0;

    const fileStream = createWriteStream(zipPath);
    const reader = downloadResp.body.getReader();

    // Read chunks and write to file while tracking progress
    const writable = new WritableStream({
      write(chunk: Uint8Array) {
        downloadedBytes += chunk.length;
        if (totalSize > 0) {
          updateState.downloadProgress = Math.round(
            (downloadedBytes / totalSize) * 100,
          );
          persistState();
        }
        return new Promise((resolve, reject) => {
          fileStream.write(chunk, (err) => (err ? reject(err) : resolve()));
        });
      },
      close() {
        return new Promise((resolve) => fileStream.end(resolve));
      },
    });

    await reader.read().then(function process({ done, value }): Promise<void> {
      if (done) {
        return writable.close();
      }
      const writer = writable.getWriter();
      return writer.write(value).then(() => {
        writer.releaseLock();
        return reader.read().then(process);
      });
    });

    updateState.downloaded = true;
    updateState.downloading = false;
    updateState.downloadProgress = 100;
    persistState();

    logger.info("[AgentUpdater] Update downloaded successfully", {
      path: zipPath,
      size: downloadedBytes,
    });

    broadcast("update:applied", {
      version,
      status: "downloaded",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    updateState.error = message;
    updateState.downloading = false;
    updateState.downloadProgress = undefined;
    persistState();
    logger.error("[AgentUpdater] Download failed:", { error: message });
    throw new Error(`Update download failed: ${message}`);
  }
}

/**
 * Install the downloaded update by running a PowerShell script that:
 * 1. Stops the Windows Service
 * 2. Extracts update files over the installation directory
 * 3. Restarts the Windows Service
 * 4. Cleans up staging files
 */
export async function installUpdate(): Promise<void> {
  if (!updateState.downloaded || !updateState.latestVersion) {
    throw new Error("No update downloaded to install");
  }
  if (process.platform !== "win32") {
    throw new Error("Update installation is only supported on Windows");
  }

  const version = updateState.latestVersion;
  const assetName = `${UPDATE_ASSET_PREFIX}v${version}.zip`;
  const zipPath = path.join(STAGING_DIR, assetName);

  if (!fs.existsSync(zipPath)) {
    throw new Error("Downloaded update file not found");
  }

  // Determine installation directory (where this process is running from)
  const installDir = path.dirname(process.argv[1] || process.execPath);

  logger.info("[AgentUpdater] Installing update...", {
    version,
    zipPath,
    installDir,
  });

  // Create a PowerShell script that performs the update
  const logFile = path
    .join(STAGING_DIR, "update-log.txt")
    .replace(/\\/g, "\\\\");
  const psScript = `
# Game-Servum Agent Update Script
# Auto-generated — do not edit
$ErrorActionPreference = "Stop"
$ServiceName = "${SERVICE_NAME}"
$ZipPath = "${zipPath.replace(/\\/g, "\\\\")}"
$InstallDir = "${installDir.replace(/\\/g, "\\\\")}"
$StagingDir = "${STAGING_DIR.replace(/\\/g, "\\\\")}"
$LogFile = "${logFile}"

function Log($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$ts] $msg" | Tee-Object -FilePath $LogFile -Append
}

try {
  Log "Update script started"
  Log "Waiting for agent process to release files..."
  Start-Sleep -Seconds 5

  # Stop the service
  Log "Stopping service $ServiceName..."
  try { Stop-Service -Name $ServiceName -Force -ErrorAction Stop } catch {
    Log "Service stop warning: $_"
  }

  # Wait for service to fully stop
  Log "Waiting for service to stop..."
  $timeout = 30
  while ($timeout -gt 0) {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc.Status -eq "Stopped") { break }
    Start-Sleep -Seconds 1
    $timeout--
  }
  Log "Service status: $((Get-Service -Name $ServiceName).Status)"

  # Extract update files
  Log "Extracting update from $ZipPath to $InstallDir..."
  Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force
  Log "Extraction complete"

  # Start the service
  Log "Starting service $ServiceName..."
  Start-Service -Name $ServiceName -ErrorAction Stop
  Log "Service started successfully"

  # Cleanup staging (keep log file for diagnostics)
  Log "Cleaning up staging directory..."
  Get-ChildItem -Path $StagingDir -Exclude "update-log.txt" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  # Remove the scheduled task that launched this script
  Log "Removing scheduled task..."
  schtasks /delete /tn "GameServumAgentUpdate" /f 2>&1 | Out-Null

  Log "Update to v${version} completed successfully."
} catch {
  Log "ERROR: $_"
  Log "Stack: $($_.ScriptStackTrace)"
  # Still try to restart the service on error
  try { Start-Service -Name $ServiceName -ErrorAction SilentlyContinue } catch {}
  # Clean up scheduled task even on error
  schtasks /delete /tn "GameServumAgentUpdate" /f 2>&1 | Out-Null
  exit 1
}
`;

  const psScriptPath = path.join(STAGING_DIR, "install-update.ps1");
  fs.writeFileSync(psScriptPath, psScript, "utf-8");

  // Persist running server IDs so they can be auto-started after the update.
  // The update path bypasses the normal gracefulShutdown persisting logic
  // (WinSW receives Stop-Service from the PowerShell script).
  const runningIds = getRunningServerIds();
  if (runningIds.length > 0) {
    setAppSetting("pending_restart_servers", JSON.stringify(runningIds));
    logger.info(
      `[AgentUpdater] Persisted ${runningIds.length} running server(s) for auto-restart after update: [${runningIds.join(", ")}]`,
    );
  }

  broadcast("update:restart", {
    version,
    message: `Installing update v${version}...`,
  });

  // Use Windows Task Scheduler to run the update script independently of the
  // service process tree — ensures the script survives when the service stops.
  // execFileSync bypasses cmd.exe, avoiding nested-quote issues with paths containing spaces.
  const taskName = "GameServumAgentUpdate";
  const psCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`;

  try {
    // Create a one-time scheduled task running as SYSTEM
    execFileSync(
      "schtasks",
      [
        "/create",
        "/tn",
        taskName,
        "/tr",
        psCommand,
        "/sc",
        "once",
        "/st",
        "00:00",
        "/ru",
        "SYSTEM",
        "/f",
      ],
      { stdio: "ignore", windowsHide: true },
    );

    // Run the task immediately
    execFileSync("schtasks", ["/run", "/tn", taskName], {
      stdio: "ignore",
      windowsHide: true,
    });

    logger.info(
      "[AgentUpdater] Update task scheduled and started via schtasks",
    );
  } catch (err) {
    logger.error("[AgentUpdater] Failed to schedule update task:", {
      error: (err as Error).message,
    });
    throw new Error(`Failed to schedule update: ${(err as Error).message}`);
  }

  // Reset state — the service will be restarted by the PS script
  updateState.downloaded = false;
  updateState.updateAvailable = false;
  updateState.downloadProgress = undefined;
  persistState();
}

/**
 * Start periodic update checks.
 * @param intervalHours - Check interval in hours (default: 4)
 */
export function startAutoUpdateCheck(intervalHours = 4): void {
  stopAutoUpdateCheck();

  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Initial check after 30 seconds
  setTimeout(() => {
    checkForUpdates().catch(() => {});
  }, 30_000);

  autoCheckTimer = setInterval(() => {
    checkForUpdates().catch(() => {});
  }, intervalMs);

  logger.info("[AgentUpdater] Auto-update check started", {
    intervalHours,
  });
}

/**
 * Stop periodic update checks.
 */
export function stopAutoUpdateCheck(): void {
  if (autoCheckTimer) {
    clearInterval(autoCheckTimer);
    autoCheckTimer = null;
  }
}

// Load persisted state on module init
loadPersistedState();
