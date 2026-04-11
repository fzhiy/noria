---
name: kb-trending
description: Discover trending arXiv papers relevant to the research topic via DeepXiv social signals + local RT filtering. Zero LLM cost for discovery.
argument-hint: [optional: --days 7|14|30] [--save] [--local]
allowed-tools: Bash(*), Read, Grep, Glob
---

# KB Trending: Research Topic Hot Paper Discovery

Discover trending arXiv papers relevant to "continual adaptation of web agents under UI/workflow drifts" using DeepXiv social signal API + local keyword filtering.

## Context: $ARGUMENTS

## How to Run

```bash
# Discover this week's RT-relevant trending papers
npx tsx tools/deepxiv-reader.ts --trending --days 7 --filter

# Two-week range, more results
npx tsx tools/deepxiv-reader.ts --trending --days 14 --limit 50 --filter

# Save passing papers to raw/deepxiv/ for later compile
npx tsx tools/deepxiv-reader.ts --trending --days 7 --filter
# Then for each passing paper:
npx tsx tools/deepxiv-reader.ts --brief <arxiv_id>  # get full metadata
# Save to raw/deepxiv/<citekey>.md with source_type: deepxiv-trending

# Local-only triage (no DeepXiv API, uses existing wiki)
npx tsx tools/noria-reader.ts --triage --all
```

## Workflow

1. `deepxiv-reader --trending --days 7 --filter` → shows RT-relevant hot papers (zero LLM cost)
2. For interesting papers: `deepxiv-reader --brief <id>` → full metadata (1 API call)
3. For papers worth compiling: `deepxiv-reader --head <id>` → section structure (1 API call)
4. Save to `raw/deepxiv/` with appropriate frontmatter
5. `/kb-compile` to add to wiki. **Provenance rule**: arXiv papers are academic preprints → compile as `source-derived` with `venue_tier: arxiv-preprint`. The trending signal (Twitter engagement) is how we DISCOVERED them, not their provenance. Only web captures, tweets, and blog posts use `social-lead`.
6. Run `npx tsx tools/noria-reader.ts --triage --all` to see updated full-wiki status

## Cost

- Trending scan: 1 API call (free)
- Brief per paper: 1 API call each
- Total weekly: ~31 API calls, **zero LLM tokens**
- Daily quota: 1K anonymous / 10K registered

## Key Rules

- Trending signal = Twitter social engagement used for DISCOVERY, not provenance. arXiv papers discovered via trending are still `source-derived` (they are academic preprints). Only the tweet itself would be `social-lead`.
- Always run `--filter` to avoid noise. Filter uses research-topic-config.json keywords (zero LLM cost).
- If DeepXiv API is rate-limited (exit code 2), fall back to local tools.
- Do NOT read full papers from trending alone — use `--brief` first, then decide.
