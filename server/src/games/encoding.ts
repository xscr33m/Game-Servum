/**
 * Encoding-aware file reading for game server config/log files.
 *
 * Unreal Engine 4 (ARK, etc.) may write INI files in UTF-16 LE after the
 * server modifies them at runtime, even if the initial install uses UTF-8.
 * Node.js `readFileSync('utf-8')` cannot decode UTF-16, producing garbled
 * text with null bytes between every character.
 *
 * This module detects the file encoding from the BOM and decodes accordingly.
 */

import fs from "fs";

/**
 * Read a text file with automatic encoding detection.
 * Supports UTF-16 LE (FF FE), UTF-16 BE (FE FF), UTF-8 BOM, and plain UTF-8.
 * Returns a clean UTF-8 string with BOM stripped.
 */
export function readGameFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);

  if (buf.length === 0) return "";

  // Detect encoding from BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16 LE BOM — skip 2-byte BOM, decode as utf16le
    return buf.subarray(2).toString("utf16le");
  }

  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE BOM — swap bytes then decode as utf16le
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i < buf.length - 1; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }

  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    // UTF-8 BOM — skip 3-byte BOM
    return buf.subarray(3).toString("utf-8");
  }

  // No BOM — check for UTF-16 LE without BOM (common: null bytes at odd positions)
  // Heuristic: if the second byte is 0x00 and first byte is ASCII, it's likely UTF-16 LE
  if (
    buf.length >= 4 &&
    buf[1] === 0x00 &&
    buf[0] !== 0x00 &&
    buf[3] === 0x00
  ) {
    return buf.toString("utf16le");
  }

  // Default: UTF-8
  return buf.toString("utf-8");
}
