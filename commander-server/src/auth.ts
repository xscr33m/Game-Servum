import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";

// ── Config ──

const DATA_PATH = process.env.DATA_PATH || "./data";
const ADMIN_FILE = path.join(DATA_PATH, "admin.json");
const JWT_SECRET =
  process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_EXPIRY = "24h";

interface AdminData {
  passwordHash: string;
}

// ── Password Hashing (PBKDF2, same pattern as Agent) ──

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

// ── Admin Data Persistence ──

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }
}

function loadAdminData(): AdminData | null {
  try {
    if (!fs.existsSync(ADMIN_FILE)) return null;
    const raw = fs.readFileSync(ADMIN_FILE, "utf-8");
    return JSON.parse(raw) as AdminData;
  } catch {
    return null;
  }
}

function saveAdminData(data: AdminData): void {
  ensureDataDir();
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// ── Public API ──

/**
 * Check if the admin password has been configured.
 */
export function isConfigured(): boolean {
  return loadAdminData() !== null;
}

/**
 * Set the initial admin password. Only works if not yet configured.
 * If COMMANDER_PASSWORD env var is set, this is called automatically on startup.
 */
export function setupPassword(password: string): boolean {
  if (isConfigured()) return false;
  if (!password || password.length < 8) return false;
  saveAdminData({ passwordHash: hashPassword(password) });
  return true;
}

/**
 * Validate a password against the stored hash.
 */
export function validatePassword(password: string): boolean {
  const data = loadAdminData();
  if (!data) return false;
  return verifyPassword(password, data.passwordHash);
}

/**
 * Change the admin password. Requires the current password for verification.
 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): boolean {
  if (!validatePassword(currentPassword)) return false;
  if (!newPassword || newPassword.length < 8) return false;
  saveAdminData({ passwordHash: hashPassword(newPassword) });
  return true;
}

// ── JWT Session Tokens ──

interface SessionPayload {
  role: string;
}

export function createSessionToken(): string {
  const payload: SessionPayload = { role: "admin" };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_EXPIRY });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

// ── Initialize from env var ──

export function initFromEnv(): void {
  const envPassword = process.env.COMMANDER_PASSWORD;
  if (envPassword && !isConfigured()) {
    if (envPassword.length < 8) {
      console.error("[Auth] COMMANDER_PASSWORD must be at least 8 characters");
      process.exit(1);
    }
    setupPassword(envPassword);
    console.log("[Auth] Admin password set from COMMANDER_PASSWORD env var");
  }
}
