---
name: kb-gap-scan
description: "Detect 5 types of knowledge gaps: demand, depth, structural, frontier, audit. Zero LLM cost. Core flywheel component."
argument-hint: [--type demand|depth|structural|frontier|audit] [--json]
allowed-tools: Bash(*), Read, Grep, Glob
---

# KB Gap Scan

Run deterministic knowledge gap detection across the wiki. Zero LLM cost — pure data analysis.

## Usage

```bash
# Full scan (all 5 gap types)
npx tsx tools/kb-gap-scan.ts

# Specific gap type
npx tsx tools/kb-gap-scan.ts --type demand
npx tsx tools/kb-gap-scan.ts --type depth

# Machine-readable output
npx tsx tools/kb-gap-scan.ts --json
```

## Gap Types

1. **Demand** — topic queried ≥3 times (from `.kb/signal-index.jsonl`) but wiki coverage is thin
2. **Depth** — source exists but only has abstract-level citations; linked to ≥3 concepts
3. **Structural** — two concepts share ≥3 sources but no synthesis bridges them
4. **Frontier** — concept's newest source is >1 year old (stale coverage)
5. **Audit** — accuracy feedback disputes a claim (from signal-index)

## Workflow

1. Run gap scan to identify priorities
2. For demand gaps → `/kb-sync` or `/kb-expand` to find new sources
3. For depth gaps → `/kb-deepen` to enrich abstract-only pages
4. For structural gaps → `/kb-reflect` to write bridge synthesis
5. For frontier gaps → `/kb-trending` or `/kb-sync` for recent papers
6. For audit gaps → manually verify claims against `raw/` sources

## Data Sources

- `.kb/signal-index.jsonl` — feedback demand signals (from `/kb-triage`)
- `.kb/relations.jsonl` — typed edges between pages
- `wiki/` frontmatter — page metadata (year, sources, provenance, citations)

Report saved to `outputs/reviews/YYYY-MM-DD-gap-scan.md`.
