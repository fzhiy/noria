---
name: kb-novelty-check
description: Verify research idea novelty against KB + recent literature. Use when user says "查新", "novelty check", "有没有人做过", "check novelty", or before committing to a research direction.
argument-hint: [method-or-idea-description] [-- effort: lite|standard|extended|heavy|beast]
allowed-tools: Bash(*), Read, Write, Grep, Glob, WebSearch, WebFetch, mcp__codex__codex, mcp__codex__codex-reply
---

> **Effort**: Default `extended`. See `shared/effort-contract.md` for all tiers.
> **Origin**: Adapted from ARIS `novelty-check` for NORIA's KB-first architecture.
> **Output provenance**: `query-derived` — results go to `outputs/research/`, NEVER enter `wiki/`.

# KB Novelty Check: Verify Research Idea Against Literature

Verify novelty for: **$ARGUMENTS**

## Prerequisites

- Read `CLAUDE.md` for provenance rules.
- Read `schema.md` for citation format.

## Constants

- **REVIEWER_MODEL = `gpt-5.4`** — Via Codex MCP with xhigh reasoning (non-negotiable floor). Override with `-- reviewer: oracle-pro` for GPT-5.4 Pro via Oracle MCP. See `shared/reviewer-routing.md`.
- **SEARCH_WINDOW = 18 months** — Check papers from last 18 months (field moves fast).
- **MIN_QUERIES_PER_CLAIM = 3** — At least 3 different query formulations per core claim.
- **OUTPUT_DIR = `outputs/research/`** — NEVER write results to `wiki/`.

## Workflow

### Phase A: Extract Core Claims (2 min)

Read the user's method/idea description and decompose into 3-5 **falsifiable technical claims** that would need to be novel:

```markdown
## Core Claims to Verify
1. **Method claim**: What is the proposed technique?
2. **Problem claim**: What problem does it solve (that isn't already solved)?
3. **Mechanism claim**: What is the novel mechanism/insight?
4. **Advantage claim**: What makes it better than obvious baselines?
5. **Scope claim**: What settings/domains does it apply to?
```

For each claim, extract 3-5 **search keywords** (technical terms, method names, problem formulations).

### Phase B: Multi-Source Literature Search

Search in this order (local first = token-efficient):

#### B1. Local KB Search (zero external cost, highest priority)

The KB is the user's curated literature — it's the most relevant search space.

```bash
# Exact concept match
npx tsx tools/noria-reader.ts --search "<claim keywords>"

# Broader concept scan
npx tsx tools/noria-reader.ts --search "<method name>"
npx tsx tools/noria-reader.ts --search "<problem formulation>"
```

For each match:
- `noria-reader --brief <slug>` to check relevance (saves ~70% tokens)
- Only `--section` read if brief suggests close overlap
- Note the overlap level: EXACT / HIGH / PARTIAL / NONE

#### B2. External Academic Search

For each core claim, search using ALL available tools:

1. **arXiv** (preprints, most recent):
   ```bash
   npx tsx tools/arxiv-search.ts "<specific technical query>" --max-results 10
   ```
   - Try ≥3 query formulations per claim
   - Filter to last 18 months

2. **Semantic Scholar** (peer-reviewed, citation data):
   ```bash
   npx tsx tools/semantic-scholar-search.ts "<query>" --year 2025-2026
   ```
   - Check citation counts for overlapping papers
   - Look at "related papers" for near-misses

3. **DeepXiv** (if local tools insufficient):
   ```bash
   npx tsx tools/deepxiv-reader.ts search "<query>"
   ```

4. **Top venue check** — specifically search:
   - ICLR 2025/2026, NeurIPS 2025/2026, ICML 2025/2026
   - ACL/EMNLP 2025 (if NLP-related)
   - CVPR/ECCV 2025 (if vision-related)
   - Use venue-specific queries: `"<method> site:openreview.net"`, WebSearch for accepted paper lists

#### B3. Grey Literature (social-lead level — for awareness, cannot cite)

- WebSearch for blog posts, Twitter threads, GitHub repos
- These CANNOT establish prior art but may reveal parallel work in progress
- Mark as `social-lead` provenance

### Phase C: Cross-Model Verification

After collecting all potentially overlapping papers, call REVIEWER_MODEL via Codex MCP:

```
config: {"model_reasoning_effort": "xhigh"}
```

**Follow reviewer independence protocol** — do NOT summarize the papers for GPT. Instead:

```
You are a senior ML reviewer assessing novelty of a proposed method.

Proposed method: [user's original description, verbatim]

Potentially overlapping papers found:
[For each paper: title, authors, year, venue, arXiv ID — NOT your summary]

File paths for local papers (read them yourself):
[list of wiki/sources/*.md paths for overlapping KB pages]

Tasks:
1. For each overlapping paper, assess: EXACT OVERLAP / HIGH OVERLAP / PARTIAL OVERLAP / DIFFERENT
2. Identify the closest prior work and articulate the precise delta
3. Rate overall novelty: 1-10
4. Recommend: PROCEED / PROCEED WITH CAUTION / ABANDON
5. If PROCEED WITH CAUTION: suggest how to reposition for novelty
```

### Phase D: Novelty Report

Write to `outputs/research/novelty-<slug>-<timestamp>.md`:

```markdown
---
title: "Novelty Check: [Method/Idea Name]"
provenance: query-derived
generated: YYYY-MM-DDTHH:MM:SSZ
verdict: PROCEED | PROCEED_WITH_CAUTION | ABANDON
novelty_score: X/10
---

## Proposed Method
[1-2 sentence description from user input]

## Core Claims Assessment

| # | Claim | Novelty | Closest Prior Work | Delta |
|---|-------|---------|-------------------|-------|
| 1 | [claim] | HIGH/MEDIUM/LOW | [paper, year, venue] | [what's different] |
| 2 | [claim] | HIGH/MEDIUM/LOW | [paper, year, venue] | [what's different] |
| ... | | | | |

## Closest Prior Work (detailed)

### [Paper 1 Title] ([citekey], [year], [venue])
- **Overlap**: [specific overlap description]
- **Key difference**: [what the proposed method does differently]
- **Provenance**: [source-derived if in KB, external if not]

### [Paper 2 Title] ...

## KB Coverage

| Source | Papers Found | Overlap Level |
|--------|-------------|---------------|
| Local KB (wiki/) | X | [summary] |
| arXiv | Y | [summary] |
| Semantic Scholar | Z | [summary] |
| Top venues (ICLR/NeurIPS/ICML) | W | [summary] |
| Grey literature | V | [summary] |

## Overall Novelty Assessment

- **Score**: X/10
- **Verdict**: PROCEED / PROCEED WITH CAUTION / ABANDON
- **Key differentiator**: [what makes this unique, if anything]
- **Reviewer risk**: [what a reviewer would cite as prior work]
- **Positioning suggestion**: [how to frame the contribution]

## Suggested Actions

- If PROCEED: [next steps — e.g., `/kb-deep-research` to deepen understanding of gap]
- If CAUTION: [specific repositioning — e.g., "emphasize X instead of Y", "add comparison to Z"]
- If ABANDON: [alternative directions worth exploring]

## Papers to Ingest

External papers discovered that should enter the KB:
- [title] (arXiv:XXXX.XXXXX) — [why relevant]
```

### Phase E: Log

Append to `log.md`:
```
[YYYY-MM-DD HH:MM] [NOVELTY-CHECK] <method-name>: verdict=<PROCEED|CAUTION|ABANDON>, score=X/10, papers_checked=N
```

## Effort Scaling

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| claims_extracted | 2-3 | 3-4 | 3-5 | 4-5 | 5+ |
| queries_per_claim | 1 | 2 | 3 | 4 | 5+ |
| local_kb_depth | brief only | brief + top 3 section | brief + top 5 section | all relevant full read | exhaustive |
| external_sources | arXiv only | arXiv + S2 | arXiv + S2 + venues | + DeepXiv + web | exhaustive all |
| gpt_verification | skip | 1 round | 1 round | 2 rounds | 2 rounds + debate |
| venue_check | skip | top 2 venues | top 3 venues | all relevant | all + workshops |

## Key Rules

1. **Be BRUTALLY honest** — false novelty claims waste months of research. Better to discover overlap now than during review.
2. **"Apply X to Y" is NOT novel** unless the application reveals surprising insights or the combination is non-obvious.
3. **Check both method AND experimental setting** — a known method on a new domain may be novel, and vice versa.
4. **If the method is not novel but the FINDING would be, say so explicitly** — empirical surprises are publishable.
5. **Always check the most recent 6 months of arXiv** — the field moves fast, especially in PEFT/agents.
6. **Reviewer independence** — do NOT pre-summarize papers for GPT. Pass titles + paths, let GPT read independently.
7. **Output is `query-derived`** — NEVER write novelty reports into `wiki/`.
8. **Local KB first** — always search the user's curated knowledge base before external sources. The KB represents what the user already knows — overlap with KB content is not a dealbreaker, but overlap with external work IS.
9. **Track provenance of evidence** — distinguish `source-derived` (in KB) from external findings. KB papers are known quantities; external papers may need ingestion.
