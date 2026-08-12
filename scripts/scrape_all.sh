#!/bin/bash
# =============================================================================
# scrape_all.sh — Runs all 4 store scrapers with parallelisation
# Designed to run via systemd timer (no LLM agent needed)
#
# Execution plan:
#   Phase 1 (parallel): Tesco + SuperValu (both slow, independent)
#   Phase 2 (parallel): Dunnes + Aldi (both fast, independent)
#
# Usage:
#   ./scripts/scrape_all.sh              # Run all stores
#   ./scripts/scrape_all.sh tesco        # Run single store
#   ./scripts/scrape_all.sh supervalu dunnes  # Run specific stores
#
# Requirements:
#   - Xvfb running on :99 (for Tesco headed Chromium)
#   - .env.local in the project root with SUPABASE_SERVICE_ROLE_KEY
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="/tmp/scrape_logs"
TIMESTAMP=$(date +%Y%m%d_%H%M)

# Shared run ID passed to all scrapers for observability (tesco_scraper.js reads SCRAPE_RUN_ID)
export SCRAPE_RUN_ID="$TIMESTAMP"

# Load env
cd "$PROJECT_DIR"
set -a
source .env.local
set +a

# Ensure log directory
mkdir -p "$LOG_DIR"

# Ensure Xvfb is running (needed for Tesco)
if ! pgrep -f "Xvfb :99" > /dev/null; then
  echo "[$(date -u)] Starting Xvfb..."
  nohup Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp > /dev/null 2>&1 &
  sleep 2
fi
export DISPLAY=:99

# --- Store runner functions (each writes to its own log) ---

run_tesco() {
  local log="$LOG_DIR/tesco_${TIMESTAMP}.log"
  # Limit to 500 products per run — keeps runtime to ~60-75min (2-4s/product via ScrapingBee).
  # Stalest-first ordering means the full catalogue rotates every ~2 scrape runs.
  # No limit was causing 2.5hr+ runs, leaving systemd stuck in 'activating'.
  # 5400s (90min) hard timeout as a safety net.
  echo "[$(date -u)] === TESCO REFRESH (ScrapingBee, 500 products stalest-first) ==="
  timeout 5400 node scripts/tesco_scraper.js --refresh --limit 500 > "$log" 2>&1 || true
  local result=$(grep -E '(Updated|=== )' "$log" | tail -1)
  echo "[$(date -u)] Tesco done: ${result:-unknown}"
}

run_supervalu() {
  local log="$LOG_DIR/supervalu_${TIMESTAMP}.log"
  echo "[$(date -u)] === SUPERVALU REFRESH ===" > "$log"
  node scripts/supervalu_scraper.js --refresh --limit 2000 >> "$log" 2>&1 || true
  local result=$(tail -1 "$log" | grep -oP 'Updated \K\d+/\d+' || echo "unknown")
  echo "supervalu:$result"
}

run_dunnes() {
  local log="$LOG_DIR/dunnes_${TIMESTAMP}.log"
  echo "[$(date -u)] === DUNNES REFRESH ===" > "$log"
  node scripts/dunnes_refresh.js >> "$log" 2>&1 || true
  local result=$(tail -1 "$log" | grep -oP 'Updated \K\d+/\d+' || echo "unknown")
  echo "dunnes:$result"
}

run_aldi() {
  local log="$LOG_DIR/aldi_${TIMESTAMP}.log"
  echo "[$(date -u)] === ALDI REFRESH ===" > "$log"
  node scripts/aldi_scraper.js --refresh >> "$log" 2>&1 || true
  local result=$(tail -1 "$log" | grep -oP 'Updated \K\d+/\d+' || echo "unknown")
  echo "aldi:$result"
}

# --- REVALIDATE ---
revalidate() {
  echo "[$(date -u)] Triggering site revalidation..."
  curl -s -L -X POST https://supermarket.ie/api/revalidate \
    -H 'Content-Type: application/json' \
    -d '{"secret":"E_1-BEtOVIKglZXz0OXU2n-lY51jkiG8YxwM9RjSK9g"}' > /dev/null 2>&1 || true
}

# --- MAIN ---
STORES_TO_RUN=("$@")
if [ ${#STORES_TO_RUN[@]} -eq 0 ]; then
  STORES_TO_RUN=(tesco supervalu dunnes aldi)
fi

echo "[$(date -u)] Starting scrape run: ${STORES_TO_RUN[*]}"
echo ""

# Execution strategy for 4GB RAM / 2 vCPU:
#   Tesco now uses ScrapingBee (HTTP only, no browser, low RAM)
#   So all stores can run in parallel.
#
# Phase 1: ALL stores in parallel (Tesco is just HTTP now)

# Separate into phases — all parallel now
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
  
  ALL_PIDS=()
  
  for store in "${ALL_STORES[@]}"; do
    TMPFILE=$(mktemp)
    case "$store" in
      tesco) run_tesco > "$TMPFILE" 2>&1 & ;;
      supervalu) run_supervalu > "$TMPFILE" 2>&1 & ;;
      dunnes) run_dunnes > "$TMPFILE" 2>&1 & ;;
      aldi) run_aldi > "$TMPFILE" 2>&1 & ;;
    esac
    ALL_PIDS+=("$!:$store:$TMPFILE")
  done
  
  # Wait for all jobs
  for entry in "${ALL_PIDS[@]}"; do
    IFS=':' read -r pid store tmpfile <<< "$entry"
    wait "$pid" 2>/dev/null || true
    result=$(cat "$tmpfile" 2>/dev/null || echo "$store:error")
    rm -f "$tmpfile"
    echo "[$(date -u)] $result"
  done
  echo ""
fi

# --- Summary ---
revalidate

SUMMARY="$LOG_DIR/summary_${TIMESTAMP}.txt"
{
  echo "=== Scrape Summary $(date -u) ==="
  echo "  Stores: ${STORES_TO_RUN[*]}"
  echo ""
  for store in "${STORES_TO_RUN[@]}"; do
    local_log="$LOG_DIR/${store}_${TIMESTAMP}.log"
    if [ -f "$local_log" ]; then
      last_line=$(grep -E '(Updated|=== )' "$local_log" | tail -1)
      echo "  $store: ${last_line:-no result line}"
    else
      echo "  $store: no log file"
    fi
  done
  echo ""
  echo "  Finished: $(date -u +%H:%M) UTC (${SECONDS}s elapsed)"
} | tee "$SUMMARY"

# --- Threshold breach alerts (query scrape_runs for this run_id) ---
# Check via Supabase REST API if available, otherwise parse logs
declare -A THRESHOLDS=( [tesco]=70 [supervalu]=85 [dunnes]=75 [aldi]=60 )
declare -A STORE_COVERAGE=()

# Parse coverage from logs as fallback (works without DB access)
for store in "${STORES_TO_RUN[@]}"; do
  local_log="$LOG_DIR/${store}_${TIMESTAMP}.log"
  if [ -f "$local_log" ]; then
    if [ "$store" = "tesco" ]; then
      # Parse tesco: "Updated 330/415" from new format
      nums=$(grep -oP 'Updated \K\d+/\d+' "$local_log" | tail -1)
    else
      nums=$(grep -oP 'Updated \K\d+/\d+' "$local_log" | tail -1)
    fi
    if [ -n "$nums" ]; then
      got=$(echo "$nums" | cut -d/ -f1)
      total=$(echo "$nums" | cut -d/ -f2)
      if [ "$total" -gt 0 ] 2>/dev/null; then
        pct=$(( got * 100 / total ))
        STORE_COVERAGE[$store]=$pct
        threshold=${THRESHOLDS[$store]:-70}
        if [ "$pct" -lt "$threshold" ] 2>/dev/null; then
          alert_msg="SCRAPE ALERT: $store coverage ${pct}% below threshold ${threshold}%"
          echo "  ⚠ $alert_msg"
          openclaw system event --text "$alert_msg" --mode now 2>/dev/null || true
        fi
      fi
    fi
  fi
done

# --- Log rotation: delete files older than 90 days ---
find "$LOG_DIR" -name "*.log" -mtime +90 -delete 2>/dev/null || true
find "$LOG_DIR" -name "*.txt" -mtime +90 -delete 2>/dev/null || true

echo ""
echo "[$(date -u)] All done."
