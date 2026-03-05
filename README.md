# Game-Servum

Web-based game server management tool powered by SteamCMD.
Manage DayZ, 7 Days to Die, ARK, and other dedicated game servers from a modern dashboard — locally or across multiple machines.

---

## Features

- **SteamCMD Integration** — Automated download, login (with Steam Guard), and game server installation
- **Multi-Server Management** — Install, start, stop, and configure multiple game server instances
- **Workshop Mod Support** — Install, update, and manage Steam Workshop mods with automatic deployment
- **Real-Time Monitoring** — Live server output, installation progress, and system metrics via WebSocket
- **Player Tracking** — Monitor player connections with session history via BattlEye RCON + ADM log parsing
- **Scheduled Restarts** — Configure automatic server restarts with pre-restart RCON warnings
- **RCON Support** — Full BattlEye RCON protocol, send commands and scheduled broadcast messages
- **Auto-Update Detection** — Checks for game and mod updates, auto-restarts with configurable delays
- **Log Management** — Automatic log archiving with configurable retention policies
- **Template Variables** — Built-in and custom variables for launch params and broadcast messages
- **Multi-Agent Architecture** — One dashboard, multiple agents on different machines
- **Secure by Design** — API-Key + Password auth, JWT sessions, encrypted credential storage
- **App Auto-Update** — Automatic updates via GitHub Releases with seamless upgrade (preserves all data)

## Architecture

```
┌──────────────────────────────────────────────────┐
│              Dashboard (React SPA)               │
│           Electron App / Browser                 │
└─────────┬──────────────┬──────────────┬──────────┘
          │ REST + WS    │ REST + WS    │ REST + WS
          ▼              ▼              ▼
     ┌──────────┐   ┌──────────┐   ┌──────────┐
     │ Agent A  │   │ Agent B  │   │ Agent C  │
     │ Win 11   │   │ Win Srv  │   │ Win 11   │
     │ SteamCMD │   │ SteamCMD │   │ SteamCMD │
     └──────────┘   └──────────┘   └──────────┘
```

## Quick Start (Development)

```bash
# Clone
git clone https://github.com/xscr33m/Game-Servum.git
cd Game-Servum

# Install dependencies
npm install

# Start dev servers (shared watch + client :5173 + agent :3001)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Distribution

### Windows Installers

**Build on Windows:**

```bash
npm run build:agent        # Agent-only installer (~100 MB)
npm run build:dashboard    # Dashboard-only installer (~90 MB)
```

**Outputs:**

- `dist/v{version}/agent/Game-Servum-Agent-Setup-v{version}.exe` — Agent installer + update ZIP
- `dist/v{version}/dashboard/Game-Servum-Dashboard-Setup-{version}.exe` — Dashboard installer

| Installer     | Contents                          | Use Case                                    |
| ------------- | --------------------------------- | ------------------------------------------- |
| **Agent**     | Windows Service (Node.js + WinSW) | Headless game server host, managed remotely |
| **Dashboard** | Electron app (Dashboard UI only)  | Remote management (connects to Agents)      |

### Linux Dashboard

**Build on Linux:** AppImages must be built on a Linux system (CachyOS, Ubuntu, etc.)

```bash
npm run build:linux
# → dist/v{version}/dashboard/Game-Servum-Dashboard-{version}.AppImage
```

The Linux build contains **only the Dashboard** for remote management of Windows Agents. No Agent included.

**Requirements:**

- Linux OS for building (uses mksquashfs)
- FUSE/libfuse2 for AppImage execution
- Network access to Windows Agents

## Auto-Update System

Both Agent and Dashboard include automatic updates via GitHub Releases:

- **Agent**: Self-updater checks GitHub Releases API, downloads update ZIP, installs via PowerShell (stop service → extract → restart)
- **Dashboard**: Electron auto-updater with in-app notifications and one-click install
- **Automatic checks** every 4 hours (configurable)
- **Preserves all data** during upgrades (servers, mods, connections, settings)

## Build Commands

```bash
npm run dev                # Dev servers (shared watch + client + agent)
npm run build              # Build all packages (shared → server → client)

# Windows builds
npm run build:agent        # Build Agent installer (NSIS)
npm run build:dashboard    # Build Dashboard installer (Squirrel.Windows)

# Linux build (requires Linux)
npm run build:linux        # Build Dashboard AppImage
```

## Tech Stack

| Layer    | Technology                                                  |
| -------- | ----------------------------------------------------------- |
| Frontend | React 19 · Vite 7 · TypeScript · Tailwind CSS 4 · shadcn/ui |
| Backend  | Node.js · Express · TypeScript · sql.js (SQLite)            |
| Desktop  | Electron 40 · electron-builder · Squirrel.Windows           |
| Shared   | `@game-servum/shared` TypeScript types package              |
| Auth     | API-Key (SHA-256) + Password (PBKDF2) → JWT                 |

## Project Structure

```
Game-Servum/
├── packages/shared/     # @game-servum/shared — types & constants
├── client/              # React dashboard (Vite)
├── server/              # Agent backend (Express)
├── electron/            # Electron shell (main + preload)
├── scripts/             # Build & NSIS installer scripts
├── docs/                # Documentation about the project
├── data/                # SQLite DB (auto-created at runtime)
├── servers/             # Game server installations (runtime)
└── steamcmd/            # SteamCMD (auto-downloaded at runtime)
```

## Adding Game Server Support

Add a new entry to `server/src/services/gameDefinitions.ts`:

```typescript
mygame: {
  id: "mygame",
  name: "My Game Server",
  appId: 123456,
  workshopAppId: 123456,       // Only if workshop uses different App ID
  executable: "server.exe",
  defaultPort: 27015,
  portCount: 1,                // Number of consecutive ports used
  portStride: 1,               // Increment between server instances (defaults to portCount)
  queryPortOffset: 1,          // Query port = defaultPort + offset
  requiresLogin: false,
  defaultLaunchParams: "-port={PORT}",
  description: "My game server description",
  configFiles: ["config.cfg"], // Optional: important config files
  postInstall: async (installPath, serverName) => { /* optional setup */ },
}
```

## License

MIT

---

Made by [@xscr33m](https://github.com/xscr33m)
