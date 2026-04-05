import fs from "fs";
import path from "path";
import { generate } from "selfsigned";
import { getConfig } from "./config.js";
import { getAppSetting, setAppSetting } from "../db/index.js";
import { logger } from "../core/logger.js";

const CERT_FILENAME = "agent.crt";
const KEY_FILENAME = "agent.key";
// Self-signed certs valid for 10 years
const CERT_VALIDITY_DAYS = 3650;

export interface TlsConfig {
  enabled: boolean;
  certPath: string;
  keyPath: string;
  /** True when using auto-generated self-signed certificate */
  selfSigned: boolean;
}

/** Read current TLS settings from DB + file system */
export function getTlsConfig(): TlsConfig {
  const config = getConfig();
  const certDir = config.dataPath;

  const enabled = getAppSetting("tls_enabled") === "true";
  const certPath =
    getAppSetting("tls_cert_path") || path.join(certDir, CERT_FILENAME);
  const keyPath =
    getAppSetting("tls_key_path") || path.join(certDir, KEY_FILENAME);
  const selfSigned = getAppSetting("tls_self_signed") !== "false";

  return { enabled, certPath, keyPath, selfSigned };
}

/** Check whether the configured cert + key files exist and are readable */
export function validateCertFiles(
  certPath: string,
  keyPath: string,
): { valid: boolean; error?: string } {
  try {
    if (!fs.existsSync(certPath)) {
      return { valid: false, error: `Certificate file not found: ${certPath}` };
    }
    if (!fs.existsSync(keyPath)) {
      return { valid: false, error: `Private key file not found: ${keyPath}` };
    }
    // Try reading both files to ensure they are accessible
    fs.readFileSync(certPath);
    fs.readFileSync(keyPath);
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { valid: false, error: `Cannot read certificate files: ${msg}` };
  }
}

/** Generate a self-signed certificate and save it to the data directory */
export async function generateSelfSignedCert(): Promise<{
  certPath: string;
  keyPath: string;
}> {
  const config = getConfig();
  const certPath = path.join(config.dataPath, CERT_FILENAME);
  const keyPath = path.join(config.dataPath, KEY_FILENAME);

  logger.info("[TLS] Generating self-signed certificate...");

  const attrs = [{ name: "commonName", value: "Game-Servum Agent" }];
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + CERT_VALIDITY_DAYS);

  const pems = await generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate,
  });

  // Ensure data directory exists
  fs.mkdirSync(config.dataPath, { recursive: true });

  // Write with restricted permissions (owner-only on Unix)
  fs.writeFileSync(certPath, pems.cert, { mode: 0o644 });
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });

  logger.info("[TLS] Self-signed certificate generated", {
    cert: certPath,
    key: keyPath,
    validityDays: CERT_VALIDITY_DAYS,
  });

  return { certPath, keyPath };
}

/** Enable TLS with self-signed certificate (auto-generates if needed) */
export async function enableTlsSelfSigned(): Promise<TlsConfig> {
  const config = getConfig();
  const certPath = path.join(config.dataPath, CERT_FILENAME);
  const keyPath = path.join(config.dataPath, KEY_FILENAME);

  // Generate cert if it doesn't exist yet
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    await generateSelfSignedCert();
  }

  setAppSetting("tls_enabled", "true");
  setAppSetting("tls_cert_path", certPath);
  setAppSetting("tls_key_path", keyPath);
  setAppSetting("tls_self_signed", "true");

  logger.info("[TLS] TLS enabled with self-signed certificate");

  return { enabled: true, certPath, keyPath, selfSigned: true };
}

/** Enable TLS with user-provided certificate files */
export function enableTlsCustomCert(
  certPath: string,
  keyPath: string,
): TlsConfig {
  const validation = validateCertFiles(certPath, keyPath);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  setAppSetting("tls_enabled", "true");
  setAppSetting("tls_cert_path", certPath);
  setAppSetting("tls_key_path", keyPath);
  setAppSetting("tls_self_signed", "false");

  logger.info("[TLS] TLS enabled with custom certificate", {
    cert: certPath,
    key: keyPath,
  });

  return { enabled: true, certPath, keyPath, selfSigned: false };
}

/** Disable TLS (reverts to plain HTTP) */
export function disableTls(): void {
  setAppSetting("tls_enabled", "false");
  logger.info("[TLS] TLS disabled — agent will use HTTP after restart");
}

/**
 * Initialize TLS on startup.
 * On first run (no DB setting yet), auto-generates a self-signed cert
 * and enables TLS — unless explicitly disabled via TLS_ENABLED=false.
 * Must be called after initDatabase().
 */
export async function initializeTls(): Promise<void> {
  // Env var override: TLS_ENABLED=false skips TLS entirely
  if (process.env.TLS_ENABLED === "false") {
    logger.info("[TLS] Disabled via TLS_ENABLED=false environment variable");
    return;
  }

  const existingSetting = getAppSetting("tls_enabled");

  // First run — no TLS setting in DB yet → auto-enable with self-signed cert
  if (existingSetting === null) {
    logger.info(
      "[TLS] First start — generating self-signed certificate and enabling HTTPS...",
    );
    await enableTlsSelfSigned();
    return;
  }

  // Already configured but enabled — ensure cert files exist
  if (existingSetting === "true") {
    const tlsConfig = getTlsConfig();
    if (tlsConfig.selfSigned) {
      const config = getConfig();
      const certPath = path.join(config.dataPath, CERT_FILENAME);
      const keyPath = path.join(config.dataPath, KEY_FILENAME);
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        logger.warn("[TLS] Certificate files missing — regenerating...");
        await generateSelfSignedCert();
      }
    }
  }
}

/**
 * Load TLS credentials for https.createServer().
 * Returns null if TLS is disabled via env var, DB setting, or certs are missing.
 */
export function loadTlsCredentials(): {
  cert: string;
  key: string;
} | null {
  // Env var override takes precedence
  if (process.env.TLS_ENABLED === "false") return null;

  const tlsConfig = getTlsConfig();
  if (!tlsConfig.enabled) return null;

  const validation = validateCertFiles(tlsConfig.certPath, tlsConfig.keyPath);
  if (!validation.valid) {
    logger.error("[TLS] Certificate validation failed", {
      error: validation.error,
    });
    logger.warn("[TLS] Falling back to HTTP");
    return null;
  }

  return {
    cert: fs.readFileSync(tlsConfig.certPath, "utf-8"),
    key: fs.readFileSync(tlsConfig.keyPath, "utf-8"),
  };
}
