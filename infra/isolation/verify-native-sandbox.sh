#!/bin/bash
# Verify the LIVE Kiro native command sandbox actually covers the agent's own
# shell tool — run this THROUGH the agent's shell tool AFTER enabling the
# sandbox in the Kiro UI. It uses only harmless fixtures and never reads a real
# credential value. It distinguishes three outcomes precisely:
#   DENIED  : the operation was blocked by policy (sandbox/permission) -> isolated
#   ABSENT  : the target does not exist (not a permission signal) -> inconclusive
#   ALLOWED : the operation succeeded -> NOT isolated for that surface
#
# Method: for a keychain/credential-dir probe we FIRST confirm the target exists
# unsandboxed-style (the item/dir is known to exist from the audit), so a failure
# under the live tool must be a DENIAL, not an ABSENT file.
set -u
HOME_DIR="$HOME"
pass=0; fail=0; inconclusive=0

classify_read() { # desc, path  (expects an existing path; failure => denial)
  local d="$1" p="$2"
  if [ -e "$p" ] 2>/dev/null && ls "$p" >/dev/null 2>&1; then
    echo "NOT-ISOLATED ALLOWED: $d ($p is readable)"; fail=$((fail+1))
  elif [ -e "$p" ] 2>/dev/null; then
    # exists per stat but ls denied -> permission denial
    echo "ok DENIED        : $d ($p exists but access blocked)"; pass=$((pass+1))
  else
    echo "?? INCONCLUSIVE  : $d ($p not visible — could be ABSENT or a stat-level deny)"; inconclusive=$((inconclusive+1))
  fi
}

echo "== LIVE native-sandbox coverage check (run via the agent shell tool) =="
echo "sandbox-state dir present? $( [ -d "$HOME_DIR/.kiro/sandbox-state" ] && echo yes || echo no )"
echo

# 1) Keychain via the security tool. Known to have existed; a block => DENIED.
if security list-keychains >/dev/null 2>&1; then
  echo "NOT-ISOLATED ALLOWED: keychain (security list-keychains succeeded)"; fail=$((fail+1))
else
  echo "ok DENIED        : keychain (security list-keychains blocked)"; pass=$((pass+1))
fi

# 2) Credential dirs known to exist from the audit (so failure = denial).
classify_read "home AWS creds"      "$HOME_DIR/.aws"
classify_read "home SSH keys"       "$HOME_DIR/.ssh"
classify_read "login keychains dir" "$HOME_DIR/Library/Keychains"

# 3) Positive control: the workspace must remain usable.
if ls ./package.json >/dev/null 2>&1; then
  echo "ok ALLOWED       : workspace read (expected)"; pass=$((pass+1))
else
  echo "FAIL             : workspace read blocked (sandbox too tight)"; fail=$((fail+1))
fi

# 4) Absent-vs-denied control: a path that does NOT exist must read as ABSENT,
#    proving the harness does not mislabel a missing file as a denial.
classify_read "nonexistent control" "$HOME_DIR/.this-path-does-not-exist-$$"

echo
echo "DENIED(pass)=$pass  NOT-ISOLATED(fail)=$fail  INCONCLUSIVE=$inconclusive"
if [ "$fail" -eq 0 ] && [ "$pass" -ge 4 ]; then
  echo "RESULT: native sandbox COVERS the agent shell tool for the credential surfaces tested"
else
  echo "RESULT: native sandbox does NOT (yet) cover the agent shell tool — enable it in the UI"
fi
