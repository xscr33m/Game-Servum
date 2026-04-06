/**
 * Agent WebSocket Proxy — Bridges browser ↔ Agent WebSocket connections.
 *
 * Path:  /commander/agent-ws/:connectionId?token=<agentJwt>
 * Auth:  Requires valid commander session cookie on the HTTP upgrade request.
 *
 * Flow:
 *  1. Browser upgrades to WS at Commander (trusted TLS)
 *  2. Commander opens a second WS to the Agent (self-signed cert OK)
 *  3. Messages are piped bidirectionally
 */

import { IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { getConnectionById } from "./connections.js";
import { verifySessionToken } from "./auth.js";

// Parse cookies from raw header string
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) cookies[name.trim()] = rest.join("=").trim();
  }
  return cookies;
}

/**
 * Sets up the WebSocket proxy on the given HTTP server.
 * Call once after server.listen().
 */
export function setupAgentWsProxy(server: import("http").Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", "http://localhost");

    // Only handle /commander/agent-ws/:connectionId
    const match = url.pathname.match(/^\/commander\/agent-ws\/([^/]+)$/);
    if (!match) return; // Let other upgrade handlers (if any) handle it

    const connectionId = match[1];

    // ── Authenticate commander session ──
    const cookieHeader = req.headers.cookie || "";
    const cookies = parseCookies(cookieHeader);
    const sessionToken = cookies["commander_session"];

    if (!sessionToken || !verifySessionToken(sessionToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // ── Resolve Agent connection ──
    const connection = getConnectionById(connectionId);
    if (!connection) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // ── Extract Agent JWT from query params ──
    const agentToken = url.searchParams.get("token") || "";

    // ── Build Agent WS URL ──
    const agentUrl = new URL(connection.url);
    const wsProtocol = agentUrl.protocol === "https:" ? "wss:" : "ws:";
    const agentWsUrl = `${wsProtocol}//${agentUrl.host}/ws${agentToken ? `?token=${agentToken}` : ""}`;

    // ── Accept browser WS ──
    wss.handleUpgrade(req, socket, head, (browserWs) => {
      // ── Connect to Agent WS ──
      const agentWs = new WebSocket(agentWsUrl, {
        // Accept self-signed Agent certificates
        rejectUnauthorized: false,
      });

      let agentReady = false;
      const pendingMessages: string[] = [];

      agentWs.on("open", () => {
        agentReady = true;
        // Flush any messages that arrived before Agent WS was ready
        for (const msg of pendingMessages) {
          agentWs.send(msg);
        }
        pendingMessages.length = 0;
      });

      // Browser → Agent
      browserWs.on("message", (data) => {
        const msg = typeof data === "string" ? data : data.toString();
        if (agentReady && agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(msg);
        } else {
          pendingMessages.push(msg);
        }
      });

      // Agent → Browser
      agentWs.on("message", (data) => {
        if (browserWs.readyState === WebSocket.OPEN) {
          const msg = typeof data === "string" ? data : data.toString();
          browserWs.send(msg);
        }
      });

      // Close propagation
      browserWs.on("close", () => {
        if (agentWs.readyState === WebSocket.OPEN) agentWs.close();
      });

      agentWs.on("close", () => {
        if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
      });

      // Error handling
      browserWs.on("error", (err) => {
        console.error(
          `[WsProxy] Browser WS error (${connectionId}):`,
          err.message,
        );
        if (agentWs.readyState === WebSocket.OPEN) agentWs.close();
      });

      agentWs.on("error", (err) => {
        console.error(
          `[WsProxy] Agent WS error (${connectionId}):`,
          err.message,
        );
        if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
      });
    });
  });
}
