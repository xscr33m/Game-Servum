# Game-Servum — Commander (Frontend)

React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + shadcn/ui Commander for game server management.

## Quick Start

```bash
# From project root
npm run dev:client    # Vite dev server on :5173 with HMR + proxy to :3001

# From this directory
npm run dev           # Vite dev server
npm run build         # Production build → dist/
npm run lint          # ESLint
```

## Project Structure

```
src/
├── pages/                  # Dashboard, ServerDetail, Settings, Logs
├── components/
│   ├── agent/              # Agent management (add/edit/remove, system monitor, updates)
│   ├── file-explorer/      # File browser, editor, upload toolbar
│   ├── onboarding/         # First-run setup wizard (steps/)
│   ├── server-details/     # Server tabs (Overview, Config, Logs, Mods, Players, Settings)
│   │   ├── dialogs/        # Add/Delete/CancelInstall server dialogs
│   │   └── games/          # Per-game config editors (dayz/, ark/, 7dtd/)
│   └── ui/                 # shadcn/ui primitives (don't modify directly)
├── contexts/               # BackendContext for multi-agent connection management
├── hooks                   # useBackend, useWebSocket, useGameCapabilities, useUptime
├── lib/                    # api.ts, credentialStore.ts, electronSettings.ts, utils.ts
└── types/                  # TypeScript type definitions (re-exports @game-servum/shared)
```

## Key Patterns

- **Path alias**: `@/` → `src/` (configured in `vite.config.ts`)
- **Multi-agent**: `BackendContext` manages scoped API client + WebSocket per agent connection
- **API client**: `apiClient.servers.*`, `apiClient.steamcmd.*`, `apiClient.system.*`, `apiClient.auth.*`, `apiClient.health.*`, `apiClient.logs.*`
- **WebSocket**: `useWebSocket()` → `subscribe(handler)` returns unsubscribe function
- **Routing**: HashRouter in Electron, BrowserRouter otherwise → `/` · `/server/:id/:tab` · `/settings` · `/logs`
- **Game plugins**: `components/server-details/games/registry.ts` maps game IDs to config editors
