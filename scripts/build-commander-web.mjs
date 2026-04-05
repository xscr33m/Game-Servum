/**
 * Game-Servum Commander — Web (Docker) Builder
 *
 * Builds the Commander as a self-contained web application
 * served by a lightweight Express server.
 *
 * Steps:
 *  1. Build shared types
 *  2. Build client (Vite) with VITE_WEB_MODE=true
 *  3. Build commander-server (TypeScript)
 *  4. Stage output for Docker / standalone deployment
 *
 * Output: dist/web/
 *   ├── public/        ← built React client
 *   ├── server/        ← built Express server
 *   └── package.json   ← production dependencies
 */
import { execSync } from "child_process";
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const APP_VERSION = pkg.version || "1.0.0";

const OUTPUT = resolve(ROOT, "dist", "web");

console.log("╔════════════════════════════════════════════");
console.log(`║  Game-Servum Commander Builder (Web)       `);
console.log(`║  Version: ${APP_VERSION.padEnd(32)}`);
console.log("╚════════════════════════════════════════════");

// ─── 1. Build shared types ─────────────────────────────────────

console.log("\n[1/4] Building shared types...");
execSync("npm run build -w @game-servum/shared", {
  cwd: ROOT,
  stdio: "inherit",
});

// ─── 2. Build client with web mode ─────────────────────────────

console.log("\n[2/4] Building client (web mode)...");
execSync("npx vite build", {
  cwd: resolve(ROOT, "client"),
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_WEB_MODE: "true",
  },
});

// ─── 3. Build commander-server ───────────────────────────────────

console.log("\n[3/4] Building commander-server...");
execSync("npx tsc", {
  cwd: resolve(ROOT, "commander-server"),
  stdio: "inherit",
});

// ─── 4. Stage output ─────────────────────────────────────────────

console.log("\n[4/4] Staging output...");

if (existsSync(OUTPUT)) {
  rmSync(OUTPUT, { recursive: true });
}
mkdirSync(OUTPUT, { recursive: true });

// Copy built client → dist/web/public/
cpSync(resolve(ROOT, "client", "dist"), resolve(OUTPUT, "public"), {
  recursive: true,
});

// Copy built server → dist/web/server/
cpSync(resolve(ROOT, "commander-server", "dist"), resolve(OUTPUT, "server"), {
  recursive: true,
});

// Create production package.json
const serverPkg = JSON.parse(
  readFileSync(resolve(ROOT, "commander-server", "package.json"), "utf-8"),
);
const prodPkg = {
  name: "game-servum-commander-web",
  version: APP_VERSION,
  type: "module",
  main: "server/index.js",
  scripts: {
    start: "node server/index.js",
  },
  dependencies: serverPkg.dependencies || {},
};
writeFileSync(
  resolve(OUTPUT, "package.json"),
  JSON.stringify(prodPkg, null, 2),
);

console.log("\n╔════════════════════════════════════════════");
console.log("║  Build complete!");
console.log(`║  Output: dist/web/`);
console.log("║");
console.log("║  To run locally:");
console.log("║    cd dist/web && npm install && npm start");
console.log("║");
console.log("║  To build Docker image:");
console.log("║    docker build -t game-servum-commander .");
console.log("╚════════════════════════════════════════════");
