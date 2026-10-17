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

# -- NEXT_PUBLIC_* are INLINED INTO THE BUILD by Next.js --
# Next replaces `process.env.NEXT_PUBLIC_*` with literals at build time, so these
# CANNOT be overridden at runtime for client/inlined usage. The deploy image MUST
# therefore be built with the ACTUAL preview values, passed as build args:
#
#   docker build \
#     --build-arg BUILD_MODE=deploy \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://<preview-host> \
#     --build-arg NEXT_PUBLIC_BASE_URL=https://<preview-host> \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<preview-ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<preview-anon-key> \
#     -t <ecr>:<sha> .
#
# BUILD_MODE=ci (the default) uses the harmless example.supabase.co placeholder
# and CI=true to activate the app's empty-catalogue escape hatch
# (src/lib/{product-catalogue-data,price-data}.ts) so a VALIDATION build needs no
# database. A BUILD_MODE=ci image must NEVER be deployed — the builder below fails
# the build if deploy mode is requested without real NEXT_PUBLIC_* values.
ARG BUILD_MODE=ci
ARG NEXT_PUBLIC_SITE_URL=https://preview.invalid
ARG NEXT_PUBLIC_BASE_URL=https://preview.invalid
ARG NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder

# Fail fast if someone asks for a deploy image but leaves placeholder public vars.
RUN if [ "$BUILD_MODE" = "deploy" ]; then \
      if echo "$NEXT_PUBLIC_SITE_URL$NEXT_PUBLIC_BASE_URL" | grep -q "preview.invalid" \
         || [ "$NEXT_PUBLIC_SUPABASE_URL" = "https://example.supabase.co" ] \
         || [ "$NEXT_PUBLIC_SUPABASE_ANON_KEY" = "build-placeholder" ]; then \
        echo "ERROR: BUILD_MODE=deploy requires real NEXT_PUBLIC_* build args (no placeholders)." >&2; \
        exit 1; \
      fi; \
    fi

# Non-secret build environment.
# - APP_ENV=preview is used ONLY for the BUILD so any prerender DB access is
#   SELECT-only (read-only guard) regardless of which key is mounted. This does
#   NOT affect runtime: the runner/ECS set APP_ENV for the live environment. The
#   same image serves both test (APP_ENV=preview) and production (APP_ENV=
#   production) — behaviour is chosen at runtime, not baked in.
# - NEXT_PUBLIC_* are inlined (see above).
# - The server-only secrets below are DUMMY non-secrets that only satisfy
#   import-time guards for values the build never actually uses (Resend,
#   Anthropic, JWT secrets). They are NOT real and NOT the service-role key.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_ENV=preview \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    RESEND_API_KEY=re_build_placeholder \
    MAGIC_LINK_SECRET=build-placeholder-secret \
    VENDOR_MAGIC_LINK_SECRET=build-placeholder-secret \
    CRON_SECRET=build-placeholder-secret \
    REVALIDATE_SECRET=build-placeholder-secret \
    ANTHROPIC_API_KEY=sk-ant-build-placeholder

# The Supabase key used during prerender is provided via a BuildKit SECRET MOUNT
# (id=supabase_service_role_key), never an ARG/ENV — so it is NOT written to any
# image layer or to image metadata/history. Pass it at build time with:
#
#   DOCKER_BUILDKIT=1 docker build \
#     --secret id=supabase_service_role_key,env=SUPABASE_SERVICE_ROLE_KEY ...
#
# For the isolated preview this MUST be the restricted READ-ONLY key. The build
# only runs SELECTs (catalogue/prices) because APP_ENV=preview forces the
# read-only guard, so a read-only key is sufficient.
#
# BUILD_MODE=ci: CI=true activates the empty-catalogue escape hatch, so no DB and
# no secret are needed (the secret mount is optional and falls back to a dummy).
# BUILD_MODE=deploy: the real read-only key is read from the secret file for the
# duration of this RUN only.
RUN --mount=type=secret,id=supabase_service_role_key,required=false \
    CI=$([ "$BUILD_MODE" = "ci" ] && echo true || echo "") \
    SUPABASE_SERVICE_ROLE_KEY="$(cat /run/secrets/supabase_service_role_key 2>/dev/null || echo build-placeholder)" \
    npm run build

# ---------------------------------------------------------------------------
# Stage 3: runner — slim runtime image
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # FAIL-SAFE DEFAULTS. The single image serves both the pre-cutover TEST
    # (APP_ENV=preview, read-only) and PRODUCTION (APP_ENV=production, read+write).
    # The behaviour is chosen by the ECS task definition, which ALWAYS sets
    # APP_ENV and SUPABASE_READ_ONLY explicitly. These baked defaults are
    # deliberately the SAFE ones: if the task env were ever omitted, the app
    # fails safe to read-only rather than silently writing to production.
    APP_ENV=preview \
    SUPABASE_READ_ONLY=true \
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
