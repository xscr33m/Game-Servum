import https from "https";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import AdmZip from "adm-zip";
import { getConfig, getSteamCMDExecutable } from "./config.js";
import { broadcast, logger } from "../index.js";
import { updateSteamConfig, getSteamConfig } from "../db/index.js";

const STEAMCMD_URL =
  "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

// Active SteamCMD process for login
let activeSteamCMDProcess: ChildProcess | null = null;
let loginState: "idle" | "started" | "awaiting_guard" | "success" | "failed" =
  "idle";
let currentUsername: string | null = null;
let currentPassword: string | null = null;
let accumulatedOutput: string = "";

/**
 * Clean raw SteamCMD output — strip carriage returns, trailing whitespace,
 * collapse blank-line runs, and skip internal noise lines.
 */
function cleanSteamOutput(raw: string): string[] {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      if (l === "") return false;
      // Filter out SteamCMD progress spinner characters and empty bracket lines
      if (/^\s*[\\/|\\-]+\s*$/.test(l)) return false;
      return true;
    });
  return lines;
}

export function getLoginState() {
  return { state: loginState, username: currentUsername };
}

/**
 * Logout from Steam - reset to anonymous mode
 */
export function logout(): { success: boolean; message: string } {
  // Kill any active process
  if (activeSteamCMDProcess) {
    activeSteamCMDProcess.kill();
    activeSteamCMDProcess = null;
  }

  // Reset state
  loginState = "idle";
  currentUsername = null;
  currentPassword = null;
  accumulatedOutput = "";

  // Update database
  updateSteamConfig(null, false);

  broadcast("steamcmd:logout", { message: "Logged out from Steam" });

  return {
    success: true,
    message: "Successfully logged out. Now using anonymous mode.",
  };
}

export async function downloadSteamCMD(): Promise<void> {
  const config = getConfig();
  const zipPath = path.join(config.steamcmdPath, "steamcmd.zip");

  // Ensure steamcmd directory exists
  if (!fs.existsSync(config.steamcmdPath)) {
    fs.mkdirSync(config.steamcmdPath, { recursive: true });
  }

  broadcast("steamcmd:output", { message: "Downloading SteamCMD..." });

  // Download the zip file
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);

    https
      .get(STEAMCMD_URL, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          https
            .get(response.headers.location!, (redirectResponse) => {
              redirectResponse.pipe(file);
              file.on("finish", () => {
                file.close();
                resolve();
              });
            })
            .on("error", reject);
        } else {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        }
      })
      .on("error", (err) => {
        fs.unlink(zipPath, () => {}); // Delete the file on error
        reject(err);
      });
  });

  broadcast("steamcmd:output", { message: "Download complete. Extracting..." });

  // Extract the zip file
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(config.steamcmdPath, true);

  // Clean up zip file
  fs.unlinkSync(zipPath);

  broadcast("steamcmd:output", {
    message: "Extracted. Running first-time setup (this may take a moment)...",
  });

  // Run steamcmd +quit to trigger self-update / first-time initialization.
  // SteamCMD downloads its runtime files on first launch.
  // Exit code 7 means it updated itself and needs to restart — we retry once.
  const executable = getSteamCMDExecutable();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const proc = spawn(executable, ["+quit"], {
        cwd: path.dirname(executable),
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (data: Buffer) => {
        const lines = cleanSteamOutput(data.toString());
        for (const line of lines) {
          broadcast("steamcmd:output", { message: line });
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          logger.error("[SteamCMD] Setup stderr:", text);
        }
      });

      proc.on("close", (code) => {
        resolve(code ?? 1);
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to run SteamCMD: ${err.message}`));
      });
    });

    if (exitCode === 0) {
      broadcast("steamcmd:output", {
        message: "SteamCMD installed successfully!",
      });
      return;
    }

    if (exitCode === 7 && attempt < maxAttempts) {
      broadcast("steamcmd:output", {
        message: `SteamCMD is updating itself (attempt ${attempt}/${maxAttempts})...`,
      });
      continue;
    }

    // Non-zero exit but not a retriable code — still consider it installed
    // since SteamCMD often exits with odd codes after a successful self-update
    logger.warn(
      `[SteamCMD] Setup exited with code ${exitCode} on attempt ${attempt}`,
    );
    broadcast("steamcmd:output", {
      message: "SteamCMD installed successfully!",
    });
    return;
  }
}

/**
 * Run SteamCMD with given commands (generic helper)
 */
function runSteamCMD(args: string[]): ChildProcess {
  const executable = getSteamCMDExecutable();

  const proc = spawn(executable, args, {
    cwd: path.dirname(executable),
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (data: Buffer) => {
    const lines = cleanSteamOutput(data.toString());
    for (const line of lines) {
      broadcast("steamcmd:output", { message: line });
    }
  });

  // stderr — only forward if it contains real content
  proc.stderr?.on("data", (data: Buffer) => {
    const lines = cleanSteamOutput(data.toString());
    for (const line of lines) {
      broadcast("steamcmd:output", { message: `[ERROR] ${line}` });
    }
  });

  return proc;
}

/**
 * Start Steam login process — COMMAND LINE mode.
 *
 * Approach: `steamcmd +login <user> <pass> [guard] +quit`
 *
 * IMPORTANT: On Windows, when Steam Guard is required, SteamCMD prints
 * "Steam Guard code:" and blocks on stdin BEFORE processing the +quit.
 * This prompt does NOT appear on stdout/stderr — it only appears in
 * SteamCMD's own `logs/console_log.txt`. We poll that log file to:
 *   1. Stream output to the client in real-time
 *   2. Detect Steam Guard prompts immediately
 *
 * stdout/stderr are logged server-side only (they also duplicate each
 * other, so broadcasting from both causes every line to appear twice).
 */
export async function startLogin(
  username: string,
  password?: string,
  guardCode?: string,
): Promise<{
  success: boolean;
  needsGuard?: boolean;
  needsPassword?: boolean;
  message: string;
}> {
  // Kill any existing process
  if (activeSteamCMDProcess) {
    activeSteamCMDProcess.kill();
    activeSteamCMDProcess = null;
  }

  // Store credentials for potential guard code retry
  currentUsername = username;
  currentPassword = password ?? null;
  accumulatedOutput = "";
  loginState = "started";

  const executable = getSteamCMDExecutable();
  const config = getConfig();
  const logFile = path.join(config.steamcmdPath, "logs", "console_log.txt");

  // Build login args based on what credentials we have
  let loginArgs: string[];
  if (guardCode && password) {
    loginArgs = ["+login", username, password, guardCode, "+quit"];
  } else if (password) {
    loginArgs = ["+login", username, password, "+quit"];
  } else {
    // Try cached credentials — just username
    loginArgs = ["+login", username, "+quit"];
  }

  broadcast("steamcmd:output", {
    message: `Logging in as ${username}${!password ? " (cached credentials)..." : "..."}`,
  });

  return new Promise((resolve) => {
    let resolved = false;
    let logPollInterval: ReturnType<typeof setInterval> | null = null;
    let lastLogSize = 0;

    // Record initial log file size so we only read new content
    try {
      if (fs.existsSync(logFile)) {
        lastLogSize = fs.statSync(logFile).size;
      }
    } catch {
      // Ignore — file may not exist yet on first run
    }

    const cleanup = () => {
      if (logPollInterval) {
        clearInterval(logPollInterval);
        logPollInterval = null;
      }
    };

    const finish = (result: {
      success: boolean;
      needsGuard?: boolean;
      needsPassword?: boolean;
      message: string;
    }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    /**
     * Read new content appended to console_log.txt since last check.
     * Broadcasts cleaned lines to client and checks for Steam Guard / success markers.
     */
    const readNewLogContent = () => {
      try {
        if (!fs.existsSync(logFile)) return;
        const stat = fs.statSync(logFile);
        if (stat.size <= lastLogSize) return;

        const fd = fs.openSync(logFile, "r");
        const buffer = Buffer.alloc(stat.size - lastLogSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
        fs.closeSync(fd);
        lastLogSize = stat.size;

        const newContent = buffer.toString("utf-8");
        accumulatedOutput += newContent;

        // Strip timestamps like "[2026-02-08 19:18:50] " and broadcast clean lines
        const lines = newContent
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((l) =>
            l
              .replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, "")
              .trimEnd(),
          )
          .filter((l) => l.length > 0);

        for (const line of lines) {
          broadcast("steamcmd:output", { message: line });
        }

        const lower = accumulatedOutput.toLowerCase();

        // ── Check for password requirement (cached credentials not found) ──
        if (
          loginState === "started" &&
          !password &&
          (lower.includes("cached credentials not found") ||
            lower.includes("password:"))
        ) {
          logger.info("[SteamCMD] No cached credentials — password required");
          loginState = "failed";

          // Kill the blocking process
          activeSteamCMDProcess?.kill();
          activeSteamCMDProcess = null;

          broadcast("steamcmd:password-required", {
            message: "No cached credentials found. Please enter your password.",
          });
          finish({
            success: false,
            needsPassword: true,
            message: "No cached credentials found. Please enter your password.",
          });
          return;
        }

        // ── Check for Steam Guard requirement ──
        if (
          loginState === "started" &&
          (lower.includes("steam guard code:") ||
            lower.includes("two-factor code:") ||
            lower.includes("twofactor") ||
            lower.includes("not been authenticated"))
        ) {
          logger.info("[SteamCMD] Steam Guard detected via console_log.txt");
          loginState = "awaiting_guard";

          // Kill the blocking process
          activeSteamCMDProcess?.kill();
          activeSteamCMDProcess = null;

          broadcast("steamcmd:guard-required", {
            message: "Steam Guard code required",
          });
          finish({
            success: false,
            needsGuard: true,
            message:
              "Steam Guard code required. Please enter the code from your email or authenticator app.",
          });
        }
      } catch {
        // Ignore read errors (file locked, etc.)
      }
    };

    // Poll the log file every 300ms (fs.watch is unreliable on Windows for rapid changes)
    logPollInterval = setInterval(readNewLogContent, 300);

    activeSteamCMDProcess = spawn(executable, loginArgs, {
      cwd: path.dirname(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });

    // stdout/stderr — server-side logging only (no broadcast; log file is source of truth)
    activeSteamCMDProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        logger.debug("[SteamCMD] stdout:", text);
      }
    });

    activeSteamCMDProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        logger.error("[SteamCMD] stderr:", text);
      }
    });

    activeSteamCMDProcess.on("close", (code) => {
      logger.info(`[SteamCMD] Process closed with code ${code}`);
      activeSteamCMDProcess = null;

      // Read any remaining log content before evaluating
      readNewLogContent();

      // Already resolved (e.g. Steam Guard detected mid-stream)
      if (resolved) return;

      const lower = accumulatedOutput.toLowerCase();

      // Check for success — "Waiting for user info...OK" is the definitive marker
      if (lower.includes("waiting for user info") && lower.includes("ok")) {
        loginState = "success";
        updateSteamConfig(username, true);
        broadcast("steamcmd:login-success", { username });
        finish({ success: true, message: "Login successful!" });
        return;
      }

      // Check for invalid credentials
      if (
        lower.includes("invalid password") ||
        lower.includes("login failure") ||
        lower.includes("access denied") ||
        lower.includes("invalid login")
      ) {
        loginState = "failed";
        broadcast("steamcmd:login-failed", { message: "Invalid credentials" });
        finish({
          success: false,
          message:
            "Invalid username or password. Please check your credentials.",
        });
        return;
      }

      // Exit code 0 without clear markers — assume success (cached session)
      if (code === 0) {
        loginState = "success";
        updateSteamConfig(username, true);
        broadcast("steamcmd:login-success", { username });
        finish({ success: true, message: "Login successful!" });
        return;
      }

      // Generic failure
      loginState = "failed";
      broadcast("steamcmd:login-failed", { message: "Login failed" });
      finish({
        success: false,
        message: `Login failed (exit code: ${code}).`,
      });
    });

    activeSteamCMDProcess.on("error", (err) => {
      logger.error("[SteamCMD] Process error:", err);
      loginState = "failed";
      activeSteamCMDProcess = null;
      finish({
        success: false,
        message: `Failed to start SteamCMD: ${err.message}`,
      });
    });

    // Safety timeout — 60s is more than enough for a login handshake
    setTimeout(() => {
      if (!resolved) {
        logger.warn("[SteamCMD] Login timeout reached");
        activeSteamCMDProcess?.kill();
        activeSteamCMDProcess = null;
        loginState = "failed";
        finish({
          success: false,
          message: "Login timeout — Steam server may be unavailable.",
        });
      }
    }, 60000);
  });
}

/**
 * Submit Steam Guard code — reruns login with the guard code as third param.
 */
export async function submitGuardCode(
  code: string,
): Promise<{ success: boolean; message: string }> {
  if (!currentUsername) {
    return {
      success: false,
      message: "No active login session. Please login again.",
    };
  }

  if (!currentPassword) {
    return {
      success: false,
      message:
        "Password is required for Steam Guard verification. Please login again.",
    };
  }

  broadcast("steamcmd:output", {
    message: `Submitting Steam Guard code...`,
  });

  const result = await startLogin(currentUsername, currentPassword, code);

  return {
    success: result.success,
    message: result.message,
  };
}

/**
 * Install a game/app using SteamCMD (used by the generic install-app route)
 */
export async function installApp(
  appId: string,
  installDir: string,
  anonymous: boolean = false,
): Promise<{ success: boolean; message: string }> {
  const executable = getSteamCMDExecutable();

  // Prefer DB-stored username over transient in-memory state
  let username: string;
  if (anonymous) {
    username = "anonymous";
  } else {
    const steamConfig = getSteamConfig();
    username =
      steamConfig?.username && steamConfig.isLoggedIn
        ? steamConfig.username
        : currentUsername || "";
  }

  if (!anonymous && !username) {
    return { success: false, message: "Not logged in. Please login first." };
  }

  // Ensure install directory exists
  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true });
  }

  const args = [
    "+force_install_dir",
    installDir,
    "+login",
    username!,
    "+app_update",
    appId,
    "validate",
    "+quit",
  ];

  return new Promise((resolve) => {
    broadcast("steamcmd:output", {
      message: `Installing app ${appId} to ${installDir}...`,
    });

    const proc = spawn(executable, args, {
      cwd: path.dirname(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolved = false;

    proc.stdout?.on("data", (data: Buffer) => {
      const lines = cleanSteamOutput(data.toString());
      for (const line of lines) {
        broadcast("steamcmd:output", { message: line });

        // Parse progress  (e.g. "progress: 45.23 (… / …)")
        const progressMatch = line.match(/progress:\s*([\d.]+)\s*\(/i);
        if (progressMatch) {
          broadcast("steamcmd:progress", {
            percent: Math.round(parseFloat(progressMatch[1])),
          });
        }
      }
    });

    // stderr — only log, don't broadcast (avoids duplicate output)
    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        logger.error(`[SteamCMD] installApp stderr:`, text);
      }
    });

    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        if (code === 0) {
          broadcast("steamcmd:output", {
            message: `App ${appId} installed successfully!`,
          });
          resolve({ success: true, message: "Installation complete" });
        } else {
          resolve({
            success: false,
            message: `Installation failed (exit code: ${code})`,
          });
        }
      }
    });
  });
}
