#!/bin/bash
# =============================================================================
# scrape_all.sh — Runs all 4 store scrapers with parallelisation
# Designed to run via systemd timer (no LLM agent needed)
#
# Each scraper now writes a scrape_runs record to Supabase with full counters.
# Exit codes: 0 = all stores at or above threshold
#             1 = one or more stores degraded/failed (logged, alerted; service still exits 0
#                 to avoid systemd restart loops — see NOTE below)
#
# NOTE: The systemd unit uses `|| true` historically to prevent restart loops.
# This script now internally tracks per-store status and alerts, but the
# overall exit is 0 for systemd compatibility. Review before removing || true
# from the systemd ExecStart.
#
# Usage:
#   ./scripts/scrape_all.sh              # Run all stores
#   ./scripts/scrape_all.sh tesco        # Run single store
#   ./scripts/scrape_all.sh supervalu dunnes  # Run specific stores
#
# Requirements:
#   - Xvfb running on :99 (for Playwright scrapers)
#   - .env.local in the project root with SUPABASE_SERVICE_ROLE_KEY
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="/tmp/scrape_logs"
TIMESTAMP=$(date +%Y%m%d_%H%M)

# Shared run ID — passed to all scrapers via env. Format: YYYYMMDD_HHMM
export SCRAPE_RUN_ID="$TIMESTAMP"

# Load env
cd "$PROJECT_DIR"
set -a
source .env.local
set +a

# Ensure log directory
mkdir -p "$LOG_DIR"

# Ensure Xvfb is running (needed for Playwright scrapers: SuperValu, Aldi)
if ! pgrep -f "Xvfb :99" > /dev/null; then
  echo "[$(date -u)] Starting Xvfb..."
  nohup Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp > /dev/null 2>&1 &
  sleep 2
fi
export DISPLAY=:99

# Store-specific coverage thresholds (must match scrape-db.js THRESHOLDS)
declare -A THRESHOLDS=( [tesco]=70 [supervalu]=85 [dunnes]=75 [aldi]=60 )

# Per-store exit codes (populated after each store completes)
declare -A STORE_EXIT=()

# ============================================================
# Store runner functions
# Each captures exit code and writes structured output to tmpfile.
# Scrapers now handle their own scrape_runs DB writes (via scrape-db.js).
# || true is intentionally REMOVED here — we capture the real exit code.
# ============================================================

run_tesco() {
  local log="$LOG_DIR/tesco_${TIMESTAMP}.log"
  # Limit to 500 products/run (~90min at 2-4s/product via ScrapingBee)
  # Stalest-first: full catalogue rotates every ~2 runs
  echo "[$(date -u)] === TESCO REFRESH (ScrapingBee, 500 products stalest-first) ===" >> "$log"
  local exit_code=0
  timeout 5400 node scripts/tesco_scraper.js --refresh --limit 500 >> "$log" 2>&1 || exit_code=$?
  if [ "$exit_code" -eq 124 ]; then
    echo "[$(date -u)] TESCO TIMEOUT after 5400s" >> "$log"
  fi
  local result
  result=$(grep -E 'Updated [0-9]+/[0-9]+' "$log" | tail -1 || echo "=== TESCO REFRESH MODE (ScrapingBee) ===")
  echo "[$(date -u)] Tesco done (exit=$exit_code): ${result}"
  return "$exit_code"
}

run_supervalu() {
  local log="$LOG_DIR/supervalu_${TIMESTAMP}.log"
  echo "[$(date -u)] === SUPERVALU REFRESH ===" > "$log"
  local exit_code=0
  node scripts/supervalu_scraper.js --refresh --limit 2000 >> "$log" 2>&1 || exit_code=$?
  local result
  result=$(grep -oP 'Updated \K\d+/\d+' "$log" | tail -1 || echo "unknown")
  echo "supervalu:$result (exit=$exit_code)"
  return "$exit_code"
}

run_dunnes() {
  local log="$LOG_DIR/dunnes_${TIMESTAMP}.log"
  echo "[$(date -u)] === DUNNES REFRESH ===" > "$log"
  local exit_code=0
  node scripts/dunnes_refresh.js >> "$log" 2>&1 || exit_code=$?
  local result
  result=$(grep -oP 'Updated \K\d+/\d+' "$log" | tail -1 || echo "unknown")
  echo "dunnes:$result (exit=$exit_code)"
  return "$exit_code"
}

run_aldi() {
  local log="$LOG_DIR/aldi_${TIMESTAMP}.log"
  echo "[$(date -u)] === ALDI REFRESH ===" > "$log"
  local exit_code=0
  node scripts/aldi_scraper.js --refresh >> "$log" 2>&1 || exit_code=$?
  local result
  result=$(grep -oP 'Updated \K\d+/\d+' "$log" | tail -1 || echo "unknown")
  echo "aldi:$result (exit=$exit_code)"
  return "$exit_code"
}

# ============================================================
# Revalidate Vercel ISR cache after all stores complete
# ============================================================
revalidate() {
  echo "[$(date -u)] Triggering site revalidation..."
  # Secret value intentionally not logged
  curl -s -L -X POST https://supermarket.ie/api/revalidate \
    -H 'Content-Type: application/json' \
    -d "{\"secret\":\"${REVALIDATE_SECRET:-}\"}" > /dev/null 2>&1 || true
}

# ============================================================
# MAIN
# ============================================================
STORES_TO_RUN=("$@")
if [ ${#STORES_TO_RUN[@]} -eq 0 ]; then
  STORES_TO_RUN=(tesco supervalu dunnes aldi)
fi

echo "[$(date -u)] Starting scrape run: ${STORES_TO_RUN[*]} (run_id=$SCRAPE_RUN_ID)"
echo ""

ALL_STORES=()
for store in "${STORES_TO_RUN[@]}"; do
  case "$store" in
    tesco|supervalu|dunnes|aldi) ALL_STORES+=("$store") ;;
    *) echo "Unknown store: $store" ;;
  esac
done

# --- Run all stores in parallel ---
if [ ${#ALL_STORES[@]} -gt 0 ]; then
  echo "[$(date -u)] Running all stores in parallel: ${ALL_STORES[*]}"

  declare -A PID_TO_STORE=()
  declare -A PID_TO_TMPFILE=()

  for store in "${ALL_STORES[@]}"; do
    TMPFILE=$(mktemp)
    # Wrap runner in subshell that preserves exit code via tmpfile
    (
      case "$store" in
        tesco)     run_tesco     > "$TMPFILE" 2>&1; echo $? >> "${TMPFILE}.exit" ;;
        supervalu) run_supervalu > "$TMPFILE" 2>&1; echo $? >> "${TMPFILE}.exit" ;;
        dunnes)    run_dunnes    > "$TMPFILE" 2>&1; echo $? >> "${TMPFILE}.exit" ;;
        aldi)      run_aldi      > "$TMPFILE" 2>&1; echo $? >> "${TMPFILE}.exit" ;;
      esac
    ) &
    PID_TO_STORE[$!]="$store"
    PID_TO_TMPFILE[$!]="$TMPFILE"
  done

  # Collect results
  for pid in "${!PID_TO_STORE[@]}"; do
    store="${PID_TO_STORE[$pid]}"
    tmpfile="${PID_TO_TMPFILE[$pid]}"
    wait "$pid" 2>/dev/null || true
    exit_code=$(cat "${tmpfile}.exit" 2>/dev/null || echo "1")
    result=$(cat "$tmpfile" 2>/dev/null || echo "$store:error")
    STORE_EXIT[$store]="${exit_code}"
    rm -f "$tmpfile" "${tmpfile}.exit"
    echo "[$(date -u)] $result"
  done
  echo ""
fi

# --- Summary ---
revalidate

SUMMARY="$LOG_DIR/summary_${TIMESTAMP}.txt"
{
  echo "=== Scrape Summary $(date -u) ==="
  echo "  run_id: $SCRAPE_RUN_ID"
  echo "  Stores: ${STORES_TO_RUN[*]}"
  echo ""
  for store in "${STORES_TO_RUN[@]}"; do
    local_log="$LOG_DIR/${store}_${TIMESTAMP}.log"
    exit_c="${STORE_EXIT[$store]:-?}"
    if [ -f "$local_log" ]; then
      last_line=$(grep -E '(Updated|=== )' "$local_log" | tail -1)
      echo "  $store (exit=$exit_c): ${last_line:-no result line}"
    else
      echo "  $store (exit=$exit_c): no log file"
    fi
  done
  echo ""
  echo "  Finished: $(date -u +%H:%M) UTC (${SECONDS}s elapsed)"
} | tee "$SUMMARY"

# --- Threshold breach alerts (log-based; DB-based check handled by scrape-db.js per scraper) ---
for store in "${STORES_TO_RUN[@]}"; do
  local_log="$LOG_DIR/${store}_${TIMESTAMP}.log"
  if [ -f "$local_log" ]; then
    nums=$(grep -oP 'Updated \K\d+/\d+' "$local_log" | tail -1)
    if [ -n "$nums" ]; then
      got=$(echo "$nums" | cut -d/ -f1)
      total=$(echo "$nums" | cut -d/ -f2)
      if [ "${total:-0}" -gt 0 ] 2>/dev/null; then
        pct=$(( got * 100 / total ))
        threshold=${THRESHOLDS[$store]:-70}
        if [ "$pct" -lt "$threshold" ] 2>/dev/null; then
          alert_msg="SCRAPE ALERT: $store coverage ${pct}% below threshold ${threshold}%"
          echo "  ⚠ $alert_msg"
          openclaw system event --text "$alert_msg" --mode now 2>/dev/null || true
        fi
      fi
    fi

    # Alert on non-zero exit codes too
    exit_c="${STORE_EXIT[$store]:-0}"
    if [ "$exit_c" != "0" ] && [ "$exit_c" != "?" ]; then
      alert_msg="SCRAPE ALERT: $store scraper exited with code $exit_c"
      echo "  ⚠ $alert_msg"
      openclaw system event --text "$alert_msg" --mode now 2>/dev/null || true
    fi
  fi
done

# --- Log rotation: delete files older than 60 days (configurable) ---
LOG_RETENTION_DAYS=${LOG_RETENTION_DAYS:-60}
find "$LOG_DIR" -name "*.log" -mtime +"$LOG_RETENTION_DAYS" -delete 2>/dev/null || true
find "$LOG_DIR" -name "*.txt" -mtime +"$LOG_RETENTION_DAYS" -delete 2>/dev/null || true

echo ""
echo "[$(date -u)] All done."
# Exit 0 for systemd compatibility — individual store failures are surfaced
# via scrape_runs.status in Supabase and via Telegram alerts above.
exit 0
