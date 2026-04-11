---
name: kb-discover
description: "Find cross-paper insights: claim extraction, question clustering, concept-distance bridges. Zero LLM cost."
argument-hint: --claims | --questions | --distances [--json]
allowed-tools: Bash(*), Read, Grep, Glob
---

# KB Discover: Cross-Paper Insight Extraction

Zero-LLM-cost analysis that surfaces latent connections across wiki pages.

## Modes

### `--claims` — Extract multi-paper claim relationships
Scans `wiki/sources/` and `wiki/synthesis/` for sentences referencing ≥2 citekeys.
Classifies each by signal words: contradicts / extends / supports / qualifies / related.

```bash
npx tsx tools/kb-discover.ts --claims
```

### `--questions` — Cluster Open Questions
Pulls all `## Open Questions` bullets from concept pages, clusters by Jaccard similarity
(threshold 0.25) with a bonus for shared source citekeys.

```bash
npx tsx tools/kb-discover.ts --questions
```

### `--distances` — Find bridge candidates
BFS shortest paths between all concept pairs. Scores `distance × shared_sources` to
find high-novelty bridges: concepts that are far apart in the graph but share many sources.

```bash
npx tsx tools/kb-discover.ts --distances
```

## Output

- Human-readable report to stdout (default)
- `--json` for machine-readable output
- Report saved to `outputs/reviews/YYYY-MM-DD-discover-{mode}.md`

## When to use

- After `/kb-compile` adds new source pages — run `--claims` to find new cross-paper relations
- After `/kb-reflect` updates synthesis — run `--questions` to find clustered open questions
- Periodically run `--distances` to find synthesis opportunities (high-distance, high-shared bridges)
