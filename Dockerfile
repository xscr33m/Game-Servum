# ── Build stage ──
FROM node:20-alpine AS build

WORKDIR /build

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY client/package.json client/
COPY server/package.json server/
COPY commander-server/package.json commander-server/

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY packages/shared/ packages/shared/
COPY client/ client/
COPY commander-server/ commander-server/
COPY scripts/build-commander-web.mjs scripts/

# Build
RUN node scripts/build-commander-web.mjs

# Install production dependencies in the output directory
RUN cd dist/web && npm install --omit=dev

# ── Runtime stage ──
FROM node:20-alpine

WORKDIR /app

# Copy built output
COPY --from=build /build/dist/web/ .

# Default environment
ENV PORT=8080
ENV DATA_PATH=/app/data
ENV NODE_ENV=production

EXPOSE 8080

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Create data volume mount point (owned by nodejs user)
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# Health check (using wget — much faster than spawning node)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null http://localhost:8080/health || exit 1

USER nodejs

CMD ["node", "server/index.js"]
