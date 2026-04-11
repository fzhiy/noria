---
name: kb-import
description: Import existing Obsidian/markdown notes into raw/imports/ for subsequent /kb-compile.
argument-hint: [--source <path>] [--target <subdir>] [--dry-run] [--dedupe]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# KB Import: External notes → raw/imports/

Import existing markdown notes from external vaults or directories into `raw/imports/`, normalizing frontmatter and detecting duplicates. Does NOT write to `wiki/` directly — imported files go through the standard `/kb-compile` pipeline.

## Context: $ARGUMENTS

## Prerequisites
- Read `CLAUDE.md` for ownership boundaries (raw/ is user-owned, wiki/ is LLM-owned).
- Imported files go to `raw/imports/` and are treated as user input for compilation.

## Workflow

### Step 1: Run the import tool

```bash
npx tsx tools/kb-import.ts $ARGUMENTS
```

If no arguments provided, prompt the user for `--source` path at minimum.

### Step 2: Review output

The tool will report:
- Number of files imported
- Duplicates detected (if `--dedupe` was used)
- Files that had no frontmatter (auto-generated)
- Files that were empty or frontmatter-only (skipped/warned)

### Step 3: Suggest next steps

After a successful import, suggest:
1. Review imported files in `raw/imports/` to verify normalization
2. Run `/kb-compile` to process them into `wiki/sources/` and `wiki/concepts/`
3. If `--dedupe` found matches, review them manually before re-importing with adjusted content

## Common usage patterns

```bash
# Import from an Obsidian vault
npx tsx tools/kb-import.ts --source /path/to/vault --target raw/imports/my-vault

# Preview without writing
npx tsx tools/kb-import.ts --source /path/to/notes --dry-run

# Import with duplicate detection
npx tsx tools/kb-import.ts --source ./notes/ --dedupe

# Import test notes from raw/notes/
npx tsx tools/kb-import.ts --source raw/notes/ --target raw/imports/test --dry-run
```

## Key Rules

- NEVER write directly to `wiki/`. Imports always go to `raw/imports/`.
- Preserve original content verbatim. Only add/normalize frontmatter.
- Use `--dedupe` when importing from sources that may overlap with existing Zotero/arXiv papers.
- Use `--dry-run` first to preview before committing to an import.
