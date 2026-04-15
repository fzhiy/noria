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

# Step 1: Copy allowlisted files
echo "[1/4] Copying allowlisted files..."
COPIED=0
while IFS= read -r pattern; do
  pattern="$(echo "$pattern" | sed 's/#.*//' | xargs)"
  [ -z "$pattern" ] && continue
  for f in $PRIVATE_REPO/$pattern; do
    [ -e "$f" ] || continue
    rel="${f#$PRIVATE_REPO/}"
    target="$RELEASE_DIR/$rel"
    mkdir -p "$(dirname "$target")"
    cp -r "$f" "$target"
    COPIED=$((COPIED + 1))
  done
done < "$ALLOWLIST"
echo "  Copied $COPIED items"

# Step 2: Brand replacement
echo "[2/4] Brand replacement (provewiki → noria)..."
find "$RELEASE_DIR/tools" "$RELEASE_DIR/docs" -type f -name "*.ts" -o -name "*.py" -o -name "*.md" -o -name "*.sh" 2>/dev/null | while read f; do
  sed -i 's/provewiki/noria/g; s/ProveWiki/NORIA/g' "$f" 2>/dev/null || true
done

# Step 3: Scan for private patterns
echo "[3/4] Scanning for private patterns..."
LEAKS=0
for pattern in "fy274" "exeter" "144\.173\." "/mnt/d/" "provewiki2026" "/home/fy274/"; do
  FOUND=$(grep -rn "$pattern" "$RELEASE_DIR" --include="*.md" --include="*.ts" --include="*.py" --include="*.sh" --include="*.json" 2>/dev/null | grep -v ".git/" | grep -v "node_modules/" || true)
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

# Step 4: gitleaks scan
echo "[4/4] Running gitleaks..."
if command -v gitleaks &>/dev/null; then
  gitleaks detect --source="$RELEASE_DIR" --no-git 2>&1 || {
    echo "  BLOCKED: gitleaks found secrets"
    exit 1
  }
  echo "  Clean — gitleaks passed"
else
  echo "  SKIP — gitleaks not installed (install: brew install gitleaks)"
fi

echo ""
echo "=== Build complete ==="
echo "Review changes: cd $RELEASE_DIR && git diff --stat"
echo "Commit: git add -A && git commit -m 'release: sync from private repo'"
