# syntax=docker/dockerfile:1

# =============================
# Bun Dockerfile for ReceiptHero (with pnpm for dependencies)
# Uses: Bun runtime + pnpm package manager
# Based on: https://pnpm.io/docker
# =============================

FROM node:22-slim AS node

FROM oven/bun:1 AS base
WORKDIR /app

# Pull Node.js 22 + npm straight from the official Node image and install
# pnpm through npm, so pnpm runs on Node (not Bun) everywhere. pnpm's store
# implementation requires node:sqlite, which is only stable on Node >=22.5;
# Bun's polyfill for it is incomplete and Debian's apt nodejs is too old (v20)
# - either gap crashes `pnpm install` with "No such built-in module: node:sqlite".
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm

# =============================
# Install dependencies
# =============================
FROM base AS deps
WORKDIR /app

# Copy root package files for monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy workspace package files
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/webapp/package.json ./apps/webapp/
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/

# Install all dependencies using pnpm with BuildKit cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --reporter ndjson

# =============================
# Runner stage
# =============================
FROM base AS runner
WORKDIR /app

# "production" (default) builds React's minified production bundle, where
# error messages are just numeric codes (see react.dev/errors/<code>).
# Passing --build-arg BUILD_MODE=development instead builds React's
# unminified dev bundle, with full in-browser error messages and warnings -
# used for the debug image variant published alongside the normal one (see
# .github/workflows/docker-publish.yml). Not meant for production traffic:
# it's slower and much larger.
ARG BUILD_MODE=production

# Set database path - critical for migrations and runtime
ENV DATABASE_PATH=/app/data/receipthero.db
ENV CONFIG_PATH=/app/data/config.json
ENV TURBO_TELEMETRY_DISABLED=1
ENV DO_NOT_TRACK=1

# Create data directory for SQLite
RUN mkdir -p /app/data

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/apps/webapp/node_modules ./apps/webapp/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules

# Copy source code
COPY . .

# Generate database migrations (doesn't need DB connection)
RUN cd packages/core && bun run db:generate

# Build webapp (required for vite preview) - see BUILD_MODE comment above.
# NODE_ENV must be set explicitly alongside --mode: `vite build` always
# forces NODE_ENV=production internally otherwise, regardless of --mode,
# which would silently keep bundling React's production (minified) build.
RUN cd apps/webapp && NODE_ENV="$BUILD_MODE" pnpm exec vite build --mode "$BUILD_MODE"

# Expose webapp port only - API (3001) and Worker are internal
EXPOSE 3000

# 1. Setup database (creates SQLite file and runs migrations)
# 2. Start worker, API, and webapp concurrently, once the database is ready
CMD ["bash","-lc","cd /app && pnpm --filter @sm-rn/core run db:setup && { (cd apps/worker && pnpm run start) & (cd apps/api && pnpm run start) & (cd apps/webapp && pnpm run start) & wait -n; }"]