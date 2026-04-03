import { createServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { app } from "./app.js";
import { initDatabase } from "./db/index.js";
import { getConfig } from "./services/config.js";
import {
  ensureInitialCredentials,
  verifySessionToken,
} from "./services/auth.js";
import { spawn } from "child_process";
import {
  restoreServerStates,
  shutdownAllServers,
  getRunningServerIds,
} from "./services/serverProcess.js";
import { initializeSchedules } from "./services/scheduler.js";
import { initializeMessageBroadcasters } from "./services/messageBroadcaster.js";
import {
  startAutoUpdateCheck,
  stopAutoUpdateCheck,
} from "./services/agentUpdater.js";
import {
  startMetricsCollection,
  stopMetricsCollection,
} from "./services/systemMonitor.js";
import { setAppSetting } from "./db/index.js";
import { logger } from "./core/logger.js";
import {
  broadcast,
  addClient,
  removeClient,
  getAllClients,
  getClientCount,
} from "./core/broadcast.js";

export { logger, broadcast };

const config = getConfig();

async function main() {
  logger.info("[Server] Starting server...", {
    mode: "standalone (Agent)",
    port: config.port,
    authEnabled: config.authEnabled,
  });

  // Initialize database
  await initDatabase();
  logger.info("[Server] Database initialized");

  // Generate initial credentials on first start (if auth enabled)
  ensureInitialCredentials();

  // Restore server states (check if any servers were running before restart)
  restoreServerStates();

  // Initialize scheduled restarts
  initializeSchedules();

  // Initialize scheduled RCON message broadcasters
  initializeMessageBroadcasters();

  // Start periodic agent update checks (every 4 hours)
  startAutoUpdateCheck(4);

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket server with auth verification
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: (info: { req: IncomingMessage }, callback) => {
      if (!config.authEnabled) {
        callback(true);
        return;
      }

      // Extract token from query string
      const url = new URL(
        info.req.url || "",
        `http://${info.req.headers.host}`,
      );
      const token = url.searchParams.get("token");

      if (!token) {
        callback(false, 401, "Authentication required");
        return;
      }

      const payload = verifySessionToken(token);
      if (!payload) {
        callback(false, 401, "Invalid or expired session token");
        return;
      }

      // Attach session to request for later use
      (info.req as any).agentSession = payload;
      callback(true);
    },
  });

  wss.on("connection", (ws: WebSocket) => {
    logger.debug("[WebSocket] Client connected");
    addClient(ws);

    // Start metrics collection when first client connects
    if (getClientCount() === 1) {
      startMetricsCollection();
    }

    ws.on("close", () => {
      logger.debug("[WebSocket] Client disconnected");
      removeClient(ws);

      // Stop metrics collection when last client disconnects
      if (getClientCount() === 0) {
        stopMetricsCollection();
      }
    });

    ws.on("error", (error: Error) => {
      logger.error("[WebSocket] Client error", error);
      removeClient(ws);

      // Stop metrics collection when last client disconnects
      if (getClientCount() === 0) {
        stopMetricsCollection();
      }
    });
  });

  // Start server
  server.listen(config.port, config.host, () => {
    logger.info("[Server] HTTP and WebSocket server listening", {
      http: `http://${config.host}:${config.port}`,
      websocket: `ws://${config.host}:${config.port}/ws`,
      auth: config.authEnabled ? "enabled" : "disabled",
    });

    // Also print to console for visibility
    logger.info(`
╔════════════════════════════════════════
║         Game-Servum Agent              
╠════════════════════════════════════════
║  HTTP:      http://${config.host}:${config.port}      
║  WebSocket: ws://${config.host}:${config.port}/ws     
║  Auth:      ${config.authEnabled ? "enabled " : "disabled"}
╚════════════════════════════════════════
    `);
  });

  // Graceful shutdown handler
  async function gracefulShutdown(signal: string) {
    logger.info(`[Shutdown] Received ${signal}, shutting down gracefully...`);

    const isRestart = (process as any).__gameServumRestart === true;
    if (isRestart) {
      logger.info(
        "[Shutdown] This is a restart — will trigger service restart",
      );
    }

    // Stop periodic update checks
    stopAutoUpdateCheck();

    // Before stopping servers: if this is a restart, remember which servers
    // were running so they can be auto-started after the agent comes back.
    if (isRestart) {
      const runningIds = getRunningServerIds();
      if (runningIds.length > 0) {
        setAppSetting("pending_restart_servers", JSON.stringify(runningIds));
        logger.info(
          `[Shutdown] Persisted ${runningIds.length} running server(s) for auto-restart: [${runningIds.join(", ")}]`,
        );
      }
    }

    // Stop all running game servers
    await shutdownAllServers();

    // Close WebSocket connections
    for (const client of getAllClients()) {
      client.close();
    }

    // Close WebSocket server first — it shares the HTTP server and
    // prevents server.close() from completing while it's still attached
    await new Promise<void>((resolve) => {
      wss.close(() => {
        logger.info("[Shutdown] WebSocket server closed");
        resolve();
      });
    });

    // Close HTTP server (releases the port)
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info("[Shutdown] HTTP server closed");
        resolve();
      });
    });

    // Shutdown logger (flush remaining buffer)
    logger.shutdown();

    // For restart: on Windows, use sc.exe to restart the service.
    // In dev mode, just exit and let the developer restart manually.
    if (isRestart) {
      const scriptPath = process.argv[1] || "";
      const isDevMode = scriptPath.endsWith(".ts");

      if (isDevMode) {
        logger.info(
          "[Shutdown] Dev mode — skipping service restart (restart manually)",
        );
      } else if (process.platform === "win32") {
        // Spawn detached sc.exe to restart the service after we exit
        try {
          const child = spawn(
            "cmd.exe",
            ["/c", "timeout /t 5 /nobreak >nul && sc start GameServumAgent"],
            { detached: true, stdio: "ignore", windowsHide: true },
          );
          child.unref();
          logger.info("[Shutdown] Service restart scheduled via sc.exe");
        } catch (err) {
          logger.error("[Shutdown] Failed to schedule service restart", err);
        }
      }
    }

    process.exit(0);
  }

  // Handle termination signals
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

main().catch((err) => logger.error("[Server] Fatal error:", err));
