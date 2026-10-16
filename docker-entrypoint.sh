#!/usr/bin/env sh
# Supermarket.ie container entrypoint.
#
# Starts BOTH processes the app needs when running off Vercel:
#   1. The Eve agent server (Nitro) on $EVE_NEXT_PRODUCTION_PORT (default 4274),
#      which `withEve` proxies /eve/v1/* to.
#   2. The Next.js server (`next start`) on $PORT (default 3000), the public port.
#
# POSIX sh only (no `wait -n`), so it behaves identically under dash/ash/bash.
# If either child exits, the container stops so the orchestrator (ECS/App
# Runner) replaces the task instead of serving a half-up app.
set -eu

EVE_PORT="${EVE_NEXT_PRODUCTION_PORT:-4274}"
WEB_PORT="${PORT:-3000}"

EVE_PID=""
NEXT_PID=""

shutdown() {
  echo "[entrypoint] shutting down"
  [ -n "${EVE_PID}" ] && kill "${EVE_PID}" 2>/dev/null || true
  [ -n "${NEXT_PID}" ] && kill "${NEXT_PID}" 2>/dev/null || true
}
trap 'shutdown' INT TERM

echo "[entrypoint] starting Eve agent server on 127.0.0.1:${EVE_PORT}"
node node_modules/eve/bin/eve.js start --host 127.0.0.1 --port "${EVE_PORT}" &
EVE_PID=$!

# Give Eve a moment to bind before Next starts proxying to it.
sleep 2

echo "[entrypoint] starting Next.js on 0.0.0.0:${WEB_PORT}"
node node_modules/.bin/next start --hostname 0.0.0.0 --port "${WEB_PORT}" &
NEXT_PID=$!

# Portable supervisor: poll both children; if either dies, stop the container.
while true; do
  if ! kill -0 "${EVE_PID}" 2>/dev/null; then
    echo "[entrypoint] Eve agent server (pid ${EVE_PID}) exited; stopping container"
    shutdown
    exit 1
  fi
  if ! kill -0 "${NEXT_PID}" 2>/dev/null; then
    echo "[entrypoint] Next.js (pid ${NEXT_PID}) exited; stopping container"
    shutdown
    exit 1
  fi
  sleep 5
done
