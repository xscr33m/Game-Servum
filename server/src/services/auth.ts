import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { getConfig } from "./config.js";
import { logger } from "../index.js";
import type { AppConfig } from "../types/index.js";
import {
  findApiKeyByHash,
  createApiKey,
  updateKeyLastUsed,
  getApiKeyCount,
} from "../db/index.js";

// ── Hashing ──

export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Simple password hashing using PBKDF2 (no external dependency needed).
 * Format: salt:hash
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const computedHash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computedHash));
}

// ── JWT ──

export interface SessionPayload {
  keyId: number;
  name: string;
}

export function createSessionToken(payload: SessionPayload): string {
  const config = getConfig();
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "24h" });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const config = getConfig();
    const payload = jwt.verify(token, config.jwtSecret) as SessionPayload;
    return payload;
  } catch {
    return null;
  }
}

// ── Key Generation ──

export interface GeneratedCredentials {
  apiKey: string;
  password: string;
}

/**
 * Generate a new API-Key + Password pair.
 * Returns the plaintext values (shown once to the user).
 * Stores hashed versions in the DB.
 */
export function generateCredentials(
  name: string = "Default",
): GeneratedCredentials {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const password = generateReadablePassword(16);

  const keyHash = sha256(apiKey);
  const passwordHash = hashPassword(password);

  createApiKey(keyHash, passwordHash, name);

  return { apiKey, password };
}

/**
 * Generates a readable random password with mixed character types.
 */
function generateReadablePassword(length: number): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let result = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// ── First-Start Setup ──

/**
 * Check if this is the first start (no API keys exist).
 * If so, generate initial credentials and display them in the console.
 */
export function ensureInitialCredentials(): void {
  const config = getConfig();
  if (!config.authEnabled) return;

  const keyCount = getApiKeyCount();
  if (keyCount > 0) return;

  logger.info(
    "[Auth] First start detected — generating initial credentials...",
  );
  const { apiKey, password } = generateCredentials("Initial Key");

  // Write credentials to file so the user can retrieve them
  writeCredentialsFile(apiKey, password, config);
}

/**
 * Write credentials to a CREDENTIALS.txt file in the data directory.
 * This file is created on first start so the user can connect a Dashboard.
 */
function writeCredentialsFile(
  apiKey: string,
  password: string,
  config: AppConfig,
): void {
  const host = config.host === "0.0.0.0" ? "<SERVER-IP>" : config.host;
  const content = `════════════════════════════════════════════════════════════════
  GAME SERVUM — AGENT CREDENTIALS
════════════════════════════════════════════════════════════════

Generated: ${new Date().toLocaleString()}

Use these credentials to connect a Game Servum Dashboard
to this Agent.

  API-Key:    ${apiKey}
  Password:   ${password}

  Agent URL:  http://${host}:${config.port}

────────────────────────────────────────────────────────────────
  IMPORTANT:
  • Keep this file safe — credentials cannot be recovered.
  • Delete this file after saving the credentials elsewhere.
────────────────────────────────────────────────────────────────
`;

  try {
    const filePath = path.join(config.dataPath, "CREDENTIALS.txt");
    fs.writeFileSync(filePath, content, "utf-8");
    logger.info(`[Auth] Credentials written to: ${filePath}`);
  } catch (err) {
    logger.error("[Auth] Failed to write credentials file:", err);
  }
}

/**
 * Authenticate with API-Key + Password.
 * Returns a JWT session token on success, null on failure.
 */
export function authenticate(apiKey: string, password: string): string | null {
  const keyHash = sha256(apiKey);
  const keyRecord = findApiKeyByHash(keyHash);

  if (!keyRecord || !keyRecord.isActive) return null;

  if (!verifyPassword(password, keyRecord.passwordHash)) return null;

  // Update last_used_at
  updateKeyLastUsed(keyRecord.id);

  // Generate session token
  return createSessionToken({ keyId: keyRecord.id, name: keyRecord.name });
}
