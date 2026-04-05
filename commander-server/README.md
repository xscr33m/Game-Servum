# Game-Servum — Commander Web Server

Lightweight Express server that serves the Commander SPA and provides admin authentication + agent connection persistence for Docker/web deployments.

## Quick Start

```bash
# From project root
npm run build:web     # Build shared → client (web mode) → commander-server → stage to dist/web/

# Docker (recommended)
docker compose up -d --build   # Build image & start on :8080

# Standalone
cd dist/web && npm install && npm start
```

## Project Structure

```
src/
├── index.ts          # Express entry point, auth routes, static SPA serving
├── auth.ts           # PBKDF2 password hashing, JWT session tokens, admin persistence
├── connections.ts    # Agent connection CRUD (GET/PUT/DELETE /commander/api/connections)
└── middleware.ts     # Session validation middleware (JWT from HTTP-only cookie)
```

## API Endpoints

**Public (no session required):**

- `GET /health` — Health check (`{ status, uptime }`)
- `GET /commander/api/auth/status` — Auth state (`{ configured, authenticated }`)
- `POST /commander/api/auth/setup` — Set initial admin password (first run only, rate limited)
- `POST /commander/api/auth/login` — Authenticate, receive session cookie (rate limited)
- `POST /commander/api/auth/logout` — Clear session cookie

**Authenticated (session required):**

- `PUT /commander/api/auth/password` — Change admin password
- `GET /commander/api/connections` — List stored agent connections
- `PUT /commander/api/connections` — Replace all agent connections (full sync)
- `DELETE /commander/api/connections` — Clear all agent connections

**SPA fallback:** All other `GET` requests serve `index.html`.

## Environment Variables

| Variable             | Default        | Description                                             |
| -------------------- | -------------- | ------------------------------------------------------- |
| `PORT`               | `8080`         | Server listen port                                      |
| `DATA_PATH`          | `./data`       | Directory for `admin.json` and `connections.json`       |
| `COMMANDER_PASSWORD` | —              | Pre-set admin password (skips UI setup on first launch) |
| `TRUST_PROXY`        | `false`        | Enable when behind a TLS reverse proxy (secure cookies) |
| `JWT_SECRET`         | auto-generated | Secret for signing session tokens                       |

## Key Patterns

- **Authentication**: PBKDF2 (100k iterations, SHA-512) — same algorithm as the Agent
- **Sessions**: JWT stored in HTTP-only `commander_session` cookie (SameSite, 24h expiry)
- **JWT secret persistence**: Auto-generated on first start, saved to `{DATA_PATH}/jwt-secret.key` so sessions survive container restarts. Env var `JWT_SECRET` overrides
- **Rate limiting**: Login and setup endpoints limited to 5 attempts per IP per 15 minutes (in-memory)
- **Data persistence**: JSON files in `DATA_PATH` (`admin.json`, `connections.json`, `jwt-secret.key`)
- **No proxying**: Browser connects to Agents directly — this server only handles auth + connection storage
- **Build-time mode**: Client is built with `VITE_WEB_MODE=true` to enable web-specific behavior
- **Graceful shutdown**: Handles SIGTERM/SIGINT for clean container stops

## Docker

```bash
# Build & run
docker compose up -d --build

# View logs
docker compose logs -f commander

# Stop & preserve data
docker compose down

# Stop & reset data (clean slate)
docker compose down -v
```

Data is persisted in the `commander-data` Docker volume at `/app/data`.

The container runs as non-root user `nodejs` (UID 1001) and includes a Docker HEALTHCHECK.
