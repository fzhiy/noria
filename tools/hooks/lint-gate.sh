#!/bin/bash
# Lint hard gate: blocks /kb-reflect if lint fails.
# Installed as a UserPromptSubmit hook in settings.local.json.
# Inspired by Hermes-Agent's lifecycle hook pattern.
#
# Input: $USER_PROMPT (from Claude Code hook environment)
# Output: non-zero exit + message to stderr = blocks the prompt

# Only trigger when the prompt IS the /kb-reflect command (not casual mentions)
TRIMMED=$(echo "$USER_PROMPT" | sed 's/^[[:space:]]*//')
if [[ "$TRIMMED" != "/kb-reflect"* ]]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Run lint (TS version) with timeout
output=$(timeout 25s npx tsx tools/kb-lint.ts --json 2>/dev/null)
rc=$?
if [ $rc -eq 124 ]; then
  echo "LINT GATE: kb-lint.ts timed out (25s). Allowing /kb-reflect — run '/kb-lint' manually to verify." >&2
  exit 0
fi
if [ $rc -ne 0 ] || [ -z "$output" ]; then
  echo "LINT GATE: Failed to run kb-lint.ts. Fix errors before /kb-reflect." >&2
  exit 1
fi

# Parse JSON: check if any failures
failed=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['failed'])" 2>/dev/null)

if [ "$failed" != "0" ]; then
  passed=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['passed'])" 2>/dev/null)
  total=$((passed + failed))
  echo "LINT GATE: kb-lint failed ($passed/$total checks passed). Run '/kb-lint' to see details. Fix all issues before /kb-reflect." >&2
  exit 1
fi

# Lint passed — allow /kb-reflect to proceed
exit 0
