/**
 * Game-Servum Commander — Linux AppImage Builder
 *
 * Builds a standalone Commander for Linux (no Agent - connects to remote Windows Agents).
 *
 * Steps:
 *  1. Build shared types
 *  2. Build client (Vite) with base='./' for file:// compatibility
 *  3. Stage Electron project (Commander only - no Agent/node.exe)
 *  4. Install Electron dependencies
 *  5. Run electron-builder → .AppImage
 *  6. Copy output to dist/
 *
 * Output: dist/Game-Servum-Commander-{version}.AppImage
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

const STAGING = resolve(ROOT, "dist", "staging-linux-commander");
const DIST_DIR = resolve(ROOT, "dist", `v${APP_VERSION}`);

console.log("╔════════════════════════════════════════════");
console.log(`║  Game-Servum Commander Builder (Linux)     `);
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

// 3a. Read base Electron config and merge platform-specific build settings
const electronBasePkg = JSON.parse(
  readFileSync(resolve(ROOT, "electron", "package.json"), "utf-8"),
);
const electronPkg = {
  ...electronBasePkg,
  version: APP_VERSION,
  build: {
    ...electronBasePkg.build,
    linux: {
      target: [{ target: "AppImage", arch: ["x64"] }],
      category: "Utility",
      icon: "build/icon.png",
      artifactName: "Game-Servum-Commander-${version}.${ext}",
    },
    appImage: {
      license: "LICENSE",
    },
    publish: {
      ...electronBasePkg.build.publish,
      publisherName: ["xscr33mLabs"],
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
  resolve(ROOT, "client", "public", "commander-icon.png"),
  resolve(STAGING, "build", "icon.png"),
);

// Optional: Copy LICENSE for AppImage
if (existsSync(resolve(ROOT, "LICENSE"))) {
  cpSync(resolve(ROOT, "LICENSE"), resolve(STAGING, "LICENSE"));
} else {
  // Create minimal LICENSE if missing
  writeFileSync(
    resolve(STAGING, "LICENSE"),
    "Game-Servum — Copyright (C) 2025-2026 xscr33mLabs\n\nThis program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.\n\nSee https://www.gnu.org/licenses/ for details.",
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
  resolve(ROOT, "client", "public", "commander-icon.png"),
  resolve(STAGING, "assets", "commander-icon.png"),
);

// 3e. Runtime files (Client only - no Agent for Linux)
const runtimeDir = resolve(STAGING, "runtime");
mkdirSync(runtimeDir, { recursive: true });

const clientDir = resolve(runtimeDir, "client");
mkdirSync(clientDir, { recursive: true });
cpSync(resolve(ROOT, "client", "dist"), clientDir, { recursive: true });

console.log("  ✓ Staged Electron project for Linux Commander-only");

// ─── 4. Install Electron dependencies ───────────────────────────

console.log("\n[4/6] Installing Electron dependencies...");

// 4a. Generate lock file without installing packages
console.log("  Resolving dependency tree...");
execSync("npm install --package-lock-only --loglevel=warn", {
  cwd: STAGING,
  stdio: "inherit",
});

// 4b. Audit dependencies before installing
try {
  execSync("npm audit", { cwd: STAGING, stdio: "pipe" });
  console.log("  ✓ No vulnerabilities found");
} catch {
  // Vulnerabilities found — attempt to fix in lock file only
  console.warn("  ⚠ Vulnerabilities detected, attempting auto-fix...");
  try {
    execSync("npm audit fix --package-lock-only", {
      cwd: STAGING,
      stdio: "inherit",
    });
  } catch {
    // audit fix can exit non-zero even when it partially fixes
  }

  // Re-audit — abort if vulnerabilities remain
  try {
    execSync("npm audit", { cwd: STAGING, stdio: "pipe" });
    console.log("  ✓ All vulnerabilities fixed");
  } catch (auditErr) {
    console.error("\n  ✗ Unfixable vulnerabilities remain:\n");
    // Show the audit report
    if (auditErr.stdout) process.stderr.write(auditErr.stdout);
    if (auditErr.stderr) process.stderr.write(auditErr.stderr);
    console.error("\n  Build aborted — resolve vulnerabilities manually.");
    process.exit(1);
  }
}

// 4c. Install packages (now verified clean)
console.log("  Installing packages...");
execSync("npm install --loglevel=warn", {
  cwd: STAGING,
  stdio: "inherit",
});
console.log("  ✓ Dependencies installed (audit clean)");

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

  // Copy commander-linux.yml (electron-updater metadata for GitHub provider + channel)
  if (existsSync(resolve(releaseDir, "commander-linux.yml"))) {
    cpSync(
      resolve(releaseDir, "commander-linux.yml"),
      resolve(DIST_DIR, "commander-linux.yml"),
    );
    console.log(`  ✓ commander-linux.yml`);
  } else if (existsSync(resolve(releaseDir, "latest-linux.yml"))) {
    // Fallback: electron-builder might create latest-linux.yml
    cpSync(
      resolve(releaseDir, "latest-linux.yml"),
      resolve(DIST_DIR, "commander-linux.yml"),
    );
    console.log(`  ✓ commander-linux.yml (renamed from latest-linux.yml)`);
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
console.log("║  Mode: Commander only (connects to remote Windows Agents)    ");
console.log("║  Data stored in: ~/.config/game-servum-commander/            ");
console.log("║  No Agent runtime — Windows Agents required for servers      ");
console.log("║                                                              ");
console.log("║  GitHub Release Assets (flat):                               ");
console.log("║    ├── Game-Servum-Commander-{version}.AppImage              ");
console.log("║    └── commander-linux.yml                                   ");
console.log("╚══════════════════════════════════════════════════════════════");
