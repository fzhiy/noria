---
name: kb-hypothesize
description: Generate and rank research hypotheses from KB knowledge gaps. Use when user says "找idea", "brainstorm", "generate hypotheses", "what gaps exist", or wants to convert structural gaps into actionable research directions.
argument-hint: [research-direction or concept-slug] [-- effort: lite|standard|extended|heavy|beast]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob, Agent, WebSearch, WebFetch, mcp__codex__codex, mcp__codex__codex-reply
---

> **Effort**: Default `extended`. See `shared/effort-contract.md` for all tiers.
> **Origin**: Adapted from ARIS `idea-creator` for NORIA's KB-first architecture.
> **Output provenance**: `query-derived` — results go to `outputs/research/`, NEVER enter `wiki/`.

# KB Hypothesize: Gaps + Open Questions → Ranked Research Hypotheses

Generate publishable research hypotheses for: **$ARGUMENTS**

## Prerequisites

- Read `CLAUDE.md` for ownership boundaries and forbidden operations.
- Read `schema.md` for provenance rules.
- Confirm KB is stable: run `npx tsx tools/kb-lint.ts` — abort if CRITICAL issues found.

## Constants

- **MAX_HYPOTHESES = 12** — Generate up to 12, filter to top 5-7.
- **MIN_SOURCES_PER_HYPOTHESIS = 2** — Every hypothesis must cite ≥2 `source-derived` pages.
- **REVIEWER_MODEL = `gpt-5.4`** — Via Codex MCP (`mcp__codex__codex`) with xhigh reasoning (non-negotiable floor). Override with `-- reviewer: oracle-pro` for GPT-5.4 Pro via Oracle MCP. See `shared/reviewer-routing.md`.
- **OUTPUT_DIR = `outputs/research/`** — NEVER write hypotheses to `wiki/`.

> Override via argument: `/kb-hypothesize "PEFT expressivity" -- effort: beast, max: 20`.

## Workflow

### Phase 0: Load KB Context (2-3 min)

Gather structured inputs from existing KB tools. These are ZERO LLM cost — run all three:

1. **Gap scan** — run `npx tsx tools/kb-gap-scan.ts` (or read most recent output if <24h old)
   - Extract: structural gaps (concept pairs with shared sources but no synthesis)
   - Extract: depth gaps (source pages still at abstract-level)
   - Extract: frontier gaps (concepts with high trend-metrics but few sources)

2. **Open questions** — run `npx tsx tools/kb-discover.ts --questions`
   - Extract: clustered open questions from `## Open Questions` sections across concept pages
   - Group by concept cluster

3. **Frontier concepts** — read `.kb/trend-metrics.json` (if exists)
   - Identify concepts with rising scores but insufficient synthesis coverage

4. **Prior hypotheses** — check `outputs/research/hypotheses-*.md` for previously generated hypotheses
   - Avoid regenerating ideas already explored or rejected

If `$ARGUMENTS` specifies a concept slug or research direction, filter all inputs to that scope.

### Phase 1: Landscape Survey (5-8 min)

Build a landscape map of the target area using token-efficient progressive reading:

1. **Local KB first** (zero external cost):
   - `noria-reader --search "<direction>"` for relevant source + concept pages
   - Read `wiki/index.md` for coarse routing
   - Read relevant `wiki/moc-*.md` for structural overview
   - `noria-reader --brief` on top 10-15 relevant pages (not full reads)

2. **External literature** (only for gaps not covered locally):
   - `npx tsx tools/arxiv-search.ts "<specific-technical-query>"` — last 6 months
   - `npx tsx tools/semantic-scholar-search.ts "<query>"` — top venue papers
   - WebSearch for recent workshop/blog posts (Track A — `social-lead` level only, cannot cite in hypotheses)

3. **Landscape map output** (internal, not saved):
   ```
   Area: [research direction]
   Local coverage: X sources, Y concepts, Z synthesis pages
   Recent external: N relevant papers not yet in KB
   Structural gaps: [list from Phase 0]
   Open questions: [clustered list from Phase 0]
   Active research fronts: [from trend-metrics + external search]
   ```

### Phase 2: Hypothesis Generation (brainstorm with external LLM)

Call REVIEWER_MODEL via Codex MCP for divergent brainstorming:

```
config: {"model_reasoning_effort": "xhigh"}
```

Prompt structure (follow `shared-references/reviewer-independence.md` — do NOT pre-digest KB content for the reviewer):

```
You are a senior ML researcher brainstorming research hypotheses.

Research area: [direction from $ARGUMENTS]
Available evidence base: [list of concept page titles + source counts — NOT content summaries]
Known structural gaps: [gap list from Phase 0 — concept pairs, NOT interpretations]
Open questions from literature: [raw question clusters — NOT your analysis]

Generate 8-12 concrete research hypotheses. For each:
1. **Hypothesis**: One-sentence falsifiable claim
2. **Mechanism**: How/why this would work (2-3 sentences)
3. **Minimum Viable Experiment (MVE)**: Simplest test to validate/falsify
4. **Risk**: What could go wrong, what's the most likely failure mode
5. **Novelty estimate**: HIGH/MEDIUM/LOW with reasoning
6. **Effort estimate**: person-weeks for MVE

Rules:
- "Apply X to Y" is NOT a hypothesis unless it predicts a surprising outcome
- Negative results ("X does NOT improve Y because Z") are valid hypotheses
- Each hypothesis must be falsifiable — state what evidence would disprove it
- Prefer hypotheses that exploit structural gaps (two well-studied areas with no bridge)
```

### Phase 3: First-Pass Filtering (3-5 min)

Reduce 8-12 hypotheses to 5-7 by applying three filters:

1. **Feasibility filter**: Can the hypothesis be tested with available resources?
   - Does the KB contain enough evidence to design an experiment?
   - Is the MVE realistic (estimate effort honestly)?

2. **Quick novelty check**: For each hypothesis, search:
   - Local KB: `noria-reader --search "<hypothesis core claim>"`
   - Quick WebSearch: `"<key method> <key claim>" site:arxiv.org 2025..2026`
   - If a close match found → downgrade novelty score, don't eliminate yet

3. **"So what?" test**: If the hypothesis is TRUE, does anyone care?
   - Would this change how people build systems?
   - Would this resolve a known debate?
   - Would this enable something previously impossible?

**Eliminate**: hypotheses that fail ≥2 of 3 filters. Keep borderline ones with explicit warnings.

### Phase 4: Deep Validation (5-10 min)

For the remaining 5-7 hypotheses:

1. **Full novelty check**: Run `/kb-novelty-check "<hypothesis statement>"` for each
   - Or if time-constrained, run novelty check on top 3 only

2. **Devil's advocate review**: Call REVIEWER_MODEL via Codex MCP:
   ```
   config: {"model_reasoning_effort": "xhigh"}
   ```
   Prompt: "For each hypothesis, give the strongest argument AGAINST it. What would a skeptical NeurIPS reviewer say?"

3. **Re-rank** based on:
   - Novelty score (from novelty check)
   - Evidence strength (how many source-derived citations support it)
   - Feasibility (MVE effort estimate)
   - Impact ("So what?" score)

### Phase 5: Output — Hypothesis Report

Write to `outputs/research/hypotheses-<timestamp>.md`:

```markdown
---
title: "Hypothesis Report: [Research Direction]"
provenance: query-derived
generated: YYYY-MM-DDTHH:MM:SSZ
kb_state: "X sources, Y concepts, Z synthesis"
effort: [tier used]
---

## Landscape Summary

[2-3 paragraphs: area overview, current KB coverage, identified gaps]

## Recommended Hypotheses (ranked)

### H1: [Hypothesis statement] (Novelty: X/10, Evidence: Y/10, Feasibility: Z/10)

- **Mechanism**: [How/why]
- **Gap source**: structural gap between [[concept-A]] and [[concept-B]]
- **Supporting evidence**: [source: paper1, sec.X], [source: paper2, abstract]
- **Counter-evidence**: [source: paper3, sec.Y] (if any)
- **MVE**: [Minimum viable experiment description]
- **Suggested methodology**: Based on [source: paper4] approach
- **Risk**: [Primary failure mode]
- **Next step**: `/kb-deep-research "<specific research question>"` OR `/kb-novelty-check "<claim>"`

### H2: ...
[repeat for each ranked hypothesis]

## Eliminated Hypotheses

| # | Hypothesis | Reason Eliminated |
|---|---|---|
| E1 | ... | Prior work: [paper] already demonstrated this |
| E2 | ... | Infeasible: requires [resource] not available |

## Suggested KB Expansions

Papers or topics discovered during landscape survey that should be ingested:
- [paper title] (arXiv:XXXX.XXXXX) — relevant to H1, H3
- [topic] — gap in current concept coverage

## Meta

- Hypotheses generated: [N total] → [M after filtering] → [K recommended]
- Sources consulted: [count] local + [count] external
- Novelty checks run: [count]
- GPT review rounds: [count]
```

### Phase 6: Log

Append to `log.md`:
```
[YYYY-MM-DD HH:MM] [HYPOTHESIZE] <direction>: +N hypotheses (top K recommended), effort: <tier>
```

Do NOT git commit automatically — hypotheses are exploratory output, user decides what to act on.

## Effort Scaling

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| landscape_sources | 5 | 10 | 15 | 25 | 40+ |
| hypotheses_generated | 4-6 | 6-8 | 8-12 | 10-15 | 15-20 |
| novelty_checks | 0 (quick only) | top 2 | top 3-5 | all | all + deep |
| gpt_review_rounds | 0 | 1 | 1 | 2 | 2 + cross-compare |
| external_search | skip | arXiv only | arXiv + S2 | arXiv + S2 + web | exhaustive |

## Key Rules

1. **Output is `query-derived`** — NEVER write hypotheses into `wiki/`. They live in `outputs/research/` only.
2. **Every hypothesis must cite ≥2 `source-derived` KB pages** — no unsupported speculation.
3. **Reviewer independence**: Do NOT summarize KB content for GPT. Pass file paths + titles, let GPT read and judge independently (see `shared-references/reviewer-independence.md`).
4. **Direction too broad?** If `$ARGUMENTS` is something vague like "ML" or "NLP", STOP and ask user to narrow down. Suggest using `wiki/moc-*.md` to pick a focused area.
5. **Negative results are valid** — "X does NOT work because Y" is a publishable hypothesis if surprising.
6. **No "apply X to Y" filler** — reject hypotheses that just combine known techniques without predicting a surprising outcome.
7. **Provenance chain**: landscape → gaps → hypotheses → validation. Every step is traceable.
