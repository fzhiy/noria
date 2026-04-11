#!/bin/bash
# Sync verified wiki knowledge to a remote research machine
# Usage: ./scripts/sync-to-remote.sh user@host:/path/to/wiki-knowledge/

set -euo pipefail
EXPORT_DIR="$(mktemp -d)"
trap 'rm -rf "$EXPORT_DIR"' EXIT

npx tsx tools/kb-export.ts --output "$EXPORT_DIR" --min-provenance source-derived

PAGE_COUNT="$(find "$EXPORT_DIR" -name '*.md' | wc -l)"
rsync -avz --delete "$EXPORT_DIR/" "${1:?Usage: $0 user@host:/path/}"
echo "Synced $PAGE_COUNT pages to $1"
