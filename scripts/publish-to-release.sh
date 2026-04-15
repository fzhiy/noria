#!/usr/bin/env bash
# Clean-room build: allowlist-copy from private repo to noria-release
# Usage: ./scripts/publish-to-release.sh /path/to/private-repo
set -euo pipefail

PRIVATE_REPO="${1:?Usage: $0 /path/to/private-repo}"
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALLOWLIST="${PRIVATE_REPO}/.noria-public-allowlist"

if [ ! -f "$ALLOWLIST" ]; then
  echo "ERROR: $ALLOWLIST not found"
  exit 1
fi

echo "=== NORIA Clean-Room Build ==="
echo "Source: $PRIVATE_REPO"
echo "Target: $RELEASE_DIR"

# Step 0: Build in clean temp directory, then sync
STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

# Step 1: Copy allowlisted files into staging
echo "[1/4] Copying allowlisted files..."
COPIED=0
while IFS= read -r pattern; do
  pattern="$(echo "$pattern" | sed 's/#.*//' | xargs)"
  [ -z "$pattern" ] && continue
  for f in $PRIVATE_REPO/$pattern; do
    [ -e "$f" ] || continue
    rel="${f#$PRIVATE_REPO/}"
    target="$STAGING/$rel"
    mkdir -p "$(dirname "$target")"
    cp -r "$f" "$target"
    COPIED=$((COPIED + 1))
  done
done < "$ALLOWLIST"
echo "  Copied $COPIED items"

# Step 2: Brand replacement (in staging)
echo "[2/4] Brand replacement (provewiki → noria)..."
find "$STAGING/tools" "$STAGING/docs" -type f \( -name "*.ts" -o -name "*.py" -o -name "*.md" -o -name "*.sh" \) 2>/dev/null | while read f; do
  sed -i 's/provewiki/noria/g; s/ProveWiki/NORIA/g' "$f" 2>/dev/null || true
done

# Step 3: Scan for private patterns (in staging)
echo "[3/4] Scanning for private patterns..."
LEAKS=0
PRIVATE_PATTERNS_FILE="${PRIVATE_REPO}/.noria-private-patterns"
if [ -f "$PRIVATE_PATTERNS_FILE" ]; then
  mapfile -t PATTERNS < "$PRIVATE_PATTERNS_FILE"
else
  echo "  WARNING: $PRIVATE_PATTERNS_FILE not found. Create it with one pattern per line."
  PATTERNS=()
fi
for pattern in "${PATTERNS[@]}"; do
  FOUND=$(grep -rn "$pattern" "$STAGING" --include="*.md" --include="*.ts" --include="*.py" --include="*.sh" --include="*.json" --include="*.toml" --include="*.yml" 2>/dev/null || true)
  if [ -n "$FOUND" ]; then
    echo "  LEAK: pattern '$pattern' found:"
    echo "$FOUND" | head -5
    LEAKS=$((LEAKS + 1))
  fi
done

if [ "$LEAKS" -gt 0 ]; then
  echo "  BLOCKED: $LEAKS leak pattern(s) found. Fix before committing."
  exit 1
fi
echo "  Clean — no private patterns found"

# Step 4: gitleaks scan (in staging)
echo "[4/4] Running gitleaks..."
if command -v gitleaks &>/dev/null; then
  gitleaks detect --source="$STAGING" --no-git 2>&1 || {
    echo "  BLOCKED: gitleaks found secrets"
    exit 1
  }
  echo "  Clean — gitleaks passed"
else
  echo "  SKIP — gitleaks not installed (install: brew install gitleaks)"
fi

# Step 5: Atomically sync staging → release (preserving .git/)
echo "[5/5] Syncing to release directory..."
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='AUTO_REVIEW.md' --exclude='REVIEW_STATE.json' "$STAGING/" "$RELEASE_DIR/"

echo ""
echo "=== Build complete (clean-room) ==="
echo "Review changes: cd $RELEASE_DIR && git diff --stat"
echo "Commit: git add -A && git commit -m 'release: sync from private repo'"
