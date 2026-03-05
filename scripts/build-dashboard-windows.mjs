/**
 * Game-Servum Dashboard — Windows Build
 *
 * Builds standalone Dashboard for Windows (no Agent - connects to remote/local Agents).
 *
 * Steps:
 *  1. Build shared types
 *  2. Build client (Vite) with base='./' for file:// compatibility
 *  3. Stage Electron project (Dashboard only - no Agent/node.exe)
 *  4. Install Electron dependencies
 *  5. Run electron-builder → NSIS installer
 *  6. Copy output to dist/
 *
 * Output: dist/Game-Servum-Dashboard-v{version}.exe (~90 MB)
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

const STAGING = resolve(ROOT, "dist", "staging-dashboard-windows");
const DIST_DIR = resolve(ROOT, "dist", `v${APP_VERSION}`);

/**
 * Convert a PNG file to ICO format (no external dependencies).
 * Uses the PNG-in-ICO approach supported since Windows Vista.
 */
function pngToIco(pngPath, icoPath) {
  const png = readFileSync(pngPath);
  // ICO header: reserved(2) + type(2, 1=ICO) + count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  // ICO directory entry: w(1) h(1) colors(1) reserved(1) planes(2) bpp(2) size(4) offset(4)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // 0 = 256px
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); // 1 color plane
  entry.writeUInt16LE(32, 6); // 32 bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // data starts at byte 22 (6+16)
  writeFileSync(icoPath, Buffer.concat([header, entry, png]));
}

console.log("╔════════════════════════════════════════════");
console.log(`║  Game Servum Dashboard Builder (Windows)   `);
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
    "electron-squirrel-startup": "^1.0.1",
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
    win: {
      target: [{ target: "squirrel", arch: ["x64"] }],
      icon: "build/icon.png",
    },
    squirrelWindows: {
      name: "GameServumDashboard",
      iconUrl:
        "https://raw.githubusercontent.com/xscr33m/Game-Servum/main/client/public/dashboard-icon.ico",
      // loadingGif: resolve(ROOT, "client", "public", "setup-animation.gif"),
      remoteReleases: true, // Enable delta updates (smaller update downloads)
    },
    publish: {
      provider: "github",
      owner: "xscr33m",
      repo: "Game-Servum",
      publisherName: ["xscr33mLabs"],
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
  resolve(ROOT, "client", "public", "dashboard-icon.png"),
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
  resolve(ROOT, "client", "public", "dashboard-icon.png"),
  resolve(STAGING, "assets", "dashboard-icon.png"),
);

// 3e. Runtime files (Client only - no Agent)
const runtimeDir = resolve(STAGING, "runtime");
mkdirSync(runtimeDir, { recursive: true });

const clientDir = resolve(runtimeDir, "client");
mkdirSync(clientDir, { recursive: true });
cpSync(resolve(ROOT, "client", "dist"), clientDir, { recursive: true });

console.log("  ✓ Staged Dashboard runtime (React app)");

// ─── 4. Install Electron dependencies ───────────────────────────

console.log("\n[4/6] Installing Electron dependencies...");
execSync("npm install --no-package-lock --loglevel=warn", {
  cwd: STAGING,
  stdio: "inherit",
});

// ───  5. Build installer ─────────────────────────────────────────

console.log("\n[5/5] Building Squirrel installer...");
execSync("npx electron-builder --win --publish never", {
  cwd: STAGING,
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});

// ─── 6. Copy output to dist/ ────────────────────────────────────

console.log("\n[6/6] Centralizing output...");
mkdirSync(DIST_DIR, { recursive: true });

// Squirrel.Windows creates files under release/squirrel-windows/
const squirrelDir = resolve(STAGING, "release", "squirrel-windows");
let outputFile = "";

if (existsSync(squirrelDir)) {
  const files = readdirSync(squirrelDir);

  // Create dashboard/ subdirectory for organized GitHub Release assets
  const dashboardDistDir = resolve(DIST_DIR, "dashboard");
  mkdirSync(dashboardDistDir, { recursive: true });

  // Copy installer executable
  const setupFiles = files.filter(
    (f) => f.endsWith(".exe") && f.includes("Setup"),
  );
  for (const file of setupFiles) {
    cpSync(resolve(squirrelDir, file), resolve(dashboardDistDir, file));
    outputFile = file;
    console.log(`  ✓ Copied to dashboard/: ${file}`);
  }

  // Copy .nupkg files (required for auto-updates)
  const nupkgFiles = files.filter((f) => f.endsWith(".nupkg"));
  for (const file of nupkgFiles) {
    cpSync(resolve(squirrelDir, file), resolve(dashboardDistDir, file));
    console.log(`  ✓ Copied to dashboard/: ${file}`);
  }

  // Copy RELEASES metadata (required for Squirrel.Windows auto-updates)
  // Keep as RELEASES (subdirectory structure prevents conflicts)
  if (files.includes("RELEASES")) {
    cpSync(
      resolve(squirrelDir, "RELEASES"),
      resolve(dashboardDistDir, "RELEASES"),
    );
    console.log(`  ✓ Copied to dashboard/: RELEASES`);
  }

  if (setupFiles.length === 0) {
    console.warn("  ⚠ WARNING: No installer .exe found");
  }
  if (nupkgFiles.length === 0) {
    console.warn("  ⚠ WARNING: No .nupkg files found (auto-update won't work)");
  }
  if (!files.includes("RELEASES")) {
    console.warn(
      "  ⚠ WARNING: RELEASES metadata not found (auto-update won't work)",
    );
  }
} else {
  console.error("  ✗ ERROR: Squirrel output directory not found!");
  console.error(`    Expected: ${squirrelDir}`);
}

// Clean up staging
console.log("\nCleaning up staging...");
rmSync(STAGING, { recursive: true });

console.log("");
console.log("╔══════════════════════════════════════════════════════════════");
if (outputFile) {
  console.log(
    `║  Output: dist/v${APP_VERSION}/dashboard/${outputFile.substring(0, 18).padEnd(18)}`,
  );
} else {
  console.log(
    `║  Output: dist/v${APP_VERSION}/dashboard/                        `,
  );
}
console.log("║                                                              ");
console.log("║  Mode: Dashboard only (connects to remote/local Agents)      ");
console.log("║  Data stored in: Documents/Game Servum/                      ");
console.log("║                                                              ");
console.log("║  GitHub Release Assets Structure:                            ");
console.log("║    dashboard/                                                ");
console.log("║      ├── RELEASES                                            ");
console.log("║      ├── Game-Servum-Dashboard-Setup-{version}.exe          ");
console.log("║      └── GameServumDashboard-{version}-full.nupkg            ");
console.log("╚══════════════════════════════════════════════════════════════");
