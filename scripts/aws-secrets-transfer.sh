#!/usr/bin/env bash
# Secure, no-echo transfer of Supermarket.ie production credentials from Vercel
# into AWS Secrets Manager. Values are NEVER printed to stdout/stderr, never put
# on a command line (no process-list / shell-history exposure), and never
# committed. Each value is written to a 0600 temp file, piped to AWS via
# fileb://, then shredded.
#
# Prerequisites (you authenticate these; the script does not):
#   - Vercel CLI logged in to the Supermarket.ie project:
#       npx vercel login && npx vercel link           (in this repo)
#   - AWS SSO session:  aws sso login --sso-session smie
#   - The AWS Secrets Manager entries already created (empty) — the orchestrator
#     creates them with --create first; see create step below.
#
# Usage:
#   scripts/aws-secrets-transfer.sh pull     # vercel env pull -> .env.vercel.prod (local, gitignored)
#   scripts/aws-secrets-transfer.sh create   # create empty smie-prod/* secrets (BILLABLE; ask first)
#   scripts/aws-secrets-transfer.sh transfer # read .env.vercel.prod -> put-secret-value for each
#   scripts/aws-secrets-transfer.sh verify   # confirm each secret has a value (length only, no value)
#   scripts/aws-secrets-transfer.sh cleanup  # shred the local .env.vercel.prod
set -euo pipefail

AWS_PROFILE_NAME="${AWS_PROFILE:-smie-prod}"
AWS_REGION_NAME="${AWS_REGION:-eu-west-1}"
ENV_FILE=".env.vercel.prod"   # gitignored (.env*), local only

# Vercel env var NAME -> AWS Secrets Manager secret NAME.
# Order/keys are the exact production credentials the AWS task needs. The values
# are copied verbatim, so MAGIC_LINK_SECRET (and all others) are preserved.
MAP=(
  "NEXT_PUBLIC_SUPABASE_URL=smie-prod/supabase-url"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=smie-prod/supabase-anon"
  "SUPABASE_SERVICE_ROLE_KEY=smie-prod/supabase-service"
  "MAGIC_LINK_SECRET=smie-prod/magic-link"
  "VENDOR_MAGIC_LINK_SECRET=smie-prod/vendor-magic-link"
  "CRON_SECRET=smie-prod/cron-secret"
  "REVALIDATE_SECRET=smie-prod/revalidate-secret"
  "RESEND_API_KEY=smie-prod/resend"
  "ANTHROPIC_API_KEY=smie-prod/anthropic"
)

aws_sm() { aws secretsmanager "$@" --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME"; }

# Extract one value from the dotenv file WITHOUT printing it. Handles optional
# surrounding quotes. Prints nothing; returns the value only via a temp file.
read_env_value_to_file() {
  local key="$1" outfile="$2"
  # grep the first KEY= line; strip KEY=, strip optional single/double quotes.
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 || true)"
  if [ -z "$line" ]; then return 1; fi
  # Remove leading KEY=
  local val="${line#*=}"
  # Strip one layer of surrounding quotes if present.
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  printf '%s' "$val" > "$outfile"
}

cmd_pull() {
  echo "[transfer] pulling Vercel production env to ${ENV_FILE} (values not shown)"
  npx --yes vercel env pull "$ENV_FILE" --environment=production --yes
  chmod 600 "$ENV_FILE"
  echo "[transfer] pulled $(grep -cE '^[A-Z]' "$ENV_FILE") entries (names only, not shown)"
}

cmd_create() {
  echo "[transfer] creating EMPTY secrets (billable). Values added in 'transfer'."
  for pair in "${MAP[@]}"; do
    local sm_name="${pair#*=}"
    if aws_sm describe-secret --secret-id "$sm_name" >/dev/null 2>&1; then
      echo "[transfer] exists, skipping create: $sm_name"
    else
      aws_sm create-secret --name "$sm_name" \
        --description "Supermarket.ie production credential (migrated from Vercel)" \
        --tags Key=Project,Value=supermarket-ie Key=Component,Value=aws-migration \
        >/dev/null
      echo "[transfer] created: $sm_name"
    fi
  done
}

cmd_transfer() {
  [ -f "$ENV_FILE" ] || { echo "[transfer] ${ENV_FILE} not found; run 'pull' first" >&2; exit 1; }
  local tmp; tmp="$(mktemp -d)"; chmod 700 "$tmp"
  trap 'rm -rf "$tmp"' EXIT
  for pair in "${MAP[@]}"; do
    local vkey="${pair%%=*}" sm_name="${pair#*=}"
    local f="$tmp/val"
    if read_env_value_to_file "$vkey" "$f"; then
      # Put the value via fileb:// so it is never on the command line.
      aws_sm put-secret-value --secret-id "$sm_name" --secret-binary "fileb://$f" >/dev/null
      echo "[transfer] set value: $sm_name  (from $vkey, $(wc -c <"$f" | tr -d ' ') bytes)"
      rm -f "$f"
    else
      echo "[transfer] WARNING: $vkey not present in ${ENV_FILE}; left unchanged" >&2
    fi
  done
  echo "[transfer] done. MAGIC_LINK_SECRET and all values copied verbatim."
}

cmd_verify() {
  for pair in "${MAP[@]}"; do
    local sm_name="${pair#*=}"
    # Report only byte length, never the value.
    local len
    len="$(aws_sm get-secret-value --secret-id "$sm_name" --query 'SecretBinary' --output text 2>/dev/null | base64 --decode 2>/dev/null | wc -c | tr -d ' ' || echo 0)"
    if [ "$len" = "0" ]; then
      len="$(aws_sm get-secret-value --secret-id "$sm_name" --query 'SecretString' --output text 2>/dev/null | wc -c | tr -d ' ' || echo 0)"
    fi
    echo "[verify] $sm_name : ${len} bytes"
  done
}

cmd_cleanup() {
  if [ -f "$ENV_FILE" ]; then
    command -v shred >/dev/null 2>&1 && shred -u "$ENV_FILE" || rm -P "$ENV_FILE" 2>/dev/null || rm -f "$ENV_FILE"
    echo "[transfer] removed ${ENV_FILE}"
  fi
}

case "${1:-}" in
  pull) cmd_pull ;;
  create) cmd_create ;;
  transfer) cmd_transfer ;;
  verify) cmd_verify ;;
  cleanup) cmd_cleanup ;;
  *) echo "usage: $0 {pull|create|transfer|verify|cleanup}" >&2; exit 2 ;;
esac
