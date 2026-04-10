/**
 * Custom signing function for electron-builder.
 *
 * electron-builder calls this for every file that needs signing.
 * Uses signtool.exe with /a (auto-select best certificate) which works
 * reliably with Certum SimplySign cloud HSM certificates.
 *
 * CommonJS format required — electron-builder loads this via require().
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const TIMESTAMP_SERVER = "http://time.certum.pl";

function findSigntool() {
  if (process.env.SIGNTOOL_PATH && fs.existsSync(process.env.SIGNTOOL_PATH)) {
    return process.env.SIGNTOOL_PATH;
  }

  const sdkBase = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (fs.existsSync(sdkBase)) {
    try {
      const versions = fs
        .readdirSync(sdkBase)
        .filter((d) => d.startsWith("10."))
        .sort()
        .reverse();

      for (const ver of versions) {
        const candidate = path.resolve(sdkBase, ver, "x64", "signtool.exe");
        if (fs.existsSync(candidate)) return candidate;
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

exports.default = async function sign(configuration) {
  const signtool = findSigntool();
  if (!signtool) {
    throw new Error(
      "signtool.exe not found. Install Windows SDK: winget install Microsoft.WindowsSDK",
    );
  }

  const args = ["sign"];

  // Certificate selection: thumbprint > subject name > auto-select
  if (process.env.WIN_CSC_THUMBPRINT) {
    args.push("/sha1", process.env.WIN_CSC_THUMBPRINT);
  } else if (process.env.WIN_CSC_NAME) {
    args.push("/n", `"${process.env.WIN_CSC_NAME}"`);
  } else {
    args.push("/a");
  }

  // RFC 3161 timestamp + SHA-256
  args.push("/tr", TIMESTAMP_SERVER);
  args.push("/td", "sha256");
  args.push("/fd", "sha256");

  // File to sign
  args.push(`"${configuration.path}"`);

  const cmd = `"${signtool}" ${args.join(" ")}`;

  // Retry with delay — cloud HSM can fail with NTE_FAIL (0x80090020)
  // when signing multiple files in rapid succession
  const maxRetries = 3;
  const retryDelay = 3000; // 3 seconds between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync(cmd, { stdio: "inherit" });
      return; // Success
    } catch (err) {
      if (attempt < maxRetries) {
        const filename = path.basename(configuration.path);
        console.log(
          `  ⚠ Signing attempt ${attempt}/${maxRetries} failed for ${filename}, retrying in ${retryDelay / 1000}s...`,
        );
        await sleep(retryDelay * attempt); // Increasing delay: 3s, 6s, 9s
      } else {
        throw err; // Final attempt failed — propagate error
      }
    }
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
