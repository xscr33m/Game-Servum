import { Router, type Request, type Response } from "express";
import fs from "fs";
import { getSteamCMDExecutable } from "../services/config.js";
import { getSteamConfig } from "../db/index.js";
import {
  downloadSteamCMD,
  startLogin,
  submitGuardCode,
  getLoginState,
  logout,
  installApp,
} from "../services/steamcmd.js";
import type { SteamCMDStatus } from "../types/index.js";

const router = Router();

// GET /api/steamcmd/status - Check SteamCMD installation status
router.get("/status", (_req: Request, res: Response) => {
  const steamcmdExe = getSteamCMDExecutable();
  const installed = fs.existsSync(steamcmdExe);
  const steamConfig = getSteamConfig();
  const loginStatus = getLoginState();

  const status: SteamCMDStatus = {
    installed,
    path: installed ? steamcmdExe : null,
    loggedIn: steamConfig?.isLoggedIn ?? false,
    username: steamConfig?.username ?? null,
    loginState: loginStatus.state,
  };

  res.json(status);
});

// POST /api/steamcmd/install - Download and install SteamCMD
router.post("/install", async (_req: Request, res: Response) => {
  try {
    await downloadSteamCMD();
    res.json({ success: true, message: "SteamCMD installed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/steamcmd/login - Login to Steam
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const result = await startLogin(username, password);
    res.json({
      success: result.success,
      message: result.message,
      requiresGuard: result.needsGuard ?? false,
      requiresPassword: result.needsPassword ?? false,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/steamcmd/steam-guard - Submit Steam Guard code
router.post("/steam-guard", async (req: Request, res: Response) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Steam Guard code required" });
  }

  try {
    const result = await submitGuardCode(code);
    res.json({
      success: result.success,
      message: result.message,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/steamcmd/logout - Logout from Steam
router.post("/logout", (_req: Request, res: Response) => {
  try {
    const result = logout();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/steamcmd/install-app - Install a game/app
router.post("/install-app", async (req: Request, res: Response) => {
  const { appId, installDir, anonymous } = req.body;

  if (!appId || !installDir) {
    return res.status(400).json({ error: "appId and installDir required" });
  }

  try {
    const result = await installApp(appId, installDir, anonymous ?? false);
    res.json({
      success: result.success,
      message: result.message,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export { router as steamcmdRouter };
