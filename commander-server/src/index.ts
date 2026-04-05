import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cookieParser from "cookie-parser";
import {
  initFromEnv,
  isConfigured,
  setupPassword,
  validatePassword,
  changePassword,
  createSessionToken,
  verifySessionToken,
} from "./auth.js";
import { requireSession } from "./middleware.js";
import { connectionsRouter } from "./connections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "8080", 10);
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

const app = express();

// ── Trust proxy (for reverse-proxy setups with TLS termination) ──
if (TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// ── Middleware ──
app.use(express.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(cookieParser() as any);

// ── Cookie helper ──

function setSessionCookie(res: express.Response, token: string): void {
  const isSecure = TRUST_PROXY; // Set Secure flag when behind a TLS-terminating proxy
  res.cookie("commander_session", token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "strict" : "lax",
    maxAge: 24 * 60 * 60 * 1000, // 24h (matches JWT expiry)
    path: "/",
  });
}

function clearSessionCookie(res: express.Response): void {
  res.clearCookie("commander_session", { path: "/" });
}

// ── Auth Routes ──

// GET /commander/api/auth/status — Check if configured and authenticated
app.get("/commander/api/auth/status", (req, res) => {
  const configured = isConfigured();
  const token = req.cookies?.commander_session;
  const authenticated = token ? verifySessionToken(token) !== null : false;
  res.json({ configured, authenticated });
});

// POST /commander/api/auth/setup — Set initial admin password
app.post("/commander/api/auth/setup", (req, res) => {
  if (isConfigured()) {
    res.status(400).json({ success: false, message: "Already configured" });
    return;
  }

  const { password } = req.body;
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters",
    });
    return;
  }

  const ok = setupPassword(password);
  if (!ok) {
    res.status(500).json({ success: false, message: "Failed to set password" });
    return;
  }

  // Auto-login after setup
  const token = createSessionToken();
  setSessionCookie(res, token);
  res.json({ success: true });
});

// POST /commander/api/auth/login — Authenticate with password
app.post("/commander/api/auth/login", (req, res) => {
  if (!isConfigured()) {
    res.status(400).json({ success: false, message: "Not configured yet" });
    return;
  }

  const { password } = req.body;
  if (!password || typeof password !== "string") {
    res.status(400).json({ success: false, message: "Password required" });
    return;
  }

  if (!validatePassword(password)) {
    res.status(401).json({ success: false, message: "Invalid password" });
    return;
  }

  const token = createSessionToken();
  setSessionCookie(res, token);
  res.json({ success: true });
});

// POST /commander/api/auth/logout — Clear session
app.post("/commander/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// PUT /commander/api/auth/password — Change admin password (requires session)
app.put("/commander/api/auth/password", requireSession, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (
    !currentPassword ||
    !newPassword ||
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string"
  ) {
    res.status(400).json({
      success: false,
      message: "Current and new password required",
    });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({
      success: false,
      message: "New password must be at least 8 characters",
    });
    return;
  }

  if (!changePassword(currentPassword, newPassword)) {
    res
      .status(401)
      .json({ success: false, message: "Current password is incorrect" });
    return;
  }

  // Issue new session token after password change
  const token = createSessionToken();
  setSessionCookie(res, token);
  res.json({ success: true });
});

// ── Connections API ──
app.use("/commander/api/connections", connectionsRouter);

// ── Static Files (SPA) ──
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

// SPA fallback: all non-API routes serve index.html
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ── Startup ──

// Initialize admin from env var (if set and not yet configured)
initFromEnv();

app.listen(PORT, () => {
  console.log(`[Commander] Web server running on port ${PORT}`);
  if (isConfigured()) {
    console.log("[Commander] Admin password is configured");
  } else {
    console.log(
      "[Commander] No admin password set — first visitor will configure it",
    );
  }
  if (TRUST_PROXY) {
    console.log("[Commander] Trust proxy enabled (secure cookies)");
  }
});
