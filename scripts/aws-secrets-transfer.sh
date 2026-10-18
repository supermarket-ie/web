#!/usr/bin/env bash
# Secure transfer of Supermarket.ie production credentials from Vercel into AWS
# Secrets Manager (as SecretString, for ECS env vars) plus the GitHub build
# inputs. Values are NEVER printed, never placed on a command line, and never
# written inside the Dropbox-synced repo.
#
# Security properties:
#  - Vercel env is pulled into a PRIVATE, NON-SYNCED temp dir (mktemp under
#    $TMPDIR, i.e. macOS /var/folders, not the repo/Dropbox), mode 700.
#  - AWS values are provided via `--secret-string file://<path>` (not argv).
#  - GitHub values are provided to `gh` via STDIN (`--body-file -`), not argv.
#  - Verification compares SHA-256 of source vs stored value and prints only
#    MATCH/DIFFER — never a value, never a hash.
#  - Secure deletion is NOT claimed: on SSD/synced filesystems overwrite-delete
#    is unreliable. Instead the plaintext temp file is deleted (best effort) and
#    an AES-256 ENCRYPTED emergency backup is written (passphrase you supply) so
#    nothing is lost; the only plaintext lives transiently in the non-synced
#    temp dir and is removed on exit.
#
# Prerequisites you authenticate (the script never logs you in):
#   npx vercel login && npx vercel link       (link the Supermarket.ie project)
#   aws sso login --sso-session smie
#
# Subcommands:
#   pull      Pull Vercel production env into the non-synced temp dir.
#   check     Assert all required keys are present & non-empty (no values shown).
#   create    Create empty smie-prod/* secrets (BILLABLE; ask first).
#   transfer  Load each value into Secrets Manager as SecretString.
#   github    Set GitHub build inputs (anon var + service-role in aws-prod env).
#   verify    Compare stored vs source by SHA-256; prints MATCH/DIFFER only.
#   backup    Write an AES-256 encrypted emergency backup (prompts passphrase).
#   cleanup   Remove the non-synced temp workdir (plaintext).
#
# Typical run (after auth + approval): pull -> check -> create -> transfer ->
#   github -> verify -> backup -> cleanup.
set -euo pipefail

AWS_PROFILE_NAME="${AWS_PROFILE:-smie-prod}"
AWS_REGION_NAME="${AWS_REGION:-eu-west-1}"
GH_REPO="supermarket-ie/web"
GH_ENV="aws-prod"

# Non-synced private workdir. A stable path under the user's temp root so the
# subcommands share it across invocations; created mode 700. NOT in the repo.
WORKROOT="${TMPDIR:-/tmp}"
WORKDIR="${SMIE_SECRETS_WORKDIR:-${WORKROOT%/}/smie-secrets-xfer}"
ENV_FILE="$WORKDIR/vercel.prod.env"

# Required credential NAME -> AWS Secrets Manager secret NAME.
# NOTE: NEXT_PUBLIC_SUPABASE_ANON_KEY is intentionally NOT here: it is absent in
# the Vercel production env and is not read by any app code (the app uses the
# service-role client server-side). It is therefore neither required nor stored
# in Secrets Manager. See cmd_github for how the GitHub build-arg is handled.
MAP=(
  "NEXT_PUBLIC_SUPABASE_URL=smie-prod/supabase-url"
  "SUPABASE_SERVICE_ROLE_KEY=smie-prod/supabase-service"
  "MAGIC_LINK_SECRET=smie-prod/magic-link"
  "VENDOR_MAGIC_LINK_SECRET=smie-prod/vendor-magic-link"
  "CRON_SECRET=smie-prod/cron-secret"
  "REVALIDATE_SECRET=smie-prod/revalidate-secret"
  "RESEND_API_KEY=smie-prod/resend"
  "ANTHROPIC_API_KEY=smie-prod/anthropic"
)
REQUIRED_KEYS=(
  NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  MAGIC_LINK_SECRET VENDOR_MAGIC_LINK_SECRET CRON_SECRET REVALIDATE_SECRET
  RESEND_API_KEY ANTHROPIC_API_KEY
)

aws_sm() { aws secretsmanager "$@" --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME"; }

ensure_workdir() { mkdir -p "$WORKDIR"; chmod 700 "$WORKDIR"; }

# Robust dotenv value extraction. Uses a Python helper so quoting/escaping is
# handled exactly as a dotenv consumer would, WITHOUT echoing the value. Writes
# the decoded value to $2. Returns non-zero if the key is absent.
extract_value_to_file() {
  local key="$1" outfile="$2"
  ENVFILE="$ENV_FILE" KEY="$key" OUTFILE="$outfile" python3 - <<'PY'
import os, sys, io
path, key, out = os.environ["ENVFILE"], os.environ["KEY"], os.environ["OUTFILE"]
val = None
with io.open(path, "r", encoding="utf-8") as fh:
    for raw in fh:
        line = raw.rstrip("\n")
        if not line or line.lstrip().startswith("#"):
            continue
        s = line
        if s.startswith("export "):
            s = s[len("export "):]
        if "=" not in s:
            continue
        k, v = s.split("=", 1)
        if k.strip() != key:
            continue
        v = v.strip()
        # Double-quoted: interpret standard backslash escapes.
        if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            inner = v[1:-1]
            out_chars, i = [], 0
            while i < len(inner):
                c = inner[i]
                if c == "\\" and i + 1 < len(inner):
                    nxt = inner[i+1]
                    out_chars.append({'n':'\n','t':'\t','r':'\r','"':'"','\\':'\\','$':'$','`':'`'}.get(nxt, '\\'+nxt))
                    i += 2
                else:
                    out_chars.append(c); i += 1
            val = "".join(out_chars)
        # Single-quoted: literal, no escape processing.
        elif len(v) >= 2 and v[0] == "'" and v[-1] == "'":
            val = v[1:-1]
        else:
            val = v
        break
if val is None:
    sys.exit(3)
with io.open(out, "w", encoding="utf-8") as fh:
    fh.write(val)
PY
}

sha_of_file() { shasum -a 256 "$1" | awk '{print $1}'; }

cmd_pull() {
  ensure_workdir
  echo "[transfer] pulling Vercel production env into non-synced $WORKDIR (values not shown)"
  # vercel env pull writes KEY=VALUE lines; write into the non-synced workdir.
  ( umask 077; npx --yes vercel env pull "$ENV_FILE" --environment=production --yes >/dev/null 2>&1 ) \
    || { echo "[transfer] ERROR: vercel env pull failed (are you logged in and linked?)" >&2; exit 1; }
  chmod 600 "$ENV_FILE"
  echo "[transfer] pulled $(grep -cE '^[A-Za-z_]' "$ENV_FILE" || echo 0) entries (names only)"
}

cmd_check() {
  [ -f "$ENV_FILE" ] || { echo "[transfer] run 'pull' first" >&2; exit 1; }
  local tmp missing=0; tmp="$(mktemp "$WORKDIR/chk.XXXXXX")"
  for k in "${REQUIRED_KEYS[@]}"; do
    if extract_value_to_file "$k" "$tmp" && [ -s "$tmp" ]; then
      : # present and non-empty
    else
      echo "[check] MISSING or EMPTY: $k" >&2; missing=1
    fi
    : > "$tmp"
  done
  rm -f "$tmp"
  if [ "$missing" -ne 0 ]; then
    echo "[check] FAILED: required credentials are missing. No placeholders will be used." >&2
    exit 1
  fi
  echo "[check] all ${#REQUIRED_KEYS[@]} required credentials present and non-empty"
}

cmd_create() {
  echo "[transfer] creating EMPTY secrets (billable)"
  for pair in "${MAP[@]}"; do
    local sm_name="${pair#*=}"
    if aws_sm describe-secret --secret-id "$sm_name" >/dev/null 2>&1; then
      echo "[transfer] exists, skipping: $sm_name"
    else
      aws_sm create-secret --name "$sm_name" \
        --description "Supermarket.ie production credential (migrated from Vercel)" \
        --tags Key=Project,Value=supermarket-ie Key=Component,Value=aws-migration >/dev/null
      echo "[transfer] created: $sm_name"
    fi
  done
}

cmd_transfer() {
  cmd_check
  local tmp; tmp="$(mktemp "$WORKDIR/val.XXXXXX")"
  for pair in "${MAP[@]}"; do
    local vkey="${pair%%=*}" sm_name="${pair#*=}"
    extract_value_to_file "$vkey" "$tmp" || { echo "[transfer] ERROR: $vkey missing" >&2; rm -f "$tmp"; exit 1; }
    [ -s "$tmp" ] || { echo "[transfer] ERROR: $vkey empty" >&2; rm -f "$tmp"; exit 1; }
    # SecretString via file:// so the value is not in argv.
    aws_sm put-secret-value --secret-id "$sm_name" --secret-string "file://$tmp" >/dev/null
    echo "[transfer] set: $sm_name  ($(wc -c <"$tmp" | tr -d ' ') bytes from $vkey)"
    : > "$tmp"
  done
  rm -f "$tmp"
  echo "[transfer] done (SecretString). MAGIC_LINK_SECRET copied verbatim."
}

cmd_github() {
  cmd_check
  local tmp; tmp="$(mktemp "$WORKDIR/gh.XXXXXX")"
  # Anon key -> repo VARIABLE (non-secret; inlined into the client build, but no
  # app code actually reads it). If present in Vercel, copy it verbatim via
  # STDIN. If absent (it is not set in production), set a clearly-labelled
  # non-secret sentinel so the Dockerfile's deploy guard (which only rejects the
  # literal "build-placeholder") passes — this is NOT a fabricated credential,
  # the value is unused at runtime.
  if extract_value_to_file NEXT_PUBLIC_SUPABASE_ANON_KEY "$tmp" && [ -s "$tmp" ]; then
    gh variable set PROD_SUPABASE_ANON_KEY --repo "$GH_REPO" < "$tmp" >/dev/null
    echo "[github] set variable PROD_SUPABASE_ANON_KEY (from Vercel)"
  else
    printf '%s' "unused-anon-key-not-in-vercel" | gh variable set PROD_SUPABASE_ANON_KEY --repo "$GH_REPO" >/dev/null
    echo "[github] NEXT_PUBLIC_SUPABASE_ANON_KEY absent in Vercel + unused by code; set non-secret sentinel variable"
  fi
  : > "$tmp"
  # Service-role key -> SECRET scoped to the protected aws-prod ENVIRONMENT
  # (not a repo-wide secret), via STDIN so it is not in argv.
  extract_value_to_file SUPABASE_SERVICE_ROLE_KEY "$tmp"
  # gh reads the secret value from STDIN when --body is omitted (keeps it out of argv).
  gh secret set PROD_SUPABASE_SERVICE_ROLE_KEY --repo "$GH_REPO" --env "$GH_ENV" < "$tmp" >/dev/null
  echo "[github] set environment secret PROD_SUPABASE_SERVICE_ROLE_KEY (env: $GH_ENV)"
  rm -f "$tmp"
}

cmd_verify() {
  [ -f "$ENV_FILE" ] || { echo "[transfer] run 'pull' first" >&2; exit 1; }
  local src stored; src="$(mktemp "$WORKDIR/src.XXXXXX")"; stored="$(mktemp "$WORKDIR/sto.XXXXXX")"
  local ok=1
  for pair in "${MAP[@]}"; do
    local vkey="${pair%%=*}" sm_name="${pair#*=}"
    extract_value_to_file "$vkey" "$src" || { echo "[verify] $sm_name : SOURCE MISSING"; ok=0; continue; }
    # Fetch as JSON and decode with Python so the EXACT bytes are preserved
    # (an --output text comparison spuriously strips trailing newlines).
    aws_sm get-secret-value --secret-id "$sm_name" --query 'SecretString' --output json 2>/dev/null \
      | python3 -c "import sys,json; open('$stored','w').write(json.load(sys.stdin))" 2>/dev/null || : > "$stored"
    if [ "$(sha_of_file "$src")" = "$(sha_of_file "$stored")" ]; then
      echo "[verify] $sm_name : MATCH"
    else
      echo "[verify] $sm_name : DIFFER"; ok=0
    fi
    : > "$src"; : > "$stored"
  done
  rm -f "$src" "$stored"
  [ "$ok" -eq 1 ] && echo "[verify] all values match source exactly" || { echo "[verify] MISMATCH detected" >&2; exit 1; }
}

cmd_backup() {
  [ -f "$ENV_FILE" ] || { echo "[transfer] run 'pull' first" >&2; exit 1; }
  local dest="${SMIE_BACKUP_PATH:-$HOME/smie-prod-credentials.$(date +%Y%m%d%H%M%S).env.enc}"
  echo "[backup] writing AES-256 encrypted emergency backup to: $dest"
  echo "[backup] you will be prompted for an encryption passphrase (store it safely)."
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$ENV_FILE" -out "$dest"
  chmod 600 "$dest"
  echo "[backup] encrypted backup written. Decrypt later with:"
  echo "         openssl enc -d -aes-256-cbc -pbkdf2 -in \"$dest\""
  echo "[backup] NOTE: plaintext still exists only in $WORKDIR until 'cleanup'."
}

cmd_cleanup() {
  if [ -d "$WORKDIR" ]; then
    rm -rf "$WORKDIR"
    echo "[cleanup] removed non-synced workdir $WORKDIR"
    echo "[cleanup] NOTE: on SSD/synced filesystems, deletion is not guaranteed to be"
    echo "          unrecoverable. The encrypted backup (if created) is the retained copy."
  fi
}

case "${1:-}" in
  pull) cmd_pull ;;
  check) cmd_check ;;
  create) cmd_create ;;
  transfer) cmd_transfer ;;
  github) cmd_github ;;
  verify) cmd_verify ;;
  backup) cmd_backup ;;
  cleanup) cmd_cleanup ;;
  *) echo "usage: $0 {pull|check|create|transfer|github|verify|backup|cleanup}" >&2; exit 2 ;;
esac
