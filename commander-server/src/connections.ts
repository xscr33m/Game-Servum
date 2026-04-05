import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { URL } from "url";
import { Router } from "express";
import { requireSession } from "./middleware.js";

const DATA_PATH = process.env.DATA_PATH || "./data";
const CONNECTIONS_FILE = path.join(DATA_PATH, "connections.json");

// ── Connection type (mirrors client's BackendConnection, stored fields only) ──

interface StoredConnection {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  password: string;
  isActive: boolean;
  status?: string;
  statusUpdatedAt?: number;
  agentInfo?: {
    version: string;
    hostname: string;
    platform: string;
    serverCount: number;
    compatibilityWarning?: string;
  };
}

// ── Persistence ──

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }
}

function loadConnections(): StoredConnection[] {
  try {
    if (!fs.existsSync(CONNECTIONS_FILE)) return [];
    const raw = fs.readFileSync(CONNECTIONS_FILE, "utf-8");
    return JSON.parse(raw) as StoredConnection[];
  } catch (err) {
    console.error("[Connections] Failed to load connections:", err);
    return [];
  }
}

function saveConnections(connections: StoredConnection[]): void {
  ensureDataDir();
  fs.writeFileSync(
    CONNECTIONS_FILE,
    JSON.stringify(connections, null, 2),
    "utf-8",
  );
}

/**
 * Strip sensitive session data before storing.
 * Matches the client's stripSensitiveSessionData() behavior.
 */
function stripSessionData(connections: StoredConnection[]): StoredConnection[] {
  return connections.map((conn) => {
    // Remove any session tokens that the frontend might include
    const {
      sessionToken: _st,
      tokenExpiresAt: _te,
      reconnectAttempts: _ra,
      lastError: _le,
      ...rest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } = conn as any;

    // Persist "updating" / "restarting" status (matches client behavior)
    if (conn.status === "updating" || conn.status === "restarting") {
      return {
        ...rest,
        status: conn.status,
        statusUpdatedAt: conn.statusUpdatedAt,
      };
    }

    // Strip transient statuses
    const { status: _s, statusUpdatedAt: _su, ...clean } = rest;
    return clean as StoredConnection;
  });
}

// ── Router ──

export const connectionsRouter = Router();

/**
 * Look up a stored connection by its ID.
 * Used by the agent proxy to resolve target Agent URLs.
 */
export function getConnectionById(id: string): StoredConnection | undefined {
  const connections = loadConnections();
  return connections.find((c) => c.id === id);
}

// All routes require an authenticated session
connectionsRouter.use(requireSession);

// GET /commander/api/connections — Return all stored connections
connectionsRouter.get("/", (_req, res) => {
  const connections = loadConnections();
  res.json(connections);
});

// PUT /commander/api/connections — Replace all connections (full sync)
connectionsRouter.put("/", (req, res) => {
  const connections = req.body;
  if (!Array.isArray(connections)) {
    res.status(400).json({ success: false, message: "Expected array" });
    return;
  }
  const cleaned = stripSessionData(connections);
  saveConnections(cleaned);
  res.json({ success: true });
});

// DELETE /commander/api/connections — Clear all connections
connectionsRouter.delete("/", (_req, res) => {
  saveConnections([]);
  res.json({ success: true });
});

// ── Agent Fetch Utility ──

interface AgentFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface AgentFetchResult {
  status: number;
  body: string;
}

/**
 * Make an HTTP(S) request to an Agent, accepting self-signed certificates.
 * Used by the test-connection endpoint to verify Agent connectivity server-side.
 */
function agentFetch(
  url: string,
  options?: AgentFetchOptions,
): Promise<AgentFetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      method: options?.method || "GET",
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: options?.headers || {},
      timeout: 10000,
    };

    if (isHttps) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reqOptions as any).rejectUnauthorized = false;
    }

    const req = transport.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (options?.body) req.write(options.body);
    req.end();
  });
}

// POST /commander/api/connections/test-connection — Test Agent connectivity server-side
// Used during onboarding in web/Docker mode where the browser cannot directly reach the Agent.
connectionsRouter.post("/test-connection", async (req, res) => {
  const { url, apiKey, password } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ success: false, message: "URL is required" });
    return;
  }

  const baseUrl = url.replace(/\/+$/, "");

  try {
    // 1. Health check
    const healthRes = await agentFetch(`${baseUrl}/api/v1/health`);
    if (healthRes.status !== 200) {
      res.status(502).json({
        success: false,
        message: "Agent not reachable",
        step: "health",
      });
      return;
    }

    // 2. Get agent info
    const infoRes = await agentFetch(`${baseUrl}/api/v1/info`);
    let info: Record<string, unknown> = {};
    try {
      info = JSON.parse(infoRes.body);
    } catch {
      /* ignore parse errors */
    }

    // 3. Authenticate (if credentials provided)
    let auth: Record<string, unknown> | null = null;
    if (apiKey && password) {
      const authRes = await agentFetch(`${baseUrl}/api/v1/auth/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, password }),
      });

      if (authRes.status !== 200) {
        res.status(401).json({
          success: false,
          message: "Authentication failed — invalid credentials",
          step: "auth",
        });
        return;
      }

      try {
        auth = JSON.parse(authRes.body);
      } catch {
        /* ignore parse errors */
      }
    }

    res.json({ success: true, info, auth });
  } catch (err) {
    console.error(
      "[Connections] test-connection failed:",
      (err as Error).message,
    );
    res.status(502).json({
      success: false,
      message: "Cannot reach agent",
      details: (err as Error).message,
    });
  }
});
