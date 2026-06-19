# syntax=docker/dockerfile:1

# ---- Build stage: install ALL deps and build client + server ----
FROM node:24-slim AS builder
RUN corepack enable
WORKDIR /app

# Install deps first (cached unless the lockfile/manifest changes).
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

# Source + the bits the build needs (migrations are committed under drizzle/).
COPY tsconfig.json vite.config.ts ./
COPY src/ src/
COPY drizzle/ drizzle/
RUN pnpm build

# ---- Deps stage: production-only node_modules (native @libsql built for this libc) ----
FROM node:24-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --prod --frozen-lockfile

# ---- Runtime stage ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps   /app/node_modules ./node_modules
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/drizzle     ./drizzle
COPY pnpm-lock.yaml package.json ./

# The libSQL file lives on a volume so it survives container recreation. Owned by
# the unprivileged `node` user (uid 1000); a fresh named volume inherits this owner.
RUN mkdir -p /data && chown -R node:node /data
USER node

ENV PORT=3000 \
    BIND_HOST=0.0.0.0 \
    DATABASE_PATH=/data/narratorr-request.db
EXPOSE 3000
VOLUME ["/data"]

# Liveness + readiness via the app's own DB-probing /api/health (no curl needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run on boot inside the server (idempotent); then it listens.
CMD ["node", "dist/server/index.js"]
