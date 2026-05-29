#!/bin/bash
# =============================================================================
# scrape_all.sh — Runs all 4 store scrapers sequentially
# Designed to run via systemd timer or cron (no LLM agent needed)
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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="/tmp/scrape_logs"
TIMESTAMP=$(date +%Y%m%d_%H%M)

# Load env
cd "$PROJECT_DIR"
export $(grep -v '^#' .env.local | grep -v '^$' | xargs)

# Ensure log directory
mkdir -p "$LOG_DIR"

# Ensure Xvfb is running (needed for Tesco)
if ! pgrep -f "Xvfb :99" > /dev/null; then
  echo "[$(date -u)] Starting Xvfb..."
  nohup Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp > /dev/null 2>&1 &
  sleep 2
fi
export DISPLAY=:99

# Results tracking
declare -A RESULTS

# --- TESCO ---
run_tesco() {
  echo "[$(date -u)] === TESCO REFRESH ==="
  local log="$LOG_DIR/tesco_${TIMESTAMP}.log"
  
  # Tesco needs tmux for DISPLAY to persist through browser restarts
  # But since we're running directly with DISPLAY set, it should work
  node scripts/tesco_scraper.js --refresh > "$log" 2>&1 || true
  
  local updated=$(grep -oP 'Updated \K\d+' "$log" | tail -1 || echo "0")
  local total=$(grep -oP '/\K\d+(?= prices)' "$log" | tail -1 || echo "?")
  RESULTS[tesco]="$updated/$total"
  echo "[$(date -u)] Tesco done: ${RESULTS[tesco]}"
}

# --- SUPERVALU ---
run_supervalu() {
  echo "[$(date -u)] === SUPERVALU REFRESH ==="
  local log="$LOG_DIR/supervalu_${TIMESTAMP}.log"
  
  node scripts/supervalu_scraper.js --refresh --limit 2000 > "$log" 2>&1 || true
  
  local updated=$(grep -oP 'Updated \K\d+' "$log" | tail -1 || echo "0")
  local total=$(grep -oP '/\K\d+(?= prices)' "$log" | tail -1 || echo "?")
  RESULTS[supervalu]="$updated/$total"
  echo "[$(date -u)] SuperValu done: ${RESULTS[supervalu]}"
}

# --- DUNNES ---
run_dunnes() {
  echo "[$(date -u)] === DUNNES REFRESH ==="
  local log="$LOG_DIR/dunnes_${TIMESTAMP}.log"
  
  python3 -u scripts/scrape_pipeline.py --refresh --store dunnes > "$log" 2>&1 || true
  
  local updated=$(grep -c "✓" "$log" || echo "0")
  RESULTS[dunnes]="$updated"
  echo "[$(date -u)] Dunnes done: ${RESULTS[dunnes]} updated"
}

# --- ALDI ---
run_aldi() {
  echo "[$(date -u)] === ALDI REFRESH ==="
  local log="$LOG_DIR/aldi_${TIMESTAMP}.log"
  
  node scripts/aldi_scraper.js --refresh > "$log" 2>&1 || true
  
  local updated=$(grep -oP 'Updated \K\d+' "$log" | tail -1 || echo "0")
  local total=$(grep -oP '/\K\d+' "$log" | tail -1 || echo "?")
  RESULTS[aldi]="$updated/$total"
  echo "[$(date -u)] Aldi done: ${RESULTS[aldi]}"
}

# --- REVALIDATE ---
revalidate() {
  echo "[$(date -u)] Triggering site revalidation..."
  curl -s -L -X POST https://supermarket.ie/api/revalidate \
    -H 'Content-Type: application/json' \
    -d '{"secret":"E_1-BEtOVIKglZXz0OXU2n-lY51jkiG8YxwM9RjSK9g"}' > /dev/null 2>&1 || true
}

# --- WRITE SUMMARY ---
write_summary() {
  local summary="$LOG_DIR/summary_${TIMESTAMP}.txt"
  echo "=== Scrape Summary $(date -u) ===" > "$summary"
  for store in tesco supervalu dunnes aldi; do
    echo "  $store: ${RESULTS[$store]:-skipped}" >> "$summary"
  done
  echo "" >> "$summary"
  cat "$summary"
}

# --- MAIN ---
STORES_TO_RUN=("$@")
if [ ${#STORES_TO_RUN[@]} -eq 0 ]; then
  STORES_TO_RUN=(tesco supervalu dunnes aldi)
fi

echo "[$(date -u)] Starting scrape run: ${STORES_TO_RUN[*]}"
echo ""

for store in "${STORES_TO_RUN[@]}"; do
  case "$store" in
    tesco) run_tesco ;;
    supervalu) run_supervalu ;;
    dunnes) run_dunnes ;;
    aldi) run_aldi ;;
    *) echo "Unknown store: $store" ;;
  esac
  echo ""
done

revalidate
write_summary

echo "[$(date -u)] All done."
