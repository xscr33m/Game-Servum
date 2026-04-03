/**
 * Game-Servum Commander — Windows Build
 *
 * Builds standalone Commander for Windows (no Agent - connects to remote/local Agents).
 *
 * Steps:
 *  1. Build shared types
 *  2. Build client (Vite) with base='./' for file:// compatibility
 *  3. Stage Electron project (Commander only - no Agent/node.exe)
 *  4. Install Electron dependencies
 *  5. Run electron-builder → NSIS installer
 *  6. Copy output + update metadata to dist/
 *
 * Output: dist/Game-Servum-Commander-Setup-v{version}.exe (~90 MB) + commander.yml
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

const STAGING = resolve(ROOT, "dist", "staging-commander-windows");
const DIST_DIR = resolve(ROOT, "dist", `v${APP_VERSION}`);

console.log("╔════════════════════════════════════════════");
console.log(`║  Game-Servum Commander Builder (Windows)   `);
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

// 3a. Electron project package.json (Commander only)
const electronPkg = {
  name: "game-servum-commander",
  version: APP_VERSION,
  description: "Game-Servum Commander — Remote Agent Management",
  author: "xscr33mLabs",
  license: "GPL-3.0-only",
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
    appId: "com.gameservum.commander",
    productName: "Game-Servum Commander",
    copyright: "Copyright © 2026 xscr33mLabs",
    directories: { output: "release", buildResources: "build" },
    files: ["main/**/*", "assets/**/*"],
    extraResources: [{ from: "runtime", to: "runtime", filter: ["**/*"] }],
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      icon: "build/icon.png",
    },
    nsis: {
      oneClick: true,
      artifactName: `Game-Servum-Commander-Setup-v${APP_VERSION}.\${ext}`,
    },
    publish: {
      provider: "github",
      owner: "xscr33m",
      repo: "Game-Servum",
      channel: "commander",
    },
  },
};

mkdirSync(STAGING, { recursive: true });
writeFileSync(
  resolve(STAGING, "package.json"),
  JSON.stringify(electronPkg, null, 2),
);

// 3b. Build resources (icon only, no NSIS customization needed)
mkdirSync(resolve(STAGING, "build"), { recursive: true });

cpSync(
  resolve(ROOT, "client", "public", "commander-icon.png"),
  resolve(STAGING, "build", "icon.png"),
);

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
  resolve(ROOT, "client", "public", "commander-icon.png"),
  resolve(STAGING, "assets", "commander-icon.png"),
);

// 3e. Runtime files (Client only - no Agent)
const runtimeDir = resolve(STAGING, "runtime");
mkdirSync(runtimeDir, { recursive: true });

const clientDir = resolve(runtimeDir, "client");
mkdirSync(clientDir, { recursive: true });
cpSync(resolve(ROOT, "client", "dist"), clientDir, { recursive: true });

console.log("  ✓ Staged Commander runtime (React app)");

// ─── 4. Install Electron dependencies ───────────────────────────

console.log("\n[4/6] Installing Electron dependencies...");
execSync("npm install --no-package-lock --loglevel=warn", {
  cwd: STAGING,
  stdio: "inherit",
});

// ───  5. Build installer ─────────────────────────────────────────

console.log("\n[5/6] Building NSIS installer...");
execSync("npx electron-builder --win --publish never", {
  cwd: STAGING,
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});

// ─── 6. Copy output to dist/ ────────────────────────────────────

console.log("\n[6/6] Centralizing output...");
mkdirSync(DIST_DIR, { recursive: true });

// NSIS creates files directly under release/
const releaseDir = resolve(STAGING, "release");
let outputFile = "";

if (existsSync(releaseDir)) {
  const files = readdirSync(releaseDir);

  // Copy installer executable
  const setupFile = files.find(
    (f) => f.endsWith(".exe") && f.includes("Setup"),
  );
  if (setupFile) {
    cpSync(resolve(releaseDir, setupFile), resolve(DIST_DIR, setupFile));
    outputFile = setupFile;
    console.log(`  ✓ ${setupFile}`);
  } else {
    console.warn("  ⚠ WARNING: No installer .exe found");
  }

  // Copy commander.yml update metadata (required for electron-updater auto-updates)
  const ymlFile = files.find((f) => f === "commander.yml");
  if (ymlFile) {
    cpSync(resolve(releaseDir, ymlFile), resolve(DIST_DIR, ymlFile));
    console.log(`  ✓ ${ymlFile}`);
  } else {
    console.warn(
      "  ⚠ WARNING: commander.yml not found (auto-update won't work)",
    );
  }
} else {
  console.error("  ✗ ERROR: NSIS output directory not found!");
  console.error(`    Expected: ${releaseDir}`);
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
console.log("║  Mode: Commander only (connects to remote/local Agents)      ");
console.log("║  Data stored in: Documents/Game-Servum/                      ");
console.log("║                                                              ");
console.log("║  GitHub Release Assets (flat):                               ");
console.log("║    ├── Game-Servum-Commander-Setup-v{version}.exe            ");
console.log("║    └── commander.yml                                         ");
console.log("╚══════════════════════════════════════════════════════════════");
