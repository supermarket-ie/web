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
  echo "[$(date -u)] === TESCO REFRESH ===" > "$log"
  node scripts/tesco_scraper.js --refresh --limit 1000 >> "$log" 2>&1 || true
  local result=$(tail -1 "$log" | grep -oP 'Updated \K\d+/\d+' || echo "unknown")
  echo "tesco:$result"
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

# Separate stores into phases for parallel execution
PHASE1=()  # Slow stores (browser-based)
PHASE2=()  # Fast stores (API-based)

for store in "${STORES_TO_RUN[@]}"; do
  case "$store" in
    tesco|supervalu) PHASE1+=("$store") ;;
    dunnes|aldi) PHASE2+=("$store") ;;
    *) echo "Unknown store: $store" ;;
  esac
done

# --- Phase 1: Run slow stores in parallel ---
if [ ${#PHASE1[@]} -gt 0 ]; then
  echo "[$(date -u)] Phase 1 (parallel): ${PHASE1[*]}"
  
  PHASE1_PIDS=()
  PHASE1_RESULTS=()
  
  for store in "${PHASE1[@]}"; do
    # Run each store in background, capture output to temp file
    TMPFILE=$(mktemp)
    case "$store" in
      tesco) run_tesco > "$TMPFILE" 2>&1 & ;;
      supervalu) run_supervalu > "$TMPFILE" 2>&1 & ;;
    esac
    PHASE1_PIDS+=("$!:$store:$TMPFILE")
  done
  
  # Wait for all phase 1 jobs
  for entry in "${PHASE1_PIDS[@]}"; do
    IFS=':' read -r pid store tmpfile <<< "$entry"
    wait "$pid" 2>/dev/null || true
    result=$(cat "$tmpfile" 2>/dev/null || echo "$store:error")
    PHASE1_RESULTS+=("$result")
    rm -f "$tmpfile"
    echo "[$(date -u)] $result"
  done
  echo ""
fi

# --- Phase 2: Run fast stores in parallel ---
if [ ${#PHASE2[@]} -gt 0 ]; then
  echo "[$(date -u)] Phase 2 (parallel): ${PHASE2[*]}"
  
  PHASE2_PIDS=()
  PHASE2_RESULTS=()
  
  for store in "${PHASE2[@]}"; do
    TMPFILE=$(mktemp)
    case "$store" in
      dunnes) run_dunnes > "$TMPFILE" 2>&1 & ;;
      aldi) run_aldi > "$TMPFILE" 2>&1 & ;;
    esac
    PHASE2_PIDS+=("$!:$store:$TMPFILE")
  done
  
  # Wait for all phase 2 jobs
  for entry in "${PHASE2_PIDS[@]}"; do
    IFS=':' read -r pid store tmpfile <<< "$entry"
    wait "$pid" 2>/dev/null || true
    result=$(cat "$tmpfile" 2>/dev/null || echo "$store:error")
    PHASE2_RESULTS+=("$result")
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

echo ""
echo "[$(date -u)] All done."
