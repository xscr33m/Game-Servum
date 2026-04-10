/**
 * Game-Servum Agent — Windows Build
 *
 * Builds standalone Agent as a Windows Service installer (no Electron).
 *
 * Steps:
 *  1. Build shared types
 *  2. Bundle agent with esbuild
 *  3. Stage service files (Node.js + agent bundle + WinSW)
 *  4. Build NSIS installer
 *  5. Create update ZIP
 *  6. Copy output to dist/
 *
 * Output:
 *   dist/v{version}/Game-Servum-Agent-Setup-v{version}.exe (~50 MB)
 *   dist/v{version}/Game-Servum-Agent-Update-v{version}.zip (~20 MB)
 *
 * Prerequisites:
 *   - Node.js 20+ (for bundling)
 *   - NSIS 3.x installed (auto-detected or makensis on PATH)
 *   - WinSW binary downloaded to service/winsw/ (or auto-downloaded)
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
  createWriteStream,
} from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createReadStream, statSync } from "fs";
import {
  signFile,
  isSigningAvailable,
  printSigningStatus,
  getSigntoolPath,
} from "./sign-windows.mjs";
import { appendToChecksums } from "./checksum.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TIMESTAMP_SERVER = "http://time.certum.pl";

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const APP_VERSION = pkg.version || "1.0.0";

const STAGING = resolve(ROOT, "dist", "staging-agent-windows");
const DIST_DIR = resolve(ROOT, "dist", `v${APP_VERSION}`);

const WINSW_VERSION = "3.0.0-alpha.11";
const WINSW_URL = `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}/WinSW-x64.exe`;

console.log("╔════════════════════════════════════════════");
console.log(`║  Game-Servum Agent Builder (Windows)       `);
console.log(`║  Version: ${APP_VERSION.padEnd(32)}`);
console.log(`║  Mode: Windows Service (WinSW + NSIS)      `);
console.log("╚════════════════════════════════════════════");
printSigningStatus();

// ─── 1. Build shared types ─────────────────────────────────────

console.log("\n[1/6] Building shared types...");
execSync("npm run build -w @game-servum/shared", {
  cwd: ROOT,
  stdio: "inherit",
});

// ─── 2. Bundle agent ────────────────────────────────────────────

console.log("\n[2/6] Bundling agent...");
execSync("npm run build:bundle", {
  cwd: resolve(ROOT, "server"),
  stdio: "inherit",
});

// ─── 3. Stage service files ─────────────────────────────────────

console.log("\n[3/6] Staging files...");
if (existsSync(STAGING)) {
  rmSync(STAGING, { recursive: true });
}
mkdirSync(STAGING, { recursive: true });

// 3a. Node.js runtime
console.log("  Copying Node.js runtime...");
cpSync(process.execPath, resolve(STAGING, "node.exe"));

// 3b. Agent bundle
console.log("  Copying agent bundle...");
cpSync(
  resolve(ROOT, "server", "dist", "agent.mjs"),
  resolve(STAGING, "agent.mjs"),
);
if (existsSync(resolve(ROOT, "server", "dist", "agent.mjs.map"))) {
  cpSync(
    resolve(ROOT, "server", "dist", "agent.mjs.map"),
    resolve(STAGING, "agent.mjs.map"),
  );
}
if (existsSync(resolve(ROOT, "server", "dist", "sql-wasm.wasm"))) {
  cpSync(
    resolve(ROOT, "server", "dist", "sql-wasm.wasm"),
    resolve(STAGING, "sql-wasm.wasm"),
  );
}

// 3c. WinSW binary and config
console.log("  Preparing WinSW service wrapper...");

// Stage agent icon for NSIS installer
const agentIconSrc = resolve(ROOT, "client", "public", "agent-icon.ico");
if (existsSync(agentIconSrc)) {
  cpSync(agentIconSrc, resolve(STAGING, "agent-icon.ico"));
  console.log("  ✓ Staged agent icon");
} else {
  console.warn("  ⚠ agent-icon.ico not found — installer will fail");
}
const winswLocalPath = resolve(ROOT, "service", "winsw", "WinSW-x64.exe");

if (existsSync(winswLocalPath)) {
  // Use local WinSW binary
  cpSync(winswLocalPath, resolve(STAGING, "GameServumAgent.exe"));
  console.log("  ✓ Using local WinSW binary");
} else {
  // Download WinSW
  console.log(`  Downloading WinSW v${WINSW_VERSION}...`);
  execSync(
    `curl -L -o "${resolve(STAGING, "GameServumAgent.exe")}" "${WINSW_URL}"`,
    { stdio: "inherit" },
  );
  console.log("  ✓ Downloaded WinSW binary");
}

// NOTE: WinSW is a .NET single-file executable — modifying its PE resources
// (icon, version info) via pe-library/resedit corrupts the .NET bundle data
// and makes the exe non-functional. The agent icon is set for the installer
// (NSIS MUI_ICON) and Add/Remove Programs (registry DisplayIcon) instead.

// Copy WinSW XML config
cpSync(
  resolve(ROOT, "service", "winsw", "GameServumAgent.xml"),
  resolve(STAGING, "GameServumAgent.xml"),
);

// 3d. .env.example
const envExample = `# Game-Servum Agent Configuration
# Copy to %PROGRAMDATA%\\Game-Servum\\.env and adjust values as needed.

# Network
PORT=3001
HOST=0.0.0.0

# Paths (relative to GAME_SERVUM_ROOT, or absolute)
# DATA_PATH=data
# SERVERS_PATH=servers
# STEAMCMD_PATH=steamcmd
# LOGS_PATH=logs

# CORS — comma-separated list of allowed origins
# CORS_ORIGINS=https://your-dashboard.com,http://localhost:5173
CORS_ORIGINS=*

# Authentication (enabled by default for remote Commander access)
AUTH_ENABLED=true
# JWT_SECRET=  (auto-generated if not set)
`;
writeFileSync(resolve(STAGING, ".env.example"), envExample, "utf-8");

// 3e. LICENSE file (for NSIS installer)
if (existsSync(resolve(ROOT, "LICENSE"))) {
  cpSync(resolve(ROOT, "LICENSE"), resolve(STAGING, "LICENSE"));
} else {
  writeFileSync(
    resolve(STAGING, "LICENSE"),
    "Game-Servum — Copyright (C) 2025-2026 xscr33mLabs\n\nThis program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.\n\nThis program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.\n\nYou should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.\n",
    "utf-8",
  );
}

console.log("  ✓ Staged all service files");

// 3f. Sign staged executables + prepare uninstaller signing
const signingEnabled = isSigningAvailable();
if (signingEnabled) {
  console.log("\n  Signing staged executables...");
  signFile(resolve(STAGING, "GameServumAgent.exe"));

  // Create sign.bat for NSIS !uninstfinalize (signs uninstaller during compilation)
  const signtoolPath = getSigntoolPath();
  let certArgs = "/a";
  if (process.env.WIN_CSC_THUMBPRINT) {
    certArgs = `/sha1 ${process.env.WIN_CSC_THUMBPRINT}`;
  } else if (process.env.WIN_CSC_NAME) {
    certArgs = `/n "${process.env.WIN_CSC_NAME}"`;
  }
  const signBat = `@"${signtoolPath}" sign ${certArgs} /tr ${TIMESTAMP_SERVER} /td sha256 /fd sha256 %1\r\n`;
  writeFileSync(resolve(STAGING, "sign.bat"), signBat, "utf-8");
  console.log("  ✓ Created sign.bat for uninstaller signing");
}

// ─── 4. Build NSIS installer ────────────────────────────────────

console.log("\n[4/6] Building NSIS installer...");
mkdirSync(DIST_DIR, { recursive: true });

// Auto-detect makensis — check common install locations before falling back to PATH
function findMakensis() {
  const candidates = [
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
    process.env.NSIS_HOME
      ? resolve(process.env.NSIS_HOME, "makensis.exe")
      : null,
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return `"${p}"`;
  }

  // Fall back to PATH
  try {
    execSync("makensis /VERSION", { stdio: "ignore" });
    return "makensis";
  } catch {
    return null;
  }
}

const makensis = findMakensis();
if (!makensis) {
  console.error("  ✗ NSIS (makensis) not found!");
  console.error(
    "    Install NSIS 3.x: winget install NSIS.NSIS  or  choco install nsis",
  );
  console.error(
    "    Or set NSIS_HOME environment variable to NSIS install directory.",
  );
  process.exit(1);
}

const nsisScript = resolve(ROOT, "scripts", "nsis", "agent-installer.nsi");
const installerExe = `Game-Servum-Agent-Setup-v${APP_VERSION}.exe`;
const installerPath = resolve(DIST_DIR, installerExe);

// Build NSIS defines string — conditionally include signing flag
let nsisDefines = `-DPRODUCT_VERSION="${APP_VERSION}" -DSTAGING_DIR="${STAGING}" -DOUTPUT_FILE="${installerPath}"`;
if (signingEnabled) {
  nsisDefines += ` -DENABLE_SIGNING`;
}

try {
  execSync(`${makensis} ${nsisDefines} "${nsisScript}"`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log(`  ✓ Created installer: ${installerExe}`);
} catch (err) {
  console.error("  ✗ NSIS build failed!");
  process.exit(1);
}

// ─── 4b. Sign installer ─────────────────────────────────────────

if (isSigningAvailable()) {
  console.log("\nSigning installer...");
  signFile(installerPath);
} else if (
  process.env.SKIP_CODE_SIGNING !== "true" &&
  process.platform === "win32"
) {
  console.warn("\n  ⚠ Code signing skipped (signtool.exe not found)");
}

// ─── 5. Create update ZIP ────────────────────────────────────────

console.log("\n[5/6] Creating update package...");
const updateZipName = `Game-Servum-Agent-Update-v${APP_VERSION}.zip`;
const updateZipPath = resolve(DIST_DIR, updateZipName);

try {
  // Create ZIP with just the updateable files (agent.mjs + sql-wasm.wasm)
  // Using PowerShell on Windows, zip command on Linux
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${resolve(STAGING, "agent.mjs")}','${resolve(STAGING, "sql-wasm.wasm")}' -DestinationPath '${updateZipPath}' -Force"`,
      { stdio: "inherit" },
    );
  } else {
    // On Linux (cross-compile scenario), use zip
    execSync(
      `cd "${STAGING}" && zip "${updateZipPath}" agent.mjs sql-wasm.wasm`,
      { stdio: "inherit" },
    );
  }
  console.log(`  ✓ Created update package: ${updateZipName}`);
} catch (err) {
  console.warn(`  ⚠ Could not create update ZIP: ${err.message}`);
}

// ─── 5b. Generate checksums ──────────────────────────────────────

console.log("\nGenerating checksums...");
await appendToChecksums(installerPath, DIST_DIR);
await appendToChecksums(updateZipPath, DIST_DIR);

// ─── 6. Clean up and report ──────────────────────────────────────

console.log("\n[6/6] Cleaning up...");
rmSync(STAGING, { recursive: true });

console.log("");
console.log("╔══════════════════════════════════════════════════════════════");
console.log(
  `\u2551  Output: dist/v${APP_VERSION}/                              `,
);
console.log(
  "\u2551                                                              ",
);
console.log(
  "\u2551  Mode: Windows Service (WinSW)                              ",
);
console.log(
  "\u2551  Data stored in: C:\\ProgramData\\Game-Servum\\                ",
);
console.log(
  "\u2551  Port: 3001 (configurable via .env)                          ",
);
console.log(
  "\u2551                                                              ",
);
console.log(
  "\u2551  GitHub Release Assets (flat):                               ",
);
console.log(`║    ├── ${installerExe.padEnd(50)}`);
console.log(`║    └── ${updateZipName.padEnd(50)}`);
console.log("║                                                              ");
console.log("║  Installer will:                                             ");
console.log(
  "║    • Install to C:\\Program Files\\Game-Servum Agent\\          ",
);
console.log("║    • Register & start Windows Service                        ");
console.log("║    • Add firewall rule for port 3001                         ");
console.log("║    • Create data directory in ProgramData                    ");
console.log("╚══════════════════════════════════════════════════════════════");
