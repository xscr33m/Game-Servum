/**
 * Game-Servum Dashboard — Linux AppImage Builder
 *
 * Builds a standalone Dashboard for Linux (no Agent - connects to remote Windows Agents).
 *
 * Steps:
 *  1. Build shared types
 *  2. Build client (Vite) with base='./' for file:// compatibility
 *  3. Stage Electron project (Dashboard only - no Agent/node.exe)
 *  4. Install Electron dependencies
 *  5. Run electron-builder → .AppImage
 *  6. Copy output to dist/
 *
 * Output: dist/Game-Servum-Dashboard-{version}.AppImage
 */
import { execSync } from "child_process";
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const APP_VERSION = pkg.version || "1.0.0";

const STAGING = resolve(ROOT, "dist", "staging-linux-dashboard");
const DIST_DIR = resolve(ROOT, "dist", `v${APP_VERSION}`);

console.log("╔════════════════════════════════════════════");
console.log(`║  Game Servum Dashboard Builder (Linux)     `);
console.log(`║  Version: ${APP_VERSION.padEnd(32)}`);
console.log("╚════════════════════════════════════════════");

// ─── 1. Build shared types ─────────────────────────────────────

console.log("\n[1/6] Building shared types...");
execSync("npm run build -w @game-servum/shared", {
  cwd: ROOT,
  stdio: "inherit",
});

// ─── 2. Build client ────────────────────────────────────────────

console.log("\n[2/6] Building client...");
execSync("npx vite build --base=./", {
  cwd: resolve(ROOT, "client"),
  stdio: "inherit",
});

// ─── 3. Stage Electron project ──────────────────────────────────

console.log("\n[3/6] Staging files...");
if (existsSync(STAGING)) {
  rmSync(STAGING, { recursive: true });
}

// 3a. Electron project package.json (Dashboard only)
const electronPkg = {
  name: "game-servum-dashboard",
  version: APP_VERSION,
  description: "Game Servum Dashboard — Remote Agent Management",
  author: "xscr33mLabs",
  license: "MIT",
  main: "main/main-unified.js",
  dependencies: {
    "electron-updater": "^6.8.3",
  },
  devDependencies: {
    electron: "^40.4.1",
    "electron-builder": "^26.8.0",
  },
  overrides: {
    "global-agent": "^4.0.0",
    "balanced-match": "^4.0.2",
  },
  build: {
    appId: "com.gameservum.dashboard",
    productName: "Game Servum Dashboard",
    copyright: "Copyright © 2026 xscr33mLabs",
    directories: { output: "release", buildResources: "build" },
    files: ["main/**/*", "assets/**/*"],
    extraResources: [{ from: "runtime", to: "runtime", filter: ["**/*"] }],
    linux: {
      target: [{ target: "AppImage", arch: ["x64"] }],
      category: "Utility",
      icon: "build/icon.png",
      artifactName: "Game-Servum-Dashboard-${version}.${ext}",
    },
    appImage: {
      license: "LICENSE",
    },
    publish: {
      provider: "github",
      owner: "xscr33m",
      repo: "Game-Servum",
      publisherName: ["xscr33mLabs"],
      channel: "dashboard",
    },
  },
};

mkdirSync(STAGING, { recursive: true });
writeFileSync(
  resolve(STAGING, "package.json"),
  JSON.stringify(electronPkg, null, 2),
);

// 3b. Build resources (icon)
mkdirSync(resolve(STAGING, "build"), { recursive: true });
cpSync(
  resolve(ROOT, "client", "public", "dashboard-icon.png"),
  resolve(STAGING, "build", "icon.png"),
);

// Optional: Copy LICENSE for AppImage
if (existsSync(resolve(ROOT, "LICENSE"))) {
  cpSync(resolve(ROOT, "LICENSE"), resolve(STAGING, "LICENSE"));
} else {
  // Create minimal LICENSE if missing
  writeFileSync(
    resolve(STAGING, "LICENSE"),
    "MIT License\nCopyright © 2025-2026 xscr33m",
  );
}

// 3c. Electron main process files (packed into app.asar)
mkdirSync(resolve(STAGING, "main"), { recursive: true });
cpSync(
  resolve(ROOT, "electron", "main", "main-unified.js"),
  resolve(STAGING, "main", "main-unified.js"),
);
cpSync(
  resolve(ROOT, "electron", "main", "preload.js"),
  resolve(STAGING, "main", "preload.js"),
);
cpSync(
  resolve(ROOT, "electron", "main", "logger.js"),
  resolve(STAGING, "main", "logger.js"),
);

// 3d. Assets (packed into app.asar)
mkdirSync(resolve(STAGING, "assets"), { recursive: true });
cpSync(
  resolve(ROOT, "client", "public", "dashboard-icon.png"),
  resolve(STAGING, "assets", "dashboard-icon.png"),
);

// 3e. Runtime files (Client only - no Agent for Linux)
const runtimeDir = resolve(STAGING, "runtime");
mkdirSync(runtimeDir, { recursive: true });

const clientDir = resolve(runtimeDir, "client");
mkdirSync(clientDir, { recursive: true });
cpSync(resolve(ROOT, "client", "dist"), clientDir, { recursive: true });

console.log("  ✓ Staged Electron project for Linux Dashboard-only");

// ─── 4. Install Electron dependencies ───────────────────────────

console.log("\n[4/6] Installing Electron dependencies...");
execSync("npm install --no-package-lock --loglevel=warn", {
  cwd: STAGING,
  stdio: "inherit",
});

// ─── 5. Build AppImage ──────────────────────────────────────────

console.log("\n[5/6] Building AppImage...");
execSync("npx electron-builder --linux --publish never", {
  cwd: STAGING,
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});

// ─── 6. Copy output to dist/ ────────────────────────────────────

console.log("\n[6/6] Centralizing output...");
mkdirSync(DIST_DIR, { recursive: true });

// Copy all release assets flat to dist/v{version}/ (GitHub Releases = flat file uploads)

const releaseDir = resolve(STAGING, "release");
let outputFile = "";

if (existsSync(releaseDir)) {
  const appImages = readdirSync(releaseDir).filter((f) =>
    f.endsWith(".AppImage"),
  );
  for (const file of appImages) {
    cpSync(resolve(releaseDir, file), resolve(DIST_DIR, file));
    outputFile = file;
    console.log(`  ✓ ${file}`);
  }

  // Copy dashboard-linux.yml (electron-updater metadata for GitHub provider + channel)
  if (existsSync(resolve(releaseDir, "dashboard-linux.yml"))) {
    cpSync(
      resolve(releaseDir, "dashboard-linux.yml"),
      resolve(DIST_DIR, "dashboard-linux.yml"),
    );
    console.log(`  ✓ dashboard-linux.yml`);
  } else if (existsSync(resolve(releaseDir, "latest-linux.yml"))) {
    // Fallback: electron-builder might create latest-linux.yml
    cpSync(
      resolve(releaseDir, "latest-linux.yml"),
      resolve(DIST_DIR, "dashboard-linux.yml"),
    );
    console.log(`  ✓ dashboard-linux.yml (renamed from latest-linux.yml)`);
  }

  if (appImages.length === 0) {
    console.warn("  ⚠ WARNING: No .AppImage found in staging release/");
  }
} else {
  console.warn("  ⚠ WARNING: staging release/ directory not found");
}

// Clean up staging
console.log("\nCleaning up staging...");
rmSync(STAGING, { recursive: true });

console.log("");
console.log("╔══════════════════════════════════════════════════════════════");
if (outputFile) {
  console.log(
    `║  Output: dist/v${APP_VERSION}/${outputFile.substring(0, 40).padEnd(40)}`,
  );
} else {
  console.log(
    `║  Output: dist/v${APP_VERSION}/                                  `,
  );
}
console.log("║                                                              ");
console.log("║  Mode: Dashboard only (connects to remote Windows Agents)    ");
console.log("║  Data stored in: ~/.config/game-servum-dashboard/            ");
console.log("║  No Agent runtime — Windows Agents required for servers      ");
console.log("║                                                              ");
console.log("║  GitHub Release Assets (flat):                               ");
console.log("║    ├── Game-Servum-Dashboard-{version}.AppImage              ");
console.log("║    └── dashboard-linux.yml                                   ");
console.log("╚══════════════════════════════════════════════════════════════");
