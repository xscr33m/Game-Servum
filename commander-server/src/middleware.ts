import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "./auth.js";

/**
 * Express middleware that requires a valid session cookie.
 * Reads the JWT from the "commander_session" HTTP-only cookie.
 */
export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = req.cookies?.commander_session;
  if (!token) {
    res.status(401).json({ success: false, message: "Not authenticated" });
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    res
      .status(401)
      .json({ success: false, message: "Invalid or expired session" });
    return;
  }

  next();
}
