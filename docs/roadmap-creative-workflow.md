# Roadmap: Creative Research Workflow Layer

> Origin: GPT-5.4 xhigh nightmare review (2026-04-11) identified that NORIA has excellent knowledge curation but no workflow for converting knowledge gaps into research output.

## Problem Statement

NORIA's pipeline is: **Papers → raw/ → wiki/ → gaps**. It stops there.

A complete auto-research flywheel needs: **Papers → raw/ → wiki/ → gaps → hypotheses → experiments → outlines → presentations → new papers**.

The gap between "we know what's missing" and "here's what to do about it" is currently bridged only by human intuition.

## Current Foundation

| Tool | What it does | Creative potential |
|---|---|---|
| `kb-gap-scan.ts` | 5-type gap detection (demand, depth, structural, frontier, audit) | HIGH — structural gaps = hypothesis candidates |
| `kb-discover.ts --questions` | Cluster open questions from papers | HIGH — clusters = candidate research questions |
| `kb-deep-research.md` | ChatGPT deep reasoning sessions | MEDIUM — produces notes, not structured output |
| `research-frontier.md` | Frontier concepts + synthesis candidates | MEDIUM — tells what to synthesize, not why |
| `kb-output.ts --marp` | Mechanical slide export | LOW — lifts headings, no argument ordering |

## Phased Plan

### Phase 1: Hypothesis Generation (Priority: MEDIUM-HIGH)

**When**: After KB stabilization (lint 8/8, >150 sources compiled)

**Tool**: `kb-hypothesize` (new slash command)

**Input**: 
- Structural gaps from `kb-gap-scan` (concept pairs with shared sources but no synthesis)
- Clustered open questions from `kb-discover --questions`
- Frontier concepts from `research-frontier.md`

**Output**: Ranked hypothesis list in `outputs/research/hypotheses-<timestamp>.md`:
```markdown
## H1: [Hypothesis statement] (Novelty: 8/10, Evidence: 6/10)
- **Gap source**: structural gap between [[concept-A]] and [[concept-B]]
- **Supporting evidence**: [source: paper1, sec.3], [source: paper2, abstract]
- **Contradicting evidence**: [source: paper3, sec.5]
- **Suggested methodology**: Based on [source: paper4] approach
- **Next step**: /kb-deep-research to validate
```

**Success metric**: Generate 5-10 ranked hypotheses from a gap cluster in <5 minutes. User acts on ≥1 within 2 weeks.

### Phase 2: Experiment Plan Templates (Priority: MEDIUM)

**When**: After Phase 1 validated (user used hypotheses in real research)

**Tool**: Extend `kb-deep-research.md` with `--experiment-plan` mode

**Input**: Selected hypothesis from Phase 1 + related methodology papers

**Output**: Structured experiment plan:
- Variables (independent, dependent, control)
- Metrics (from `recovery_metric` frontmatter field)
- Baselines (from related benchmark papers)
- Expected results + falsification criteria

### Phase 3: Paper Outline Builder (Priority: LOW)

**When**: When user starts writing a paper using NORIA data

**Tool**: `kb-outline` (new slash command)

**Input**: Hypothesis + related synthesis pages + experiment results

**Output**: Chapter structure with claim-to-source alignment

### Phase 4: Presentation Storyline (Priority: LOW)

**When**: When user needs to present findings (seminar, defense)

**Tool**: Extend `kb-output.ts` with `--storyline` mode

**Input**: Outline from Phase 3

**Output**: Slide sequence ordered by argument flow, not page order

## Relationship to Auto-Research Flywheel

```
Current flywheel (operational):
  Papers → raw/ → wiki/ → gaps → [HUMAN BRIDGE] → new search → more papers

With creative workflow layer:
  Papers → raw/ → wiki/ → gaps
    → kb-hypothesize → ranked hypotheses
    → kb-deep-research --experiment → experiment plans  
    → [HUMAN: run experiments]
    → kb-outline → paper structure
    → kb-output --storyline → presentation
    → [HUMAN: publish] → citations → more papers
```

The creative layer fills the gap between "knowledge curation" and "knowledge production."

## Decision Criteria

**Build Phase 1 if**:
- KB has ≥150 compiled sources (sufficient structural gaps to detect)
- User has an active research question (not just building the KB)
- `kb-gap-scan` identifies ≥3 structural gaps worth exploring

**Do NOT build if**:
- User primarily uses NORIA for reading/organizing, not hypothesis generation
- `kb-deep-research` sessions are already producing sufficient research direction
- The manual bridge (read gaps → think → act) is fast enough for current workload
