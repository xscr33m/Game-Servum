import { Router } from "express";
import {
  authenticate,
  generateCredentials,
  hashPassword,
  verifyPassword,
  verifySessionToken,
  createSessionToken,
} from "../services/auth.js";
import {
  getAllApiKeys,
  findApiKeyById,
  deleteApiKey,
  updateApiKeyPassword,
} from "../db/index.js";
import { getConfig } from "../services/config.js";

const router = Router();

/**
 * POST /api/v1/auth/connect
 * Public endpoint — authenticates with API-Key + Password, returns JWT session token.
 */
router.post("/connect", (req, res) => {
  const config = getConfig();

  // If auth is disabled, return a dummy token
  if (!config.authEnabled) {
    res.json({
      token: "auth-disabled",
      expiresIn: 86400,
      message: "Authentication is disabled on this agent",
    });
    return;
  }

  const { apiKey, password } = req.body;

  if (!apiKey || !password) {
    res.status(400).json({ error: "apiKey and password are required" });
    return;
  }

  const token = authenticate(apiKey, password);
  if (!token) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  res.json({ token, expiresIn: 86400 });
});

/**
 * POST /api/v1/auth/refresh
 * Refresh an existing JWT session token before it expires.
 * Returns a new token with a fresh 24h expiry.
 */
router.post("/refresh", (req, res) => {
  const config = getConfig();

  // If auth is disabled, return a dummy token
  if (!config.authEnabled) {
    res.json({
      token: "auth-disabled",
      expiresIn: 86400,
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const payload = verifySessionToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }

  // Verify the key still exists and is active
  const key = findApiKeyById(payload.keyId);
  if (!key || !key.isActive) {
    res.status(401).json({ error: "API key has been revoked" });
    return;
  }

  // Issue a new token
  const newToken = createSessionToken({
    keyId: payload.keyId,
    name: payload.name,
  });

  res.json({ token: newToken, expiresIn: 86400 });
});

/**
 * POST /api/v1/auth/keys
 * Create a new API-Key + Password pair. Requires authentication.
 */
router.post("/keys", (req, res) => {
  const config = getConfig();
  if (!config.authEnabled) {
    res.status(400).json({ error: "Authentication is disabled on this agent" });
    return;
  }

  // Verify auth
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifySessionToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }

  const { name } = req.body;
  const credentials = generateCredentials(name || "New Key");

  res.json({
    apiKey: credentials.apiKey,
    password: credentials.password,
    message:
      "Save these credentials! The API key and password are shown only once.",
  });
});

/**
 * GET /api/v1/auth/keys
 * List all API keys (metadata only, no secrets). Requires authentication.
 */
router.get("/keys", (req, res) => {
  const config = getConfig();
  if (!config.authEnabled) {
    res.json({ keys: [] });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifySessionToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }

  const keys = getAllApiKeys();
  res.json({ keys });
});

/**
 * DELETE /api/v1/auth/keys/:id
 * Revoke an API key. Requires authentication. Cannot delete the last active key.
 */
router.delete("/keys/:id", (req, res) => {
  const config = getConfig();
  if (!config.authEnabled) {
    res.status(400).json({ error: "Authentication is disabled" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifySessionToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }

  const keyId = parseInt(req.params.id, 10);
  if (isNaN(keyId)) {
    res.status(400).json({ error: "Invalid key ID" });
    return;
  }

  const key = findApiKeyById(keyId);
  if (!key) {
    res.status(404).json({ error: "Key not found" });
    return;
  }

  // Prevent deleting the last active key
  const allKeys = getAllApiKeys();
  const activeKeys = allKeys.filter((k) => k.isActive);
  if (activeKeys.length <= 1 && key.isActive) {
    res.status(400).json({ error: "Cannot delete the last active API key" });
    return;
  }

  deleteApiKey(keyId);
  res.json({ success: true, message: "API key revoked" });
});

/**
 * PUT /api/v1/auth/password
 * Change the password for the current API key. Requires authentication.
 */
router.put("/password", (req, res) => {
  const config = getConfig();
  if (!config.authEnabled) {
    res.status(400).json({ error: "Authentication is disabled" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifySessionToken(authHeader.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session token" });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res
      .status(400)
      .json({ error: "currentPassword and newPassword are required" });
    return;
  }

  if (newPassword.length < 8) {
    res
      .status(400)
      .json({ error: "New password must be at least 8 characters" });
    return;
  }

  const key = findApiKeyById(payload.keyId);
  if (!key) {
    res.status(404).json({ error: "Key not found" });
    return;
  }

  // Verify current password
  if (!verifyPassword(currentPassword, key.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = hashPassword(newPassword);
  updateApiKeyPassword(payload.keyId, newHash);

  res.json({ success: true, message: "Password updated successfully" });
});

export { router as authRouter };
