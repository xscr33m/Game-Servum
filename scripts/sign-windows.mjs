/**
 * Game-Servum — Windows Code Signing Utility
 *
 * Signs Windows executables using signtool.exe with a certificate from the
 * Windows Certificate Store (Certum SimplySign cloud HSM).
 *
 * Prerequisites:
 *   - Certum SimplySign Desktop App running and logged in (OTP session active)
 *   - Windows SDK installed (provides signtool.exe)
 *   - Code signing certificate visible in CurrentUser\My store
 *
 * Environment Variables:
 *   - WIN_CSC_THUMBPRINT — SHA1 thumbprint of the certificate (recommended when multiple certs installed)
 *   - WIN_CSC_NAME       — Certificate subject name (CN) as alternative to thumbprint
 *   - SKIP_CODE_SIGNING  — Set to "true" to skip signing (for dev builds)
 *   - SIGNTOOL_PATH      — Custom path to signtool.exe (auto-detected if not set)
 *
 * Usage:
 *   import { signFile, isSigningAvailable } from "./sign-windows.mjs";
 *   if (isSigningAvailable()) await signFile("path/to/file.exe");
 */
import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { resolve } from "path";

const TIMESTAMP_SERVER = "http://time.certum.pl";
const DIGEST_ALGORITHM = "sha256";

/**
 * Find signtool.exe from Windows SDK installations.
 * @returns {string | null} Path to signtool.exe or null if not found.
 */
function findSigntoolSync() {
  if (process.env.SIGNTOOL_PATH) {
    if (existsSync(process.env.SIGNTOOL_PATH)) {
      return process.env.SIGNTOOL_PATH;
    }
    console.warn(
      `  ⚠ SIGNTOOL_PATH set but not found: ${process.env.SIGNTOOL_PATH}`,
    );
  }

  const sdkBase = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (existsSync(sdkBase)) {
    try {
      const versions = readdirSync(sdkBase)
        .filter((d) => d.startsWith("10."))
        .sort()
        .reverse();

      for (const ver of versions) {
        const candidate = resolve(sdkBase, ver, "x64", "signtool.exe");
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // Fall through
    }
  }

  try {
    execSync("signtool.exe /?", { stdio: "ignore" });
    return "signtool.exe";
  } catch {
    return null;
  }
}

/**
 * Get the resolved path to signtool.exe.
 * @returns {string | null} Path to signtool.exe or null if not found/not Windows.
 */
export function getSigntoolPath() {
  if (process.platform !== "win32") return null;
  return findSigntoolSync();
}

/**
 * Check if code signing is available and not skipped.
 * @returns {boolean}
 */
export function isSigningAvailable() {
  if (process.env.SKIP_CODE_SIGNING === "true") {
    return false;
  }

  if (process.platform !== "win32") {
    return false;
  }

  return findSigntoolSync() !== null;
}

/**
 * Sign a Windows executable using signtool.exe.
 *
 * @param {string} filePath — Absolute path to the file to sign.
 * @param {object} [options]
 * @param {boolean} [options.verbose=true] — Show verbose signtool output.
 * @throws {Error} If signing fails.
 */
export function signFile(filePath, options = {}) {
  const { verbose = true } = options;

  if (process.env.SKIP_CODE_SIGNING === "true") {
    console.log(`  ⏭ Skipping code signing (SKIP_CODE_SIGNING=true)`);
    return;
  }

  if (process.platform !== "win32") {
    console.log(`  ⏭ Skipping code signing (not Windows)`);
    return;
  }

  const signtool = findSigntoolSync();
  if (!signtool) {
    console.error("  ✗ signtool.exe not found!");
    console.error(
      "    Install Windows SDK: winget install Microsoft.WindowsSDK",
    );
    console.error(
      "    Or set SIGNTOOL_PATH environment variable to signtool.exe location.",
    );
    throw new Error("signtool.exe not found");
  }

  // Build signtool arguments
  const args = ["sign"];

  // Certificate selection: thumbprint (most reliable) > subject name > auto-select
  if (process.env.WIN_CSC_THUMBPRINT) {
    args.push("/sha1", process.env.WIN_CSC_THUMBPRINT);
  } else if (process.env.WIN_CSC_NAME) {
    args.push("/n", `"${process.env.WIN_CSC_NAME}"`);
  } else {
    // /a = auto-select best signing certificate
    args.push("/a");
  }

  // Timestamp (RFC 3161) + digest algorithms
  args.push("/tr", TIMESTAMP_SERVER);
  args.push("/td", DIGEST_ALGORITHM);
  args.push("/fd", DIGEST_ALGORITHM);

  if (verbose) {
    args.push("/v");
  }

  // File to sign
  args.push(`"${filePath}"`);

  const cmd = `"${signtool}" ${args.join(" ")}`;

  console.log(`  Signing: ${filePath.split(/[\\/]/).pop()}`);
  try {
    execSync(cmd, { stdio: "inherit" });
    console.log(`  ✓ Signed successfully`);
  } catch (err) {
    console.error(`  ✗ Signing failed!`);
    console.error("    Ensure SimplySign Desktop is running and logged in.");
    console.error(
      "    Generate a new OTP in the SimplySign Mobile App if the session expired.",
    );
    throw new Error(`Code signing failed for ${filePath}`);
  }
}

/**
 * Verify the signature of a signed file.
 *
 * @param {string} filePath — Absolute path to the file to verify.
 * @returns {boolean} True if signature is valid.
 */
export function verifySignature(filePath) {
  const signtool = findSigntoolSync();
  if (!signtool) return false;

  try {
    execSync(`"${signtool}" verify /pa /v "${filePath}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Print signing configuration status.
 */
export function printSigningStatus() {
  if (process.env.SKIP_CODE_SIGNING === "true") {
    console.log("  Code signing: SKIPPED (SKIP_CODE_SIGNING=true)");
    return;
  }

  if (process.platform !== "win32") {
    console.log("  Code signing: SKIPPED (not Windows)");
    return;
  }

  const signtool = findSigntoolSync();
  if (!signtool) {
    console.log("  Code signing: UNAVAILABLE (signtool.exe not found)");
    return;
  }

  const method = process.env.WIN_CSC_THUMBPRINT
    ? `thumbprint: ${process.env.WIN_CSC_THUMBPRINT.substring(0, 8)}...`
    : process.env.WIN_CSC_NAME
      ? `subject: "${process.env.WIN_CSC_NAME}"`
      : "auto-select (/a)";

  console.log(`  Code signing: ENABLED (${method})`);
  console.log(`  Timestamp: ${TIMESTAMP_SERVER}`);
}
