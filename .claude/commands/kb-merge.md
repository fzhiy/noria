---
name: kb-merge
description: Merge duplicate concept pages. Rewires wikilinks, preserves citations, creates redirect stubs.
argument-hint: <from-slug> <to-slug>
allowed-tools: Bash(npx tsx tools/kb-merge.ts *), Read, Grep, Glob, Edit
---

# KB Merge: Duplicate Concept Merger

Merge two concept pages when they cover the same topic. Preserves all citations, rewires wikilinks across the wiki, and leaves a redirect stub at the old location.

## Context: $ARGUMENTS

## Workflow

1. Parse the arguments to extract `<from-slug>` (page to retire) and `<to-slug>` (canonical page to keep).
2. If no arguments provided, run `--list-candidates` first to show fuzzy-match pairs.
3. Run a `--dry-run` first so the user can review the merge plan:
   ```bash
   npx tsx tools/kb-merge.ts --from <from-slug> --to <to-slug> --dry-run
   ```
4. Show the dry-run output to the user and ask for confirmation.
5. If confirmed, execute the merge:
   ```bash
   npx tsx tools/kb-merge.ts --from <from-slug> --to <to-slug>
   ```
6. Report the merge summary.

## Key Rules

- Always dry-run before executing.
- The `--to` slug is the canonical page that survives; `--from` becomes a redirect stub.
- All wikilinks across wiki/ are rewired from the old slug to the canonical slug.
- The merged page preserves all citations from both pages (deduplicated).
- Index.md is updated: the old entry is removed; its description is appended as a note to the canonical entry if different.
- The old page becomes a redirect stub with `merged_into:` in frontmatter.
