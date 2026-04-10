/**
 * Game-Servum — SHA256 Checksum Utility
 *
 * Generates SHA256 checksums for release artifacts and appends them
 * to a SHA256SUMS file in GNU coreutils format (compatible with sha256sum -c).
 *
 * Usage:
 *   import { appendToChecksums } from "./checksum.mjs";
 *   appendToChecksums("/path/to/file.exe", "/path/to/dist/v1.0.0/");
 */
import { createHash } from "crypto";
import { createReadStream, appendFileSync, existsSync } from "fs";
import { basename, resolve } from "path";

/**
 * Calculate SHA256 hash of a file.
 * @param {string} filePath — Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded SHA256 hash.
 */
export function calculateSHA256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Generate a SHA256SUMS-compatible line for a file.
 * Format: "<hash>  <filename>" (two spaces = binary mode indicator, GNU coreutils standard)
 *
 * @param {string} filePath — Absolute path to the file.
 * @returns {Promise<string>} Formatted checksum line.
 */
export async function generateChecksumLine(filePath) {
  const hash = await calculateSHA256(filePath);
  const filename = basename(filePath);
  return `${hash}  ${filename}`;
}

/**
 * Append a file's SHA256 checksum to the SHA256SUMS file in the given directory.
 * Creates the file if it doesn't exist.
 *
 * @param {string} filePath — Absolute path to the file to checksum.
 * @param {string} distDir — Directory where SHA256SUMS should be written/appended.
 */
export async function appendToChecksums(filePath, distDir) {
  if (!existsSync(filePath)) {
    console.warn(`  ⚠ Checksum skipped: file not found: ${basename(filePath)}`);
    return;
  }

  const line = await generateChecksumLine(filePath);
  const sumsPath = resolve(distDir, "SHA256SUMS");
  appendFileSync(sumsPath, line + "\n", "utf-8");
  console.log(`  ✓ SHA256: ${basename(filePath)}`);
}
