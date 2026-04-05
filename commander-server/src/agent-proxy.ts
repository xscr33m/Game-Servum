/**
 * Agent Proxy — Forwards HTTP requests from the browser to Agent backends.
 *
 * In Docker/web mode the Commander runs on a public domain (e.g. xl.game-servum.com)
 * while Agents are on private networks with self-signed TLS certificates.
 * Browsers block these cross-origin private-network requests (PNA, mixed content).
 *
 * This proxy solves the problem: the browser only talks to the Commander
 * (trusted cert), and the Commander forwards requests to Agents server-side
 * where self-signed certs and private IPs are not an issue.
 *
 * Routes:  /commander/agent-proxy/:connectionId/<path>
 * Auth:    Requires valid commander session cookie
 */

import { Router } from "express";
import https from "https";
import http from "http";
import { URL } from "url";
import { requireSession } from "./middleware.js";
import { getConnectionById } from "./connections.js";

export const agentProxyRouter = Router();

// All proxy routes require an authenticated commander session
agentProxyRouter.use(requireSession);

// Hop-by-hop headers that must not be forwarded
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "cookie",
]);

agentProxyRouter.all("/:connectionId/*", (req, res) => {
  const { connectionId } = req.params;
  const connection = getConnectionById(connectionId);

  if (!connection) {
    res.status(404).json({ success: false, message: "Connection not found" });
    return;
  }

  // Build target URL:  connection.url + /<rest-of-path>?<query>
  // Express 5 stores the wildcard capture in req.params[0] as string[]
  const wildcard = (req.params as Record<string, unknown>)[0];
  const restPath = Array.isArray(wildcard)
    ? wildcard.join("/")
    : String(wildcard || "");
  const targetUrl = new URL(restPath, connection.url.replace(/\/$/, "") + "/");

  // Forward original query string
  const qs = new URL(req.url, "http://localhost").search;
  if (qs) targetUrl.search = qs;

  // Build forwarded headers (strip hop-by-hop + cookie)
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (typeof value === "string") forwardHeaders[key] = value;
  }
  forwardHeaders["host"] = targetUrl.host;

  const isHttps = targetUrl.protocol === "https:";
  const transport = isHttps ? https : http;

  const options: https.RequestOptions = {
    method: req.method,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    headers: forwardHeaders,
  };

  // Accept self-signed Agent certificates
  if (isHttps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (options as any).rejectUnauthorized = false;
  }

  const proxyReq = transport.request(options, (proxyRes) => {
    // Forward status code
    res.status(proxyRes.statusCode ?? 502);

    // Forward response headers (strip hop-by-hop)
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (value !== undefined) res.setHeader(key, value);
    }

    // Pipe response body
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(
      `[AgentProxy] Request failed for ${connectionId}:`,
      err.message,
    );
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        message: "Agent unreachable",
      });
    }
  });

  // Forward request body (raw from express.raw middleware)
  if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
    proxyReq.write(req.body);
  }
  proxyReq.end();
});
