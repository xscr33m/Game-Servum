import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../services/auth.js";
import { getConfig } from "../services/config.js";

const PUBLIC_PATHS = [
  "/api/v1/health",
  "/api/v1/info",
  "/api/v1/auth/connect",
  "/api/v1/auth/refresh",
];

/**
 * Auth middleware — prüft JWT-Session-Token für alle geschützten Endpoints.
 * Wird übersprungen wenn AUTH_ENABLED=false (nur für lokale Entwicklung).
 */
export function agentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const config = getConfig();

  // Auth deaktiviert (nur für lokale Entwicklung)
  if (!config.authEnabled) return next();

  // Öffentliche Endpoints
  if (PUBLIC_PATHS.some((p) => req.path.startsWith(p))) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }

  // Session-Daten an Request anhängen
  (req as any).agentSession = payload;
  next();
}
