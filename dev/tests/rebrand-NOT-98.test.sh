#!/usr/bin/env bash
# Verification test for NOT-98: rebrand Klue → Gloss
# Asserts in-scope files no longer contain "klue" (case-insensitive), that key
# user-visible strings now read "Gloss", and that explicitly excluded paths are
# untouched. Run from the Klue/ directory or anywhere — paths are anchored.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KLUE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0
FAIL=0
FAILED_ASSERTIONS=()

pass() { PASS=$((PASS+1)); printf "  ✓ %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); FAILED_ASSERTIONS+=("$1"); printf "  ✗ %s\n" "$1"; }

# Assert a file does NOT contain "klue" (case-insensitive).
assert_no_klue() {
  local file="$1"
  if [[ ! -f "$KLUE_DIR/$file" ]]; then
    fail "missing file: $file"
    return
  fi
  if grep -i -q "klue" "$KLUE_DIR/$file"; then
    fail "$file still contains 'klue'"
  else
    pass "$file is klue-free"
  fi
}

# Assert a file contains an exact string.
assert_contains() {
  local file="$1"; local needle="$2"
  if grep -q -F "$needle" "$KLUE_DIR/$file" 2>/dev/null; then
    pass "$file contains '$needle'"
  else
    fail "$file missing '$needle'"
  fi
}

# Assert a file (still) contains a string — used for excluded files.
assert_unchanged_contains() {
  local file="$1"; local needle="$2"
  if grep -q -F "$needle" "$KLUE_DIR/$file" 2>/dev/null; then
    pass "[excluded] $file still contains '$needle'"
  else
    fail "[excluded] $file lost '$needle' — should not have been touched"
  fi
}

echo ""
echo "=== NOT-98 Rebrand Verification ==="
echo ""
echo "--- A. In-scope files must be klue-free ---"

IN_SCOPE_FILES=(
  # UI (user-visible)
  "panel.html"
  "logo-generator.html"
  "modules/capture.js"
  "ai-harness/harness.js"
  "ai-harness/providers/openrouter.js"
  # Code
  "background.js"
  "panel.js"
  "panel.css"
  "utils.js"
  "modules/ai-chat.js"
  "modules/utils.js"
  "modules/settings.js"
  # Dev tooling
  "dev/scripts/full-debug-test.js"
  "dev/scripts/test-data-script.js"
  "dev/scripts/verify-db.js"
  "dev/scripts/create-icons.py"
  "dev/scripts/icons.html"
  "dev/dev-watch.py"
  "dev/build/package.json"
  # Release scripts
  "package.sh"
  "fix-and-push.sh"
  "push-to-github.sh"
  # Extension docs
  "README.md"
  "PRIVACY.md"
  "assets/privacy_practices.md"
)

for f in "${IN_SCOPE_FILES[@]}"; do
  assert_no_klue "$f"
done

# docs/*.md (excluding archive/ and timeline/) — discover dynamically.
while IFS= read -r doc; do
  rel="${doc#$KLUE_DIR/}"
  assert_no_klue "$rel"
done < <(find "$KLUE_DIR/docs" -maxdepth 1 -type f -name "*.md")

echo ""
echo "--- B. User-visible 'Gloss' strings present ---"
assert_contains "panel.html" "<title>Gloss</title>"
assert_contains "panel.html" ">Gloss<"
assert_contains "panel.html" "Welcome to Gloss"
assert_contains "modules/capture.js" "siteName: 'Gloss'"
assert_contains "ai-harness/providers/openrouter.js" "'X-Title': 'Gloss'"
assert_contains "ai-harness/harness.js" "Gloss"

echo ""
echo "--- C. Explicitly excluded paths untouched ---"
# manifest.json was flipped after the user reversed the earlier exclusion:
# name → Gloss, default_title → Open Gloss, version → 2.0.0
assert_no_klue "manifest.json"
assert_contains "manifest.json" "\"name\": \"Gloss\""
assert_contains "manifest.json" "\"version\": \"2.0.0\""
assert_contains "manifest.json" "Open Gloss"
# Icon PNGs regenerated with new wordmark
for png in icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png; do
  if [[ -f "$KLUE_DIR/$png" ]]; then
    pass "$png exists"
  else
    fail "$png missing"
  fi
done
# Historical / archival records: RESTRUCTURE_HISTORY.md must still exist untouched
if [[ -f "$KLUE_DIR/RESTRUCTURE_HISTORY.md" ]]; then
  pass "[excluded] RESTRUCTURE_HISTORY.md preserved"
else
  fail "[excluded] RESTRUCTURE_HISTORY.md missing"
fi
# Spot-check archive and timeline still have klue references (history shouldn't be rewritten)
if grep -rli "klue" "$KLUE_DIR/docs/archive" >/dev/null 2>&1; then
  pass "[excluded] docs/archive/ retains klue history"
else
  fail "[excluded] docs/archive/ lost klue references"
fi
if grep -rli "klue" "$KLUE_DIR/docs/timeline" >/dev/null 2>&1; then
  pass "[excluded] docs/timeline/ retains klue history"
else
  fail "[excluded] docs/timeline/ lost klue references"
fi
# Landing pages are out of scope
if grep -rli "klue" "$KLUE_DIR/landing3" >/dev/null 2>&1; then
  pass "[excluded] landing3/ untouched"
else
  fail "[excluded] landing3/ lost klue references"
fi

echo ""
echo "=== Result: $PASS passed, $FAIL failed ==="
if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "Failed assertions:"
  for a in "${FAILED_ASSERTIONS[@]}"; do echo "  - $a"; done
  exit 1
fi
exit 0
