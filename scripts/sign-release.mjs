/**
 * Game-Servum — GPG Release Signing
 *
 * Signs SHA256SUMS with a GPG detached signature for release verification.
 * Run this AFTER all builds are complete and SHA256SUMS contains all entries.
 *
 * Usage:
 *   npm run sign:release              # Auto-detects version from package.json
 *   node scripts/sign-release.mjs     # Same as above
 *
 * Prerequisites:
 *   - GPG key imported and available (gpg --list-secret-keys)
 *   - SHA256SUMS file in dist/v{version}/
 *
 * Output:
 *   dist/v{version}/SHA256SUMS.sig  (detached ASCII-armored signature)
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const APP_VERSION = pkg.version || "1.0.0";
const DIST_DIR = resolve(ROOT, "dist", `v${APP_VERSION}`);
const SUMS_FILE = resolve(DIST_DIR, "SHA256SUMS");
const SIG_FILE = resolve(DIST_DIR, "SHA256SUMS.sig");

console.log("╔════════════════════════════════════════════");
console.log(`║  Game-Servum Release Signing               `);
console.log(`║  Version: ${APP_VERSION.padEnd(32)}`);
console.log("╚════════════════════════════════════════════");

// ─── 1. Check prerequisites ─────────────────────────────────────

if (!existsSync(SUMS_FILE)) {
  console.error(`\n  ✗ SHA256SUMS not found at: ${SUMS_FILE}`);
  console.error("    Run build scripts first to generate checksums.");
  process.exit(1);
}

// Check GPG is available
try {
  execSync("gpg --version", { stdio: "pipe" });
} catch {
  console.error("\n  ✗ gpg not found!");
  console.error("    Install GnuPG: sudo apt install gnupg");
  process.exit(1);
}

// Check for available secret keys
try {
  const keys = execSync("gpg --list-secret-keys --keyid-format LONG", {
    encoding: "utf-8",
  });
  if (!keys.trim()) {
    console.error("\n  ✗ No GPG secret keys found!");
    console.error("    Generate one: gpg --full-generate-key");
    process.exit(1);
  }
} catch {
  console.error("\n  ✗ Failed to list GPG keys");
  process.exit(1);
}

// ─── 2. Show SHA256SUMS contents ─────────────────────────────────

console.log("\n  SHA256SUMS contents:");
const sumsContent = readFileSync(SUMS_FILE, "utf-8").trim();
for (const line of sumsContent.split("\n")) {
  const [hash, filename] = line.split(/\s+/);
  console.log(`    ${hash.substring(0, 16)}...  ${filename}`);
}

// ─── 3. Sign ─────────────────────────────────────────────────────

console.log("\n  Signing SHA256SUMS with GPG...");
try {
  execSync(`gpg --detach-sign --armor --output "${SIG_FILE}" "${SUMS_FILE}"`, {
    stdio: "inherit",
  });
  console.log("  ✓ Created SHA256SUMS.sig");
} catch {
  console.error("  ✗ GPG signing failed!");
  process.exit(1);
}

// ─── 4. Verify ───────────────────────────────────────────────────

console.log("\n  Verifying signature...");
try {
  execSync(`gpg --verify "${SIG_FILE}" "${SUMS_FILE}"`, {
    stdio: "inherit",
  });
  console.log("  ✓ Signature verified successfully");
} catch {
  console.error("  ✗ Signature verification failed!");
  process.exit(1);
}

// ─── 5. Summary ──────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════════════════════");
console.log(`║  Release v${APP_VERSION} signed successfully`);
console.log("║");
console.log("║  Upload to GitHub Release:");
console.log(`║    ├── SHA256SUMS`);
console.log(`║    └── SHA256SUMS.sig`);
console.log("║");
console.log("║  Users can verify with:");
console.log("║    gpg --import game-servum-release-key.asc");
console.log("║    gpg --verify SHA256SUMS.sig SHA256SUMS");
console.log("║    sha256sum -c SHA256SUMS");
console.log("╚══════════════════════════════════════════════════════════════");
