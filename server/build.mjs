import { build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve sql.js WASM file from node_modules
const sqlJsPath = dirname(require.resolve("sql.js"));
const wasmSource = resolve(sqlJsPath, "dist", "sql-wasm.wasm");
const outDir = resolve(__dirname, "dist");

// Ensure dist directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// Copy sql-wasm.wasm to dist/
if (existsSync(wasmSource)) {
  copyFileSync(wasmSource, resolve(outDir, "sql-wasm.wasm"));
  console.log("[Build] Copied sql-wasm.wasm to dist/");
} else {
  // Try alternate location
  const altSource = resolve(sqlJsPath, "sql-wasm.wasm");
  if (existsSync(altSource)) {
    copyFileSync(altSource, resolve(outDir, "sql-wasm.wasm"));
    console.log("[Build] Copied sql-wasm.wasm to dist/ (alt path)");
  } else {
    console.warn(
      "[Build] WARNING: sql-wasm.wasm not found — agent may fail to start!",
    );
  }
}

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: resolve(outDir, "agent.mjs"),
  sourcemap: true,
  minify: false,
  keepNames: true,

  // Node.js built-ins should not be bundled
  external: [],

  // Banner: tell sql.js where to find the WASM file
  banner: {
    js: [
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
      "import { fileURLToPath as __agent_fileURLToPath } from 'url';",
      "import { dirname as __agent_dirname } from 'path';",
      "const __filename = __agent_fileURLToPath(import.meta.url);",
      "const __dirname = __agent_dirname(__filename);",
    ].join("\n"),
  },

  // Define environment
  define: {
    "process.env.NODE_ENV": '"production"',
  },

  // Log level
  logLevel: "info",
});

console.log("[Build] Agent bundled → dist/agent.mjs");
