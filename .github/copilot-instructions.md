# Game-Servum - AI Coding Instructions

> **For AI coding agents:** Everything you need is in this file. All context is inline for maximum productivity.
>
> **For human developers:** Organized topic-specific documentation is available in [`docs/`](../docs/) — see root [README.md](../README.md) for the complete list.
>
> **Optional deep-dive:** Reference detailed docs only when you need comprehensive coverage of specific topics (architecture, troubleshooting, etc.).

## Quick Reference

**Critical Files:**

- [`server/src/games/`](../server/src/games/) — Game adapter modules (one directory per game: `dayz/`, `ark/`, `7dtd/`)
- [`client/src/games/`](../client/src/games/) — Frontend game plugins (config editors, metadata, registry)
- [`packages/shared/src/constants/index.ts`](../packages/shared/src/constants/index.ts) — Version constants (must match `package.json`)
- [`server/src/db/index.ts`](../server/src/db/index.ts) — Database CRUD operations
- [`server/src/db/migrations.ts`](../server/src/db/migrations.ts) — Versioned DB schema migrations
- [`client/src/contexts/BackendContext.tsx`](../client/src/contexts/BackendContext.tsx) — Multi-agent connection management
- [`electron/main/main-unified.js`](../electron/main/main-unified.js) — Electron entry point (Commander only)
- [`service/winsw/GameServumAgent.xml`](../service/winsw/GameServumAgent.xml) — WinSW Windows Service configuration for Agent
- [`client/src/pages/Settings.tsx`](../client/src/pages/Settings.tsx) — Settings page with Data Management section

**Service orchestration:** `server/src/index.ts` coordinates startup → `serverProcess.ts` spawns games → triggers `playerTracker`, `scheduler`, `messageBroadcaster`, `updateChecker`

**Data mutation pattern:** Always call `saveDatabase()` after any DB write (sql.js is in-memory)

**WebSocket broadcast:** Import `broadcast` from `../index.js` in services → push real-time updates to all clients

## Architecture Overview

Monorepo for a web-based game server management tool using SteamCMD.

**Platform Support:**

- **Agent (backend)**: Windows only (game servers require Windows)
- **Commander (frontend)**: Windows, Linux, macOS (browser or Electron)
- **Development**: Any platform with Node.js 20+

| Layer         | Stack                                                                 | Location              |
| ------------- | --------------------------------------------------------------------- | --------------------- |
| Frontend      | React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + shadcn/ui           | `client/`             |
| Backend       | Node.js + Express + TypeScript + sql.js (SQLite in-memory)            | `server/`             |
| Shared Types  | TypeScript types & constants package                                  | `packages/shared/`    |
| Agent Service | WinSW Windows Service + Node.js + esbuild bundle                      | `service/`, `server/` |
| Desktop       | Electron 40 (Commander only)                                          | `electron/`           |
| Communication | REST (`/api/*` + `/api/v1/*`) + WebSocket (`/ws`) + optional JWT auth | —                     |

## Development Commands

**Secure dependency installation** (recommended for all contributors):

```bash
npm config set min-release-age 3   # Block packages published < 3 days ago (supply chain protection)
npm install --package-lock-only    # Resolve dependency tree without installing
npm audit                          # Check for vulnerabilities
npm audit fix                      # Fix vulnerabilities (only if audit found issues)
npm ci                             # Install from verified lock file
```

**Development & build commands:**

```bash
npm run dev                  # Starts shared (watch) + client (:5173) + server (:3001) via concurrently
npm run dev:client           # Vite dev server with HMR + proxy to backend
npm run dev:server           # tsx watch mode
npm run build                # Build shared → server (tsc) → client (vite build)
npm run build:agent          # Build Agent-only Windows installer (~100 MB) — Windows only
npm run build:commander      # Build Commander-only Windows installer (~90 MB) — Windows only
npm run build:linux          # Build Commander AppImage for Linux (Commander-only, no Agent) — Linux only
npm run update:check         # Check all workspace packages for available updates (dry-run)
npm run update:install       # Update workspace packages to latest versions
npm run clean                # Clear build caches and dist folders
npm run lint                 # ESLint across all workspaces (client, server, shared)
npm run lint:fix             # ESLint with auto-fix
```

**Platform-Specific Build Requirements:**

- `build:agent` requires Windows (uses NSIS installer, bundles Node.js runtime + WinSW service wrapper)
- `build:commander` requires Windows (uses Squirrel.Windows installer, Electron only)
- `build:linux` requires Linux build environment (uses `mksquashfs`, `AppImage` tools)
- `dev` and `build` work on any platform but agent runtime is Windows-only

**⚠️ Important:** For a full release, build Windows installers (`build:agent` + `build:commander`) on Windows, then build Linux AppImage (`build:linux`) on Linux separately.

**Testing & Linting:**

- ❌ No test framework configured
- ✅ ESLint configured project-wide (see root `eslint.config.js`)
  - Client: `js.configs.recommended` + `tseslint.configs.recommended` + React Hooks + React Refresh + browser globals
  - Server: `js.configs.recommended` + `tseslint.configs.recommended` + Node.js globals
  - Shared: `js.configs.recommended` + `tseslint.configs.recommended` + Node.js globals
  - Ignored: `electron/`, `scripts/`, `service/`, `docs/`, `**/dist/`
  - Convention: `_`-prefixed unused vars/args are allowed (`argsIgnorePattern: "^_"`)

## TypeScript & Module Conventions

- **ES Modules everywhere**: Use `.js` extensions in server imports even for `.ts` files (`import { foo } from "./bar.js"`)
- **Client path alias**: `@/` → `src/` (configured in `vite.config.ts`)
- **Shared types**: `@game-servum/shared` package in `packages/shared/` — shared types are re-exported from both `client/src/types/index.ts` and `server/src/types/index.ts`
- **Local-only types**: Server keeps `PlayerSession`, `AppConfig` locally; Client keeps `GameDefinition`, `LogFile`, `ArchiveSession` locally
- **npm workspaces**: Root `package.json` manages `packages/shared`, `client`, `server`
- **Electron config**: `electron/package.json` holds Electron dependencies and shared build config (not a workspace — read directly by build scripts to avoid installing ~180MB of Electron packages during development)

## Backend Patterns

### Service Layer (`server/src/services/`)

- `config.ts` — Loads `.env` via dotenv, resolves paths via env vars with fallback to project root: `steamcmd/`, `servers/`, `data/`. Environment variables:
  - `GAME_SERVUM_ROOT` — Overrides auto-detected root directory (used by NSIS installer)
  - `STEAMCMD_PATH`, `SERVERS_PATH`, `DATA_PATH`, `LOGS_PATH` — Custom paths (relative to root or absolute)
  - `PORT` (default: 3001), `HOST` (default: 0.0.0.0), `CORS_ORIGINS` (default: \*)
  - `AUTH_ENABLED` (default: true), `JWT_SECRET` — Authentication config (enabled by default for security)
- `agentSettings.ts` — Manages Windows Service auto-start toggle via `sc.exe` commands. `getAutoStartEnabled()` checks `sc qc GameServumAgent` (`AUTO_START=2`), `setAutoStartEnabled()` uses `sc config start= auto/demand`. Also provides `getServiceState()` for service status. Platform guard: returns false/null on non-Windows
- `agentUpdater.ts` — Standalone self-updater using GitHub Releases API. Checks `https://api.github.com/repos/xscr33m/Game-Servum/releases/latest` for update ZIPs. Downloads to `data/.update-staging/`, installs via PowerShell script (stop service → extract → start). State persisted to `data/.agent-update-state.json`. Auto-check timer: configurable interval (default 4h). Broadcasts WebSocket events: `update:detected`, `update-check:complete`, `update:applied`, `update:restart`
- `auth.ts` — API-Key + Password authentication. PBKDF2 (100k iterations, SHA-512) password hashing, SHA-256 key hashing, JWT session tokens (24h). Auto-generates initial credentials on first start when auth enabled, writes `CREDENTIALS.txt` to data directory
- `serverProcess.ts` — Spawns game servers, tracks PIDs in `runningProcesses` Map, handles graceful shutdown (`taskkill` on Windows). Crash protection: max 3 crashes in 10 minutes, 10s restart delay. On start: resolves launch param placeholders via `variableResolver`, appends mod params, archives old logs, starts player tracking + scheduler + message broadcaster + update checker. Startup detection delegates to `adapter.getStartupDetector()` (stdout pattern, logfile watcher, or timeout)
- `serverInstall.ts` — Drives SteamCMD to install/update game servers, tracks active installs in a Map. Progress tracking via `console_log.txt` polling (500ms). Exports `updateServer()` for validate+update flows
- `modManager.ts` — Workshop mod install/uninstall via SteamCMD, copies mods to server directory as `@SafeModName`, generates `-mod=` and `-serverMod=` launch params. Update checking via Steam Workshop API (`time_updated` comparison). Supports `cancelModInstallation()`. Mod uninstall delegates to `adapter.uninstallMod()` for game-specific cleanup
- `playerTracker.ts` — Dual tracking: RCON polling (primary, every 15s) + ADM log parsing (historical backfill). Auto-reconnect RCON on disconnect (30s delay). Character ID sync from ADM logs
- `steamcmd.ts` — Downloads SteamCMD, handles interactive login (including Steam Guard flow) with state machine: `idle → started → awaiting_guard → success/failed`. 60s login timeout
- RCON protocols now live in `server/src/core/rcon/` (BattlEye UDP, Source TCP, Telnet) — see Game Module System below
- `scheduler.ts` — Configurable restart interval (hours) with pre-restart RCON warnings at configurable minute offsets. Warning message templates support `{MINUTES}` placeholder. Exports `startSchedule()`, `clearSchedule()`, `initializeSchedules()`
- `messageBroadcaster.ts` — Sends recurring RCON messages at per-message configurable intervals. Uses `variableResolver` for template variables. Exports `startMessageBroadcaster()`, `stopMessageBroadcaster()`, `reloadMessageBroadcaster()`, `initializeMessageBroadcasters()`
- `updateChecker.ts` — Checks for game server updates (SteamCMD `app_info_print` + buildid comparison) and mod updates (Workshop API). Auto-restart on update: configurable delay, RCON warning schedule, stop → update → restart. First check 30s after server starts. Broadcasts `update:detected` and `update:restart` WS events
- `variableResolver.ts` — Resolves `{VARIABLE}` placeholders in templates. Built-in variables: `{SERVER_NAME}`, `{PORT}`, `{PLAYER_COUNT}`, `{NEXT_RESTART}`, `{MINUTES}`. Also loads custom per-server variables from DB. Prevents overriding builtins
- `logManager.ts` — Archives `.ADM`, `.RPT`, `.log` files to timestamped subfolders under `profiles/_log_archives/`. Configurable retention (default 30 days, 0=keep forever). Path traversal prevention, log-extension whitelist
- `systemMonitor.ts` — CPU (via `os.cpus()` delta), memory (`os.totalmem()`/`os.freemem()`), disk (PowerShell `Get-CimInstance`), network (`netstat -e` with rate calculation)
- `logger.ts` — App-level logging service (not game server logs). Zero-dependency, uses only Node.js `fs`. Daily rotation, configurable buffering (100 entries), auto-cleanup based on retention. Logs to `{logsPath}/{context}-{date}.log`. Supports runtime settings updates via `updateSettings()`. Buffer flushes every 5s

### Database (`server/src/db/`)

- Uses **sql.js** (SQLite compiled to WASM, runs in-memory). Must call `saveDatabase()` after every mutation to flush to disk at `data/gameservum.db`
- All queries use raw SQL with positional `?` params and manual row-to-object mapping (no ORM)
- **Migrations** (`db/migrations.ts`): Versioned migration system with `schema_versions` table. Each migration has an `up()` function wrapped in a transaction. Add new migrations to the `MIGRATIONS` array with an incremented version number. `runMigrations()` applies pending migrations in order
- Tables:
  - `steam_config` — Steam credentials
  - `game_servers` — Server instances (18+ columns including `profiles_path`, `auto_restart`)
  - `server_mods` — Workshop mods per server (includes `workshop_updated_at`)
  - `player_sessions` — Player connect/disconnect tracking (includes `character_id`)
  - `api_keys` — Auth API keys (created via migration)
  - `log_settings` — Per-server log archiving/retention config
  - `server_schedules` — Scheduled restart config
  - `server_messages` — Recurring RCON broadcast messages
  - `server_variables` — Custom template variables per server
  - `update_restart_settings` — Auto-update-restart config
  - `app_settings` — Global application settings

### Middleware (`server/src/middleware/`)

- `auth.ts` — JWT session token verification. Skips auth when `AUTH_ENABLED=false` (default). Public paths: `/api/v1/health`, `/api/v1/info`, `/api/v1/auth/connect`, `/api/v1/auth/refresh`

### Routes (`server/src/routes/`)

- `auth.ts` — `/api/v1/auth/*` endpoints (connect, refresh, key CRUD, password change)
- `servers.ts` — All `/api/v1/servers/*` endpoints. Major endpoint groups:
  - Server CRUD: `GET /`, `GET /:id`, `POST /`, `DELETE /:id` (requires name confirmation)
  - Lifecycle: `POST /:id/start`, `POST /:id/stop`, `GET /:id/requirements`
  - Games: `GET /games/list`, `GET /games/suggest-port/:gameId`, `POST /games/check-port-conflict`
  - Settings: `PUT /:id/launch-params`, `PUT /:id/profiles-path`, `PUT /:id/port`, `PUT /:id/name`, `PUT /:id/auto-restart`
  - Config/Files: `GET|PUT /:id/config`, `GET|PUT /:id/files/:filename` (whitelist: `ban.txt`, `whitelist.txt`, `BEServer_x64.cfg`)
  - Mods: `GET|POST /:id/mods`, `PUT|DELETE /:id/mods/:modId`, `POST /:id/mods/:modId/reinstall`, `POST /:id/mods/reorder`
  - Players: `GET /:id/players`, `POST|DELETE /:id/players/whitelist`, `POST|DELETE /:id/players/ban`
  - Logs: `GET /:id/logs`, log content, archives, settings
  - Schedule: `GET|PUT /:id/schedule`
  - Messages: CRUD at `/:id/messages`
  - Variables: CRUD at `/:id/variables` + `GET /:id/variables/builtins`
  - Updates: `GET|PUT /:id/update-restart`, `POST /:id/check-updates`
  - Utilities: `POST /:id/open-folder`, `GET /:id/disk-usage`, `POST /:id/update`
  - Also mounted at legacy prefix `/api/servers/*`
- `steamcmd.ts` — `/api/v1/steamcmd/*` endpoints (status, install, login, guard, logout, install-app). Also at `/api/steamcmd/*`
- `system.ts` — `/api/v1/system/*` endpoints (metrics, settings CRUD). Also at `/api/system/*`
- `logs.ts` — `/api/v1/logs/*` endpoints for app-level logs (not game server logs): `GET|PUT /settings`, `GET /files`, `GET /files/:filename`, `DELETE /files/:filename`. List, read, delete log files, manage logger settings

### Express App (`server/src/app.ts`)

- Public endpoints (no auth): `GET /api/v1/health` (status, version, uptime), `GET /api/v1/info` (version, apiVersion, minCompatibleVersion, authEnabled, features[])
- Agent status page: `GET /` (localhost-only HTML page showing agent status, version, uptime, features)
- Features advertised: `steamcmd`, `mods`, `rcon`, `player-tracking`, `scheduler`

### WebSocket

- `broadcast(type, payload)` exported from `server/src/index.ts` — sends to all connected clients
- Message types follow `domain:action` pattern. Full list in `packages/shared/src/types/websocket.ts` under `WSMessageType` (26 types)
- Key event domains: `server:*`, `install:*`, `steamcmd:*`, `mod:*`, `player:*`, `schedule:*`, `message:*`, `update:*`
- Services import `broadcast` directly from `../index.js` to push real-time updates
- WebSocket auth: JWT token passed via `?token=` query param when `AUTH_ENABLED=true`

### Server Startup Sequence (`server/src/index.ts`)

1. Initialize database
2. `ensureInitialCredentials()` — auto-generates API key/password on first launch
3. `restoreServerStates()` — reattaches to still-running server PIDs, resets stale `starting`/`stopping` statuses
4. `initializeSchedules()` — restarts scheduled timers for running servers
5. `initializeMessageBroadcasters()` — restarts recurring RCON messages for running servers
6. `startAutoUpdateCheck(4)` — begins checking GitHub Releases for agent updates every 4 hours
7. HTTP + WebSocket listen
8. Graceful shutdown: `shutdownAllServers()`, close all WS clients, 15s force-exit timer

## Frontend Patterns

### Structure

- **Pages**: `Dashboard.tsx` (server list + onboarding wizard + system monitor), `ServerDetail.tsx` (6-tab server management), `Settings.tsx` (global app settings + auto-update controls), `Logs.tsx` (app-level logs viewer + settings)
- **Server detail tabs**: `components/server/` — `OverviewTab`, `ConfigTab`, `LogsTab`, `ModsTab`, `PlayersTab`, `SettingsTab`, `UpdateCheckDialog`
- **Game plugins**: `games/` — Per-game UI modules (`dayz/`, `ark/`, `7dtd/`) with config editors. Central `registry.ts` provides `getGamePlugin()`, `getGameName()`, `getGameLogo()`, `getConfigEditor()`
- **UI primitives**: `components/ui/` (shadcn/ui — don't modify directly)
- **Dialogs**: `AddServerDialog.tsx`, `DeleteServerDialog.tsx`, `UpdateNotification.tsx`
- **Onboarding/Wizard**: `components/onboarding/` — `OnboardingWizard.tsx` with step components (`WelcomeStep`, `ConnectAgentStep`, `SteamCmdInstallStep`, `SteamLoginStep`, `SteamGuardStep`, `CompleteStep`). Wizard is triggered by user ("Connect Agent" button), shown as overlay. Welcome step only on first launch; subsequent opens skip to Connect step. Closeable via X button on any step.
- **Multi-agent**: `AgentSelector.tsx` for switching between connected agents, `AppSettingsPanel.tsx` for global settings

### Multi-Agent Architecture (`client/src/contexts/BackendContext.tsx`)

- `BackendContext` manages multiple `BackendConnection` objects for connecting to remote agents
- Creates scoped API client + WebSocket manager per active connection
- Token lifecycle: auto-refresh at 80% of JWT lifetime, re-authenticate on `ApiAuthError`
- Auto-reconnect: polls health endpoint every 5s when WS disconnects

### API Client (`client/src/lib/api.ts`)

- `createApiClient(connection)` factory — creates typed fetch wrappers scoped to a `BackendConnection`
- Sub-clients accessed via `apiClient.steamcmd.*`, `apiClient.servers.*`, `apiClient.system.*`, `apiClient.health.*`, `apiClient.auth.*`
- All calls proxied to `:3001` in dev via Vite config (`/api` and `/ws` proxy rules)

### WebSocket Hook (`client/src/hooks/useWebSocket.ts`)

- `useWebSocket()` returns `{ subscribe, isConnected }` from the `BackendContext`
- `WebSocketManager` class handles the actual connection per agent
- Auto-reconnects on abnormal closure (3s delay). Use `subscribe(handler)` to register message handlers — returns an unsubscribe function for cleanup in `useEffect`

### Credential Store (`client/src/lib/credentialStore.ts`)

- Plaintext storage: localStorage for browser/Commander, JSON file for Electron (via IPC)
- Strips session tokens before persisting to reduce exposure
- ElectronCredentialStore: pre-loads connections synchronously before React renders

### Electron Settings (`client/src/lib/electronSettings.ts`)

- Persistent settings store that survives reinstalls — stores in `Documents/Game-Servum/app-settings.json` (not Electron userData)
- Falls back to localStorage in browser mode
- Used for: auto-update preferences, system monitoring toggle, UI preferences

### Routing (`client/src/App.tsx`)

- Uses `HashRouter` in Electron (`window.electronAPI` detected) for `file://` compat, otherwise `BrowserRouter`
- Routes: `/` → Dashboard (home page), `/server/:id` → ServerDetail, `/server/:id/:tab` → ServerDetail with tab, `/settings` → Settings, `/logs` → Logs

### Platform-Specific Features (`client/src/pages/Settings.tsx`)

- **Launch on Startup**: Only available on Windows (uses `app.setLoginItemSettings()`)
  - Linux AppImages are portable and lack fixed installation paths, making auto-start unreliable
  - UI conditionally shows this setting only when `isWindows === true` (detected via `window.electronAPI.app.getPlatform()`)
- **Minimize to Tray**: Works on all platforms (Windows, Linux, macOS)
- **Auto-Update**: Electron-only feature (works on all platforms)

## Shared Package (`packages/shared/`)

- **Constants**: `APP_VERSION`, `API_VERSION`, `MIN_COMPATIBLE_AGENT_VERSION`, `compareSemVer()`, `isAgentCompatible()`, `DEFAULT_AGENT_PORT`, `DEFAULT_COMMANDER_PORT`, `TOKEN_LIFETIME_SECONDS`
- **Types**: `ServerStatus` (7 states: `installing`, `stopped`, `starting`, `running`, `stopping`, `error`, `updating`), `GameServer`, `ServerMod`, `ModStatus`, `WSMessageType` (28 event types), API request/response types
- **Game types**: `GameMetadata` (id, name, logo, description), `StartupDetector` (type: stdout|logfile, pattern, logFile, timeoutMs)

## Agent Windows Service (`service/winsw/`)

The Agent runs as a native Windows Service via WinSW (v3.0.0-alpha.11):

- **Service name**: `GameServumAgent`, display name "Game-Servum Agent"
- **Recovery**: auto-restart on failure (10s, 10s, 30s delays), reset after 1 hour
- **Data directory**: Configurable during installation (default: `C:\ProgramData\Game-Servum\`), stored as system env var `GAME_SERVUM_ROOT`. NSIS installer patches WinSW XML at install time replacing `{{LOGPATH}}` and `{{DATA_DIR}}` placeholders with actual paths (WinSW cannot expand env vars reliably on first install)
- **Installer**: NSIS (`scripts/nsis/agent-installer.nsi`) — installs to `Program Files\Game-Servum Agent\`
- **Auto-start**: managed via `sc.exe` (AUTO_START/DEMAND_ONLY), exposed through REST API
- **Self-updater**: `agentUpdater.ts` checks GitHub Releases API, downloads update ZIP, runs PowerShell script to stop service → extract → restart
- **Graceful shutdown**: 30s stop timeout in WinSW config
- No Electron, no tray icon — fully managed via Commander over REST API

## Electron (`electron/main/main-unified.js`)

Commander-only Electron app (no agent code):

- Single-instance lock, BrowserWindow + system tray
- User data in `Documents/Game-Servum` (Windows) or `~/.config/game-servum-commander/` (Linux)
- IPC handlers: credential storage, app settings, logger, local logs, auto-updater
- Uses `electron-updater` for Commander self-updates (GitHub Releases)
- `app-settings.json` stores `auto_update_enabled`, `minimize_to_tray` preferences

## Build System

### Separate Builds (v1.1+)

**Agent-only (`scripts/build-agent-windows.mjs`):**

1. Build shared types (`tsc -p packages/shared`)
2. Bundle server via **esbuild** → `agent.mjs` (ESM, node platform)
3. Stage service files: `node.exe`, `agent.mjs`, `sql-wasm.wasm`, `GameServumAgent.exe` (WinSW), `.xml` config
4. Build NSIS installer (`makensis` required on PATH)
5. Create update ZIP (agent.mjs + sql-wasm.wasm only)
6. Output: `Game-Servum-Agent-Setup-v{version}.exe` (~50 MB) + `Game-Servum-Agent-Update-v{version}.zip` (~20 MB)

**Commander-only Windows (`scripts/build-commander-windows.mjs`):**

1. Build shared types
2. Build client via Vite (`--base=./`)
3. Stage Electron project — reads `electron/package.json`, merges Windows-specific build config (`build.win`, `build.nsis`)
4. Package with `electron-builder` (NSIS target)
5. Output: `Game-Servum-Commander-Setup-v{version}.exe` (~90 MB) + `commander.yml` for auto-update

**Commander-only Linux (`scripts/build-commander-linux.mjs`):**

1. Build shared types
2. Build client via Vite
3. Stage Electron project — reads `electron/package.json`, merges Linux-specific build config (`build.linux`, `build.appImage`)
4. Package with `electron-builder` (AppImage target)
5. Output: `Game-Servum-Commander_v{version}.AppImage` (~80 MB)

**Platform-specific paths:**

- Windows: `Documents/Game-Servum/`
- Linux: `~/.config/game-servum-commander/` ( Commander-only)
- macOS: `~/Library/Application Support/Game-Servum/`

**Agent NSIS installer features:**

- Installs to `C:\Program Files\Game-Servum Agent\`
- Data stored in configurable directory (default: `C:\ProgramData\Game-Servum\`, preserved on uninstall)
- Registers and starts `GameServumAgent` Windows Service
- Adds Windows Firewall rule for TCP port 3001
- Supports upgrade (stops service → updates files → restarts)
- Migrates data from legacy Electron install (`Documents\Game Servum\`)
- Uninstall removes service and install dir but preserves data

**Important:**

- Agent installer contains: Node.js runtime + agent.mjs + WinSW service wrapper (no Electron)
- Commander installer contains: Electron + React frontend only
- Linux builds contain ONLY the Commander. No Agent, no Node.js runtime, no game server management. Commander connects to remote Windows Agents over network.
- **Agent runtime is Windows-only** (game servers require Windows)

## Game Module System

Each game is a self-contained module in `server/src/games/{gameId}/`:

```
server/src/games/
├── base.ts              # Abstract BaseGameAdapter with sensible defaults
├── types.ts             # GameAdapter interface, GameDefinition type
├── index.ts             # Registry: getGameAdapter(), getAllGameDefinitions(), etc.
├── dayz/
│   ├── adapter.ts       # DayZAdapter extends BaseGameAdapter
│   └── index.ts         # Re-exports adapter
├── ark/
│   ├── adapter.ts       # ArkAdapter extends BaseGameAdapter
│   └── index.ts
└── 7dtd/
    ├── adapter.ts       # SevenDaysToDieAdapter extends BaseGameAdapter
    └── index.ts
```

Frontend game plugins in `client/src/games/{gameId}/`:

```
client/src/games/
├── types.ts             # ConfigEditorProps, GameUIPlugin interfaces
├── registry.ts          # getGamePlugin(), getGameName(), getConfigEditor(), etc.
├── dayz/
│   ├── ConfigEditor.tsx  # DayZ config editor component
│   └── index.ts          # GameUIPlugin export
├── ark/
│   ├── ConfigEditor.tsx
│   └── index.ts
└── 7dtd/
    ├── ConfigEditor.tsx
    └── index.ts
```

Core protocols in `server/src/core/`:

```
server/src/core/
├── rcon/                # RCON protocol implementations
│   ├── battleye.ts      # BattlEye RCON (UDP) — DayZ
│   ├── source.ts        # Source RCON (TCP) — ARK
│   ├── telnet.ts        # Telnet RCON — 7DTD
│   ├── types.ts         # Shared RCON types
│   └── index.ts
└── installers/
    ├── types.ts         # GameInstaller interface (future use)
    └── index.ts
```

### Adding a New Game

**1. Create backend adapter** in `server/src/games/mygame/adapter.ts`:

```typescript
import { BaseGameAdapter } from "../base.js";
import type { GameDefinition } from "../types.js";

const definition: GameDefinition = {
  id: "mygame",
  name: "My Game",
  logo: "mygame.png",
  appId: 123456,
  workshopAppId: 123456, // Only if workshop uses different App ID
  executable: "server.exe",
  defaultPort: 27015,
  portCount: 1,
  portStride: 1,
  queryPortOffset: 1,
  requiresLogin: false,
  defaultLaunchParams: "-port={PORT}",
  description: "Brief description",
  configFiles: ["config.cfg"],
};

export class MyGameAdapter extends BaseGameAdapter {
  constructor() {
    super(definition);
  }
  // Override methods as needed: readConfig(), writeConfig(), parsePlayerList(), etc.
}
```

**2. Create `server/src/games/mygame/index.ts`**:

```typescript
export { MyGameAdapter } from "./adapter.js";
```

**3. Register in `server/src/games/index.ts`**:

```typescript
import { MyGameAdapter } from "./mygame/index.js";
// Add to GAME_ADAPTERS map:
GAME_ADAPTERS.set("mygame", new MyGameAdapter());
```

**4. Create frontend plugin** in `client/src/games/mygame/index.ts`:

```typescript
import type { GameUIPlugin } from "../types";
export const plugin: GameUIPlugin = {
  gameId: "mygame",
  name: "My Game",
  logo: "mygame.png",
  // configEditor: MyGameConfigEditor,  // Optional
};
```

**5. Register in `client/src/games/registry.ts`**:

```typescript
import { plugin as mygamePlugin } from "./mygame";
GAME_PLUGINS.set("mygame", mygamePlugin);
```

**6. Add logo** to `client/public/game-logos/mygame.png`

## Data Flow: Server Installation

1. Client calls `apiClient.servers.create()` → `POST /api/servers`
2. Route creates DB entry via `createServer()`, starts `installServer()` in background (not awaited)
3. `serverInstall.ts` spawns SteamCMD process, polls `console_log.txt` for progress, broadcasts `install:progress` via WebSocket
4. Client receives `install:progress` and `install:output` messages in real-time
5. On completion, `install:complete` broadcast + `postInstall()` hook runs if defined

## Data Flow: Server Start

1. `checkServerRequirements()` validates executable, config, profiles, dependencies (DirectX, VC++ Runtime, BattlEye)
2. `variableResolver` resolves all `{VARIABLE}` placeholders in launch params
3. `modManager.generateModParams()` appends `-mod=` params
4. `logManager.archiveLogsBeforeStart()` archives previous session logs
5. Server process spawned, PID tracked
6. On spawn: updates DB status → broadcasts `server:status` → starts player tracking → starts scheduler → starts message broadcaster → starts update checker

## Version Management & Releases

**Single shared version** for Agent + Commander — both always release together.

**Version bump** (replaces manual `npm version` + constant editing):

```bash
# Bump to specific version:
npm run version:bump -- 0.10.0

# Bump by keyword:
npm run version:bump -- patch    # 0.10.0 → 0.10.1
npm run version:bump -- minor    # 0.10.1 → 0.11.0
npm run version:bump -- major    # 0.11.0 → 1.0.0

# Also update minimum compatible agent version (for breaking API changes):
npm run version:bump -- 1.0.0 --min-agent 1.0.0
```

The script (`scripts/bump-version.mjs`) updates **all locations automatically**:

- All 4 `package.json` files (root, client, server, shared) via `npm version`
- `APP_VERSION` constant in `packages/shared/src/constants/index.ts`
- Optionally `MIN_COMPATIBLE_AGENT_VERSION` via `--min-agent` flag

**Compatibility checking:**

- `MIN_COMPATIBLE_AGENT_VERSION` — the oldest agent version the Commander can work with. Only bump when making breaking API changes
- `isAgentCompatible(agentVersion)` — checks major match + `>= MIN_COMPATIBLE_AGENT_VERSION`
- Commander shows a warning banner (soft-block) when connecting to an outdated agent

**Release process**:

1. Run `npm run version:bump -- <version>` (e.g., `0.10.0`)
2. Review changes, commit, and push
3. Build Windows installers on Windows: `npm run build:agent && npm run build:commander`
4. Build Linux AppImage on Linux: `npm run build:linux`
5. Test all installation scenarios (Agent + Commander on same or different machines)
6. Create GitHub Release with tag `v{version}` (e.g., `v0.10.0`)
7. Upload all installers as release assets
8. Auto-updater polls GitHub Releases API every 4 hours (configurable)

**Platform-specific builds:**

- Agent Windows installer uses NSIS (requires `makensis` on PATH)
- Commander Windows installer uses Squirrel.Windows (no additional dependencies required)
- Linux Commander AppImage requires Linux build environment: `npm run build:linux`
- Agent runtime is Windows-only (game servers require Windows)
- Commander works on Windows, Linux, macOS (connects to remote Windows Agents)

## Code Style

- Prefer `function` declarations over arrow functions for top-level/exported functions
- Use explicit return types on exported functions
- Error handling: Catch, log with `[ServiceName]` prefix, broadcast error state — don't throw unhandled
- API mutation responses: `{ success: boolean, message: string }` pattern
- Console logging uses bracket prefixes: `[Install]`, `[ServerProcess]`, `[DayZ]`, `[PlayerTracker]`, `[Scheduler]`, `[MessageBroadcaster]`, `[UpdateChecker]`, `[RCON]`, `[LogManager]`, `[SystemMonitor]`, `[Logger]`, `[LogsAPI]`, `[AutoUpdater]`

## Common Pitfalls & Debugging

**Database mutations without save:**

```typescript
// ❌ WRONG - changes lost on restart
db.run("UPDATE game_servers SET status = ? WHERE id = ?", [
  "running",
  serverId,
]);

// ✅ CORRECT - persists to disk
db.run("UPDATE game_servers SET status = ? WHERE id = ?", [
  "running",
  serverId,
]);
saveDatabase();
```

**Import extensions in server code:**

```typescript
// ❌ WRONG - TypeScript won't resolve
import { foo } from "./bar";

// ✅ CORRECT - ES Modules require .js extension even for .ts files
import { foo } from "./bar.js";
```

**WebSocket broadcast in services:**

```typescript
// ✅ Import broadcast function from server index
import { broadcast } from "../index.js";

// Then use it to push real-time updates
broadcast("server:status", { serverId, status: "running" });
```

**Database migrations** (versioned system in `server/src/db/migrations.ts`):

```typescript
// Add a new migration to the MIGRATIONS array:
{
  version: 5,
  name: "add_my_new_column",
  up: (db: Database) => {
    db.run(`ALTER TABLE game_servers ADD COLUMN new_column TEXT DEFAULT ''`);
  },
}
// Migrations run automatically on startup in order. Each is wrapped in a transaction.
```

**Debugging server processes:**

- Check `data/gameservum.db` for server states (use SQLite browser)
- Monitor WebSocket messages in browser DevTools Network tab
- Check `data/logs/` for agent logs (daily rotation)
- Game server logs in `servers/{game}/{serverName}/profiles/`

**Port conflicts:**

- Each server needs `portCount` consecutive ports starting at `port`
- Port suggestions use `portStride` (default = `portCount`) between instances
- Always check for conflicts with `POST /api/v1/servers/games/check-port-conflict`
