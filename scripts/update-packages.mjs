#!/usr/bin/env node

/**
 * Game-Servum Package Updater
 *
 * Automatically updates all package.json files in the workspace with the latest
 * "wanted" versions from npm outdated. Supports npm workspaces.
 *
 * Usage:
 *   node scripts/update-packages.mjs [options]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *   --verbose    Show detailed output
 *   --install    Automatically run npm install after updating
 *   --help       Show help message
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Configuration
const CONFIG = {
  dryRun: process.argv.includes("--dry-run"),
  verbose: process.argv.includes("--verbose") || process.argv.includes("-v"),
  install: process.argv.includes("--install"),
};

// Color codes for console output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logVerbose(message) {
  if (CONFIG.verbose) {
    log(message, colors.gray);
  }
}

/**
 * Get all workspace package.json paths
 */
function getWorkspacePackages() {
  const rootPkgPath = resolve(ROOT, "package.json");
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));

  const packages = [{ name: "root", path: rootPkgPath }];

  if (rootPkg.workspaces) {
    for (const workspace of rootPkg.workspaces) {
      const pkgPath = resolve(ROOT, workspace, "package.json");
      if (existsSync(pkgPath)) {
        packages.push({
          name: workspace,
          path: pkgPath,
        });
      }
    }
  }

  return packages;
}

/**
 * Get outdated packages for specific workspace
 */
function getOutdatedPackages(workspaceDir) {
  try {
    logVerbose(`🔍 Checking outdated packages in ${workspaceDir}...`);
    const output = execSync("npm outdated --json", {
      encoding: "utf8",
      cwd: workspaceDir,
    });

    if (!output.trim()) {
      return {};
    }

    return JSON.parse(output);
  } catch (error) {
    // npm outdated exits with code 1 when packages are outdated, but still provides JSON
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch (parseError) {
        logVerbose("⚠️  Failed to parse npm outdated output");
        return {};
      }
    }

    return {};
  }
}

/**
 * Read and parse package.json
 */
function readPackageJson(path) {
  try {
    const content = readFileSync(path, "utf8");
    return JSON.parse(content);
  } catch (error) {
    log(`❌ Failed to read ${path}: ${error.message}`, colors.red);
    return null;
  }
}

/**
 * Write updated package.json with formatting preserved
 */
function writePackageJson(path, packageData) {
  try {
    const content = JSON.stringify(packageData, null, 2) + "\n";

    if (CONFIG.dryRun) {
      logVerbose(`🧪 DRY RUN: Would write to ${path}`);
      return;
    }

    writeFileSync(path, content, "utf8");
    logVerbose(`✅ Updated ${path}`);
  } catch (error) {
    log(`❌ Failed to write ${path}: ${error.message}`, colors.red);
  }
}

/**
 * Update package version in dependencies or devDependencies
 */
function updatePackageVersion(packageData, packageName, newVersion, section) {
  const currentVersion = packageData[section][packageName];

  // Preserve version prefix (^, ~, etc.)
  const versionPrefix = currentVersion.match(/^[^\d]*/)[0];
  const newVersionWithPrefix = versionPrefix + newVersion;

  packageData[section][packageName] = newVersionWithPrefix;

  return {
    old: currentVersion,
    new: newVersionWithPrefix,
  };
}

/**
 * Update packages for a single workspace
 */
function updateWorkspace(workspaceInfo) {
  const { name, path } = workspaceInfo;
  const workspaceDir = dirname(path);

  logVerbose(`\n📦 Processing workspace: ${name}`);

  const outdatedPackages = getOutdatedPackages(workspaceDir);
  const packageData = readPackageJson(path);

  if (!packageData) {
    return { workspace: name, updates: [] };
  }

  if (Object.keys(outdatedPackages).length === 0) {
    logVerbose(`  ✅ All packages up to date`);
    return { workspace: name, updates: [] };
  }

  const updates = [];

  // Process each outdated package
  for (const [packageName, info] of Object.entries(outdatedPackages)) {
    const { current, wanted, latest } = info;

    // Skip if current version is already the wanted version
    if (current === wanted) {
      logVerbose(`  ⏭️  ${packageName}: already at wanted version ${wanted}`);
      continue;
    }

    let updated = false;
    let updateInfo = null;

    // Check in dependencies
    if (packageData.dependencies && packageData.dependencies[packageName]) {
      updateInfo = updatePackageVersion(
        packageData,
        packageName,
        wanted,
        "dependencies",
      );
      updated = true;
    }

    // Check in devDependencies
    if (
      packageData.devDependencies &&
      packageData.devDependencies[packageName]
    ) {
      updateInfo = updatePackageVersion(
        packageData,
        packageName,
        wanted,
        "devDependencies",
      );
      updated = true;
    }

    if (updated && updateInfo) {
      updates.push({
        name: packageName,
        old: updateInfo.old,
        new: updateInfo.new,
        current,
        wanted,
        latest,
      });
    }
  }

  if (updates.length > 0) {
    writePackageJson(path, packageData);
  }

  return { workspace: name, updates };
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
${colors.cyan}Game-Servum Package Updater${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node scripts/update-packages.mjs [options]

${colors.yellow}Options:${colors.reset}
  --dry-run    Show what would be updated without making changes
  --verbose    Show detailed output
  --install    Automatically run npm install after updating packages
  --help       Show this help message

${colors.yellow}Description:${colors.reset}
  This script automatically updates all package.json files in the workspace
  with the latest "wanted" versions from npm outdated. It preserves version 
  prefixes (^, ~) and only updates to compatible versions, not breaking major 
  updates.

  Processes all npm workspaces:
    - root package.json
    - packages/shared
    - client
    - server

  With --install flag, packages are automatically installed after updates,
  making it perfect for CI/CD pipelines.
  `);
}

/**
 * Main function
 */
function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  log("╔════════════════════════════════════════════", colors.cyan);
  log("║  Game-Servum Package Updater               ", colors.cyan);
  log("╚════════════════════════════════════════════", colors.cyan);

  if (CONFIG.dryRun) {
    log("\n🧪 DRY RUN MODE - No changes will be made\n", colors.yellow);
  }

  const workspaces = getWorkspacePackages();
  log(`\n📦 Found ${workspaces.length} workspaces to update\n`, colors.blue);

  const allUpdates = [];

  for (const workspace of workspaces) {
    const result = updateWorkspace(workspace);
    if (result.updates.length > 0) {
      allUpdates.push(result);
    }
  }

  // Report all updates
  if (allUpdates.length === 0) {
    log("\n✅ All packages are up to date!", colors.green);
    return;
  }

  log("\n" + "═".repeat(70), colors.cyan);
  log("📊 Update Summary", colors.cyan);
  log("═".repeat(70) + "\n", colors.cyan);

  let totalUpdates = 0;

  for (const { workspace, updates } of allUpdates) {
    log(`\n📦 ${workspace} (${updates.length} updates):`, colors.blue);

    updates.forEach((update) => {
      const majorUpdate =
        update.wanted !== update.latest ? ` (latest: ${update.latest})` : "";

      log(
        `  ${update.name}: ${update.old} → ${update.new}${majorUpdate}`,
        colors.green,
      );
    });

    totalUpdates += updates.length;
  }

  log(`\n🔢 Total: ${totalUpdates} package updates\n`, colors.cyan);

  // Install packages if requested
  if (!CONFIG.dryRun && CONFIG.install) {
    log("\n📦 Installing updated packages...", colors.cyan);
    try {
      execSync("npm install", {
        stdio: "inherit",
        cwd: ROOT,
      });
      log("\n✅ Packages installed successfully\n", colors.green);
    } catch (error) {
      log(`\n❌ Failed to install packages: ${error.message}\n`, colors.red);
      process.exit(1);
    }
  } else if (!CONFIG.dryRun) {
    log('💡 Run "npm install" to apply the updates\n', colors.yellow);
  }
}

// Execute
try {
  main();
} catch (error) {
  log(`❌ Unexpected error: ${error.message}`, colors.red);
  if (CONFIG.verbose) {
    console.error(error);
  }
  process.exit(1);
}
