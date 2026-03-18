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
├── index.ts            # Entry point, HTTP + WebSocket server, broadcast()
├── app.ts              # Express app, route mounts, public endpoints
├── core/
│   ├── rcon/           # RCON protocols (BattlEye UDP, Source TCP, Telnet)
│   └── installers/     # Game installer interfaces
├── db/                 # sql.js database, versioned migrations
├── games/              # Game adapter modules (one per game)
│   ├── base.ts         # BaseGameAdapter with shared defaults
│   ├── types.ts        # GameAdapter interface, GameDefinition type
│   ├── dayz/           # DayZ adapter (BattlEye RCON, ADM logs, mod keys)
│   ├── ark/            # ARK adapter (Source RCON, INI config, map selection)
│   └── 7dtd/           # 7DTD adapter (Telnet RCON, XML config)
├── middleware/          # JWT auth middleware
├── routes/             # REST API (auth, servers, steamcmd, system, logs)
├── services/           # Business logic (18 services)
└── types/              # TypeScript type definitions
```

## Key Services

- **config.ts** — Environment config, path resolution
- **auth.ts** — PBKDF2 + JWT authentication
- **serverProcess.ts** — Process spawning, crash protection, startup detection
- **serverInstall.ts** — SteamCMD installation & updates
- **modManager.ts** — Workshop mod install/update/uninstall, `-mod=` param generation
- **playerTracker.ts** — RCON polling + game-specific log backfill
- **scheduler.ts** — Scheduled restarts with RCON warnings
- **messageBroadcaster.ts** — Recurring RCON broadcast messages
- **updateChecker.ts** — Game/mod update detection & auto-restart
- **agentUpdater.ts** — Self-update via GitHub Releases
- **firewallManager.ts** — Windows Firewall rule management per server
- **systemMonitor.ts** — CPU, memory, disk, network metrics
- **logger.ts** — App-level logging with daily rotation
- **logManager.ts** — Game server log archiving & retention
- **variableResolver.ts** — `{VARIABLE}` placeholder resolution

## Critical Patterns

- ⚠️ **sql.js**: Call `saveDatabase()` after every mutation
- ⚠️ **ES Modules**: Use `.js` extensions in imports (even for `.ts` files)
- **WebSocket**: `broadcast(type, payload)` from `index.ts`
- **Game adapters**: Each game in `games/{id}/adapter.ts` extends `BaseGameAdapter`
- **Logging**: Use bracketed prefixes `[ServiceName]`
- **Errors**: Catch → log → broadcast error state, never throw unhandled
