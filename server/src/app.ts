import express from "express";
import path from "path";
import os from "os";
import cors from "cors";
import {
  APP_VERSION,
  API_VERSION,
  MIN_COMPATIBLE_AGENT_VERSION,
} from "@game-servum/shared";
import { steamcmdRouter } from "./routes/steamcmd.js";
import { serversRouter } from "./routes/servers.js";
import { systemRouter } from "./routes/system.js";
import { authRouter } from "./routes/auth.js";
import logsRouter from "./routes/logs.js";
import { agentAuth } from "./middleware/auth.js";
import { getConfig } from "./services/config.js";
import { logger } from "./index.js";

const app = express();
const config = getConfig();

// CORS — konfigurierbar via Env-Vars
const corsOptions: cors.CorsOptions = {
  origin:
    config.corsOrigins === "*"
      ? true // Alle Origins erlauben (Entwicklung / lokaler Modus)
      : config.corsOrigins.split(",").map((o) => o.trim()),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

// Public endpoints (no auth required)
app.get("/api/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    version: APP_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1/info", (_req, res) => {
  res.json({
    name: "Game-Servum Agent",
    version: APP_VERSION,
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    nodeVersion: process.version,
    apiVersion: API_VERSION,
    minCompatibleVersion: MIN_COMPATIBLE_AGENT_VERSION,
    requiresAuth: config.authEnabled,
    features: ["steamcmd", "mods", "rcon", "player-tracking", "scheduler"],
  });
});

// Agent Status Page (localhost only, no auth required)
app.get("/", (req, res, next) => {
  // Security: Only allow access from localhost
  const clientIp =
    req.ip || req.socket.remoteAddress || req.connection.remoteAddress || "";
  const isLocalhost =
    clientIp === "127.0.0.1" ||
    clientIp === "::1" ||
    clientIp === "::ffff:127.0.0.1" ||
    clientIp.startsWith("127.") ||
    clientIp === "localhost";

  if (!isLocalhost) {
    logger.warn("[Status Page] Access denied from non-localhost IP", {
      ip: clientIp,
    });
    return res.status(403).json({ error: "Access denied" });
  }

  // Generate status HTML page
  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  const uptimeSeconds = Math.floor(uptime % 60);
  const uptimeDisplay = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game-Servum Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: hsl(0 0% 6%);
      color: hsl(0 0% 90%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 2rem 1rem;
    }
    
    .container {
      max-width: 600px;
      margin: auto;
      width: 100%;
    }
    
    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    
    .logo {
      width: 4rem;
      height: 4rem;
      margin: 0 auto 1rem;
      border-radius: 0.75rem;
      box-shadow: 0 4px 16px hsla(22 89% 65% / 0.3);
    }
    
    .logo img { width: 100%; height: 100%; object-fit: contain; }
    
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.25rem; }
    .version { color: hsl(0 0% 55%); font-size: 0.875rem; margin-bottom: 0.75rem; }
    
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: hsla(22 89% 65% / 0.15);
      border: 1px solid hsla(22 89% 65% / 0.4);
      border-radius: 1.5rem;
      font-size: 0.8125rem;
      font-weight: 600;
      color: hsl(22 89% 65%);
    }
    
    .status::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      background: hsl(22 89% 65%);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    
    ${
      !config.authEnabled
        ? `
    .warning {
      padding: 0.875rem 1rem;
      margin-bottom: 1.5rem;
      background: hsla(0 63% 50% / 0.1);
      border: 1px solid hsla(0 63% 50% / 0.35);
      border-radius: 0.5rem;
      font-size: 0.875rem;
      color: hsl(0 70% 80%);
    }
    `
        : ""
    }
    
    .info {
      background: hsl(0 0% 10%);
      border: 1px solid hsl(0 0% 16%);
      border-radius: 0.5rem;
      padding: 1.25rem;
      margin-bottom: 2rem;
    }
    
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.625rem 0;
      border-bottom: 1px solid hsl(0 0% 14%);
    }
    
    .info-row:last-child { border-bottom: none; }
    
    .info-label { color: hsl(0 0% 55%); font-size: 0.875rem; }
    .info-value { font-weight: 600; font-size: 0.875rem; }
    
    footer {
      text-align: center;
      font-size: 0.8125rem;
      color: hsl(0 0% 50%);
      padding-top: 1rem;
      border-top: 1px solid hsl(0 0% 14%);
    }
    
    footer a {
      color: hsl(22, 89%, 65%);
      text-decoration: none;
      font-weight: 500;
    }
    
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <img src="https://game-servum.com/logos/agent-icon.webp" alt="Game-Servum Agent">
      </div>
      <h1>Game-Servum Agent</h1>
      <div class="version">v${APP_VERSION}</div>
      <div class="status">Operational</div>
    </div>
    
    ${!config.authEnabled ? `<div class="warning">⚠️ <strong>Authentication disabled</strong> — Enable AUTH_ENABLED in .env for production</div>` : ""}
    
    <div class="info">
      <div class="info-row">
        <span class="info-label">API Version</span>
        <span class="info-value">${API_VERSION}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Uptime</span>
        <span class="info-value">${uptimeDisplay}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Port</span>
        <span class="info-value">${config.port}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Authentication</span>
        <span class="info-value" style="color: ${config.authEnabled ? "hsl(22 89% 65%)" : "hsl(0 63% 55%)"}">${config.authEnabled ? "Enabled" : "Disabled"}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Hostname</span>
        <span class="info-value">${os.hostname()}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Platform</span>
        <span class="info-value">${process.platform} • ${os.arch()}</span>
      </div>
    </div>
    
    <footer>
      Localhost only • 
      <a href="https://game-servum.com" target="_blank">Website</a> • 
      <a href="https://github.com/xscr33m/Game-Servum" target="_blank">GitHub</a>
    </footer>
  </div>
</body>
</html>`;

  res.send(html);
});

// Auth routes (connect endpoint is public, key management requires auth)
app.use("/api/v1/auth", authRouter);

// Auth middleware — protects all routes below
app.use("/api", agentAuth);

// API v1 routes
app.use("/api/v1/steamcmd", steamcmdRouter);
app.use("/api/v1/servers", serversRouter);
app.use("/api/v1/system", systemRouter);
app.use("/api/v1/logs", logsRouter);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  },
);

export { app };
