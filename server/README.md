# Game-Servum — Agent (Backend)

Express + TypeScript backend for game server management via SteamCMD.

## Quick Start

```bash
# From project root
npm run dev:server    # tsx watch mode on :3001

# From this directory
npm run dev           # tsx watch mode
npm run build         # tsc type-check + compile
npm run build:bundle  # esbuild → agent.mjs (production bundle)
```

## Project Structure

```
src/
├── index.ts        # Entry point, HTTP + WebSocket server, broadcast()
├── app.ts          # Express app, route mounts, public endpoints
├── db/             # sql.js database (11 tables), migrations
├── middleware/     # JWT auth middleware
├── routes/         # REST API endpoints (auth, servers, steamcmd, system)
└── services/       # Business logic (15+ services)
```

## Key Services

**config.ts** — Environment config, path resolution  
**auth.ts** — PBKDF2 + JWT authentication  
**gameDefinitions.ts** — Game server definitions (DayZ, 7DTD, ARK)  
**serverProcess.ts** — Process spawning, crash protection  
**serverInstall.ts** — SteamCMD installation & updates  
**modManager.ts** — Workshop mod management  
**playerTracker.ts** — RCON polling + log parsing  
**scheduler.ts** — Scheduled restarts with warnings  
**updateChecker.ts** — Auto-update detection & restart

## Critical Patterns

⚠️ **sql.js**: Call `saveDatabase()` after every mutation  
⚠️ **ES Modules**: Use `.js` extensions in imports (even for `.ts` files)  
**WebSocket**: `broadcast(type, payload)` from `index.ts`  
**Logging**: Use bracketed prefixes `[ServiceName]`  
**Errors**: Catch → log → broadcast error state, never throw unhandled
