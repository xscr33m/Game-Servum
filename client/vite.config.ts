import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // In dev mode, read .env from project root for environment variables
  ...(command === "serve" ? { envDir: path.resolve(__dirname, "..") } : {}),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },
      "/commander/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
}));
