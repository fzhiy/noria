---
name: kb-ingest
description: Stage URLs, notes, and documents into raw/. Use when capturing new source material.
argument-hint: [optional: source list, notes, or files to ingest]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# KB Ingest

Stage new source material into the raw layer only.

## Workflow

1. Read `CLAUDE.md` first.
2. Decide the correct raw target:
   - `raw/web/` for web snapshots
   - `raw/notes/` for freeform notes
   - `raw/documents/` for PDFs or other files
   - `raw/zotero/papers/` only through the Zotero sync path
3. Create new files with stable, descriptive names.
4. Preserve source provenance in the file content when possible.
5. Do not update `wiki/`, `.kb/manifest.json`, or `index.md` here.

## Notes

- This command is for staging, not summarization.
- If the input already exists in `raw/`, leave it alone unless the user explicitly asks for a replacement.
