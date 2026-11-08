#!/bin/bash
# Verify the enforced Supermarket.ie isolation boundary using HARMLESS fixtures.
# It launches probes UNDER the sandbox profile and asserts:
#   DENIED  : host login keychain (the `security` tool / securityd)
#   DENIED  : ~/.aws, ~/.ssh, ~/.zsh_history, other home credential stores
#   DENIED  : unrelated project directories outside the workspace
#   ALLOWED : the Supermarket workspace itself
#   ALLOWED : an explicitly-supplied Supermarket env var (the ONLY cred path)
# It never reads any token value and never contacts the out-of-scope org.
set -u
WORKSPACE="${WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
PROFILE="$(dirname "$0")/supermarket-task.sb"
HOME_DIR="$HOME"
pass=0; fail=0
box() { sandbox-exec -D "WORKSPACE=$WORKSPACE" -f "$PROFILE" "$@"; }
want_deny() { # desc, cmd...
  local d="$1"; shift
  if box "$@" >/dev/null 2>&1; then echo "FAIL (should be DENIED): $d"; fail=$((fail+1)); else echo "ok  DENIED : $d"; pass=$((pass+1)); fi
}
want_allow() { # desc, cmd...
  local d="$1"; shift
  if box "$@" >/dev/null 2>&1; then echo "ok  ALLOWED: $d"; pass=$((pass+1)); else echo "FAIL (should be ALLOWED): $d"; fail=$((fail+1)); fi
}

echo "== Enforced isolation verification =="
echo "workspace: $WORKSPACE"
echo "profile  : $PROFILE"
echo

# DENIED: the exact surface that leaked the out-of-scope CLI token.
want_deny  "host login keychain via security tool" /usr/bin/security list-keychains
want_deny  "read ~/Library/Keychains"              /bin/ls "$HOME_DIR/Library/Keychains"
want_deny  "read ~/.aws"                            /bin/ls "$HOME_DIR/.aws"
want_deny  "read ~/.ssh"                            /bin/ls "$HOME_DIR/.ssh"
want_deny  "read ~/.zsh_history"                    /bin/cat "$HOME_DIR/.zsh_history"
want_deny  "read ~/.config (CLI tokens)"            /bin/ls "$HOME_DIR/.config"
want_deny  "read ~/Documents (unrelated projects)"  /bin/ls "$HOME_DIR/Documents"

# ALLOWED: only the Supermarket workspace + an explicitly supplied env var.
want_allow "read the Supermarket workspace"         /bin/ls "$WORKSPACE/package.json"
SMIE_TEST_CRED=supplied-explicitly \
  want_allow "use an explicitly-supplied env var"   /usr/bin/env

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ] && echo "ISOLATION VERIFIED" || echo "ISOLATION NOT VERIFIED"
exit "$fail"
