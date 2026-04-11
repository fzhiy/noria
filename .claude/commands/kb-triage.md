---
name: kb-triage
description: "Triage accumulated feedback from outputs/queries/ — classify gaps/accuracy/insights, write signal-index.jsonl for flywheel."
argument-hint: [--dry-run] [--include-triaged]
allowed-tools: Bash(*), Read, Grep, Glob
---

# KB Triage

Batch-process accumulated feedback from the MCP server's `submit_feedback` tool. Classifies feedback entries, generates a triage report, and appends machine-readable signals to `.kb/signal-index.jsonl` for the knowledge flywheel.

## Usage

```bash
# Triage all pending feedback
npx tsx tools/kb-feedback-triage.ts

# Preview without writing
npx tsx tools/kb-feedback-triage.ts --dry-run

# Include already-triaged items (for re-analysis)
npx tsx tools/kb-feedback-triage.ts --include-triaged
```

## What It Does

1. Scans `outputs/queries/` for feedback files with `feedback_kind` field
2. Classifies into gap / accuracy / insight buckets
3. Clusters gap themes by wiki page anchor
4. Cross-references with Open Questions in concept pages
5. Writes triage report to `outputs/reviews/YYYY-MM-DD-feedback-triage.md`
6. Appends `SignalRecord` entries to `.kb/signal-index.jsonl` (consumed by gap scan + MCP demand prior)

## Flywheel Integration

```
submit_feedback (MCP) → outputs/queries/*.md
         ↓
    /kb-triage → .kb/signal-index.jsonl
         ↓
    /kb-gap-scan reads signal-index → identifies demand/audit gaps
         ↓
    /kb-expand routes gaps to sync+compile
```

## When to Run

- After accumulating feedback from external agents via MCP
- Before running `/kb-gap-scan` (to ensure signal-index is up to date)
- Periodically as part of the knowledge flywheel maintenance cycle
