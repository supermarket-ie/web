# syntax=docker/dockerfile:1.7
#
# Supermarket.ie — container image for the AWS migration preview.
#
# Runtime model (important): this app is NOT a single process. `eve build`
# produces a standalone Eve agent server (a Nitro `node-server` under
# `.output/`). Off Vercel, `withEve` in next.config.ts rewrites `/eve/v1/*`
# to a separate Eve HTTP process (default 127.0.0.1:4274). So the container
# runs TWO processes: the Eve server and `next start`. See docker-entrypoint.sh.
#
# Debian "slim" (glibc) is used deliberately rather than Alpine/musl so that
# undici / sharp / native deps behave the same as the Node 24 target.

# ---------------------------------------------------------------------------
# Stage 1: dependencies (cached layer)
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
# Only copy manifests first so `npm ci` is cached unless they change.
COPY package.json package-lock.json ./
# Full install (incl. devDependencies) is required to run `eve build`/`next build`.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --include=dev

# ---------------------------------------------------------------------------
# Stage 2: builder — runs `eve build && next build`
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
# Carry installed modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
# Copy the rest of the source (respecting .dockerignore).
COPY . .

# Build-time environment.
# - CI=true + the placeholder Supabase URL activate the app's own empty-catalogue
#   escape hatch (src/lib/product-catalogue-data.ts), so prerendering does NOT
#   require — and never touches — a live database. These are NON-SECRET
#   placeholders used only to satisfy import-time guards; real values are
#   injected at runtime by ECS/App Runner.
# - NEXT_TELEMETRY_DISABLED keeps the build quiet and offline.
ENV CI=true \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder \
    SUPABASE_SERVICE_ROLE_KEY=build-placeholder \
    RESEND_API_KEY=re_build_placeholder \
    MAGIC_LINK_SECRET=build-placeholder-secret \
    VENDOR_MAGIC_LINK_SECRET=build-placeholder-secret \
    CRON_SECRET=build-placeholder-secret \
    REVALIDATE_SECRET=build-placeholder-secret \
    ANTHROPIC_API_KEY=sk-ant-build-placeholder \
    NEXT_PUBLIC_SITE_URL=https://preview.invalid \
    NEXT_PUBLIC_BASE_URL=https://preview.invalid

# eve build -> Nitro agent server at .output ; next build -> .next
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: runner — slim runtime image
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Eve companion server port. withEve rewrites /eve/v1/* to 127.0.0.1:$EVE_NEXT_PRODUCTION_PORT.
    EVE_NEXT_PRODUCTION_PORT=4274

# Run as the built-in non-root `node` user.
# Note: `output: standalone` is intentionally NOT used (would require app
# changes). We ship the built app plus production node_modules instead.
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/.output ./.output
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
# Source needed at runtime: withEve re-reads next.config/agent wiring, and the
# Eve runtime references the agent app root. Copy the app + agent sources.
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/agent ./agent
COPY --from=builder --chown=node:node /app/components.json ./components.json
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 3000

# Simple container healthcheck against the Next web port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/terms').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
