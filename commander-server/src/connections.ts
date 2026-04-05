import fs from "fs";
import path from "path";
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
