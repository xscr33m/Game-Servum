# Game-Servum — Dashboard (Frontend)

React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + shadcn/ui dashboard for game server management.

## Quick Start

```bash
# From project root
npm run dev:client    # Vite dev server on :5173 with HMR + proxy to :3001

# From this directory
npm run dev           # Vite dev server
npm run build         # Production build → dist/
```

## Project Structure

```
src/
├── pages/              # Dashboard, ServerDetail, Settings, Logs
├── components/         # UI components (server/, onboarding/, ui/, dialogs)
├── contexts/           # BackendContext for multi-agent management
├── hooks/              # useBackend, useWebSocket
├── lib/                # api.ts, credentialStore.ts, config.ts, utils.ts
└── types/              # TypeScript type definitions
```

## Key Patterns

**Path alias**: `@/` → `src/`  
**Multi-agent**: `BackendContext` manages scoped API + WebSocket per agent  
**API client**: `apiClient.servers.*`, `apiClient.steamcmd.*`, `apiClient.system.*`  
**WebSocket**: `useWebSocket()` → `subscribe(handler)` returns unsubscribe function  
**Routing**: `/` (Dashboard) · `/server/:id/:tab` (ServerDetail) · `/settings` · `/logs`
