/**
 * Game-Servum — Version Bump Script
 *
 * Bumps the version across all workspace packages and the shared
 * APP_VERSION constant in a single command.
 *
 * Usage:
 *   node scripts/bump-version.mjs <version>
 *   node scripts/bump-version.mjs <major|minor|patch>
 *   node scripts/bump-version.mjs <version> --min-agent <version>
 *
 * Examples:
 *   node scripts/bump-version.mjs 0.10.0
 *   node scripts/bump-version.mjs patch
 *   node scripts/bump-version.mjs 1.0.0 --min-agent 1.0.0
 *
 * What it does:
 *   1. Validates the version argument (SemVer format or major/minor/patch)
 *   2. Runs `npm version` across all workspaces + root (updates all package.json)
 *   3. Updates APP_VERSION in packages/shared/src/constants/index.ts
 *   4. Optionally updates MIN_COMPATIBLE_AGENT_VERSION (--min-agent flag)
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONSTANTS_FILE = resolve(ROOT, "packages/shared/src/constants/index.ts");

// ── Helpers ──────────────────────────────────────────────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const BUMP_KEYWORDS = ["major", "minor", "patch"];

function readCurrentVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  return pkg.version;
}

function incrementVersion(current, keyword) {
  const parts = current.split(".").map(Number);
  switch (keyword) {
    case "major":
      return `${parts[0] + 1}.0.0`;
    case "minor":
      return `${parts[0]}.${parts[1] + 1}.0`;
    case "patch":
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      throw new Error(`Unknown bump keyword: ${keyword}`);
  }
}

function replaceConstant(source, name, newValue) {
  const re = new RegExp(`(export const ${name}\\s*=\\s*")([^"]*)(")`);
  if (!re.test(source)) {
    throw new Error(`Could not find 'export const ${name}' in constants file`);
  }
  return source.replace(re, `$1${newValue}$3`);
}

// ── Parse arguments ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(`
Usage: node scripts/bump-version.mjs <version|major|minor|patch> [options]

Arguments:
  version          SemVer string (e.g. 0.10.0) or keyword (major, minor, patch)

Options:
  --min-agent <v>  Also update MIN_COMPATIBLE_AGENT_VERSION to <v>
  --help, -h       Show this help message

Examples:
  node scripts/bump-version.mjs 0.10.0
  node scripts/bump-version.mjs patch
  node scripts/bump-version.mjs 1.0.0 --min-agent 1.0.0
`);
  process.exit(0);
}

const versionArg = args[0];
const minAgentIdx = args.indexOf("--min-agent");
const minAgentVersion = minAgentIdx !== -1 ? args[minAgentIdx + 1] : undefined;

// Validate --min-agent value if provided
if (minAgentVersion !== undefined && !SEMVER_RE.test(minAgentVersion)) {
  console.error(
    `Error: --min-agent value "${minAgentVersion}" is not a valid SemVer string (x.y.z)`,
  );
  process.exit(1);
}

// ── Resolve target version ───────────────────────────────────────────────

const currentVersion = readCurrentVersion();
let targetVersion;

if (BUMP_KEYWORDS.includes(versionArg)) {
  targetVersion = incrementVersion(currentVersion, versionArg);
} else if (SEMVER_RE.test(versionArg)) {
  targetVersion = versionArg;
} else {
  console.error(
    `Error: "${versionArg}" is not a valid SemVer string (x.y.z) or keyword (major, minor, patch)`,
  );
  process.exit(1);
}

console.log(`\nBumping version: ${currentVersion} → ${targetVersion}\n`);

// ── Step 1: Update all package.json files via npm ────────────────────────

console.log("Updating package.json files...");
try {
  execSync(
    `npm version ${targetVersion} --no-git-tag-version --workspaces --include-workspace-root`,
    { cwd: ROOT, stdio: "pipe" },
  );
} catch (err) {
  console.error(
    "Failed to run npm version:",
    err.stderr?.toString() || err.message,
  );
  process.exit(1);
}

// Manually bump electron/package.json (not a workspace, but uses shared version)
const electronPkgPath = resolve(ROOT, "electron/package.json");
const electronPkg = JSON.parse(readFileSync(electronPkgPath, "utf-8"));
electronPkg.version = targetVersion;
writeFileSync(
  electronPkgPath,
  JSON.stringify(electronPkg, null, 2) + "\n",
  "utf-8",
);

// Verify all package.json files
const pkgPaths = [
  "package.json",
  "packages/shared/package.json",
  "client/package.json",
  "server/package.json",
  "electron/package.json",
];
for (const rel of pkgPaths) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, rel), "utf-8"));
  console.log(`  ✓ ${rel} → ${pkg.version}`);
}

// ── Step 2: Update shared constants file ─────────────────────────────────

console.log("\nUpdating shared constants...");
let source = readFileSync(CONSTANTS_FILE, "utf-8");

source = replaceConstant(source, "APP_VERSION", targetVersion);
console.log(`  ✓ APP_VERSION → "${targetVersion}"`);

if (minAgentVersion) {
  source = replaceConstant(
    source,
    "MIN_COMPATIBLE_AGENT_VERSION",
    minAgentVersion,
  );
  console.log(`  ✓ MIN_COMPATIBLE_AGENT_VERSION → "${minAgentVersion}"`);
}

writeFileSync(CONSTANTS_FILE, source, "utf-8");
console.log(`  ✓ ${CONSTANTS_FILE.replace(ROOT + "/", "")}`);

// ── Done ─────────────────────────────────────────────────────────────────

console.log(`\n✅ Version bumped to ${targetVersion}`);
if (minAgentVersion) {
  console.log(`   MIN_COMPATIBLE_AGENT_VERSION set to ${minAgentVersion}`);
}
console.log(
  "\nNext steps:\n" +
    "  1. Review the changes\n" +
    "  2. Commit and push\n" +
    "  3. Build on Windows: npm run build:agent && npm run build:commander\n" +
    "  4. Build on Linux:   npm run build:linux\n",
);
