# NORIA Effort Contract

> Shared reference for all effort-aware skills. Effort tiers control **breadth and depth** of work — never reviewer quality or safety floors.

## 5-Tier Definitions

| Tier | Token Multiplier | Intent | Typical Use |
|------|-----------------|--------|-------------|
| `lite` | ~0.3x | Quick confirmation, minimum depth | Existence checks, abstract-level verification, fast iteration |
| `standard` | 1x (default) | Everyday working depth | Routine compile, search, standard enrichment |
| `extended` | ~2x | Deeper analysis | Full paper deepen, gap refinement, pre-merge review |
| `heavy` | ~4x | Deep reasoning | Cross-paper synthesis, architectural planning, thorough review |
| `beast` | 5–8x | Exhaustive analysis | Comprehensive literature survey, exhaustive review, auto-loop until converged |

## User Syntax

```
/skill "arguments" -- effort: heavy
```

Default is `standard` unless the skill specifies otherwise. Each skill declares its own default and valid range.

## Precedence Rule

```
Explicit named parameter  >  effort tier  >  skill default
```

Example: `/kb-deepen citekey -- effort: beast, sections: 3` → beast scaling for everything EXCEPT sections (capped at 3).

## Non-Negotiable Floors (invariant across all tiers)

| Setting | Value | Rationale |
|---------|-------|-----------|
| Codex `model_reasoning_effort` | **xhigh** | Reviewer quality is a floor, not a budget lever |
| Citation provenance check | **always on** | Citation integrity non-negotiable |
| `kb-lint` gate before `kb-reflect` | **enforced** | Quality gate non-negotiable |
| `query-derived` isolation | **always on** | Data quarantine non-negotiable |
| `user-verified` protection | **always on** | User content non-negotiable |
| GPT model for adversarial review | **gpt-5.4** | Never downgrade reviewer model |

## Per-Skill Effort Constants

### LLM-Heavy Skills (effort scales reasoning depth)

#### `/kb-deepen` — default: `extended`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| sections_to_read | 0 (abstract confirm) | 2 (intro + conclusion) | 5 (method + results + conclusion) | 10 (full paper) | all + appendix |
| domain_fields | no | no | yes | yes | yes |
| concept_propagation | skip | minimal | standard | thorough | exhaustive (all linked concepts) |
| venue_verify | skip | if top-conf | if top-conf | always | always |

#### `/kb-reflect` — default: `heavy`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| min_sources | 2 | 3 | 4 | 5 | 8+ |
| contradiction_analysis | skip | flag only | analyze | deep analyze | cross-validate all claims |
| synthesis_passes | 1 | 1 | 2 | 2 | 3+ until stable |
| open_questions | 1–2 | 2–3 | 3–4 | 4–5 | exhaustive |

#### `/research-review` — default: `extended`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| review_passes | 1 quick scan | 1 standard | 1 + follow-up | 2 independent | 2 independent + cross-compare |
| claims_checked | top 3 | top 5 | all major | all | all + edge cases |
| code_audit | skip | spot check | targeted | thorough | exhaustive |

#### `/kb-deep-research` — default: `extended`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| papers_discovered | 3–5 | 8–12 | 15–20 | 25–35 | 40–50 |
| reasoning_rounds | 1 | 2 | 3 | 4 | 6+ |
| auto_loop_max | 1 | 2 | 3 | 5 | until converged |

### Volume-Scalable Skills (effort scales quantity only)

#### `/kb-compile` — default: `standard`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| batch_size | 3 | 7 | 10 | 15 | all uncompiled |
| concept_enrichment | minimal | standard | standard | thorough | exhaustive |

#### `/kb-expand` — default: `standard`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| max_gaps_actioned | 1 | 3 | 5 | 8 | 15 |
| gap_types | demand only | demand + depth | all except audit | all | all + re-scan |

#### `/kb-ask` — default: `standard`

| Parameter | lite | standard | extended | heavy | beast |
|-----------|------|----------|----------|-------|-------|
| max_pages | 2 | 5 | 7 | 10 | 10 (hard cap) |
| synthesis_depth | lookup only | brief synthesis | standard synthesis | deep synthesis | exhaustive with citations |

### Effort-Invariant Skills (no effort parameter)

These always run at full capacity regardless of effort:

| Skill | Reason |
|-------|--------|
| `/kb-lint` | Deterministic, 8 checks always run |
| `/kb-gap-scan` | Zero LLM cost, always full scan |
| `/kb-discover` | Zero LLM cost, always full analysis |
| `/kb-triage` | Always processes all pending feedback |
| `/kb-merge` | Single-target operation |
| `/gpt-nightmare-review` | Fixed at beast (GPT-5.4 xhigh + codex exec) |

## Transparency Requirement

Each effort-aware skill MUST display its active tier at startup:

```
[kb-reflect] effort: heavy (4x) | min_sources=5, passes=2 | reviewer: gpt-5.4 xhigh (invariant)
```

## GPT Effort Mapping

For skills that invoke Codex CLI or MCP:

| NORIA Tier | Codex `model_reasoning_effort` | Notes |
|------------|-------------------------------|-------|
| lite | xhigh | Floor — never below xhigh |
| standard | xhigh | Floor — never below xhigh |
| extended | xhigh | Same |
| heavy | xhigh | Same |
| beast | xhigh | Same |

**Effort tiers do NOT downgrade GPT reasoning.** They only scale how many times GPT is called, how many papers it reviews, and how many rounds of iteration occur.
