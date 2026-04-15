# NORIA Feedback Loop Design

> Inspired by Hermes-Agent (NousResearch) self-improving architecture.
> Adapted for provenance-first academic KB with human-in-the-loop governance.

## 1. Background: Why Hermes-Agent Matters

[Hermes-Agent](https://github.com/NousResearch/hermes-agent) is an open-source self-improving AI agent framework (MIT, 36.8k stars). Its core innovation: a **four-stage learning loop** where the agent creates skills from experience, improves them during use, persists knowledge via periodic nudges, and builds a deepening user model across sessions.

**We do NOT use Hermes directly** — it's a general-purpose personal assistant, while NORIA needs a provenance-governed academic feedback layer. But five of its design patterns translate directly.

## 2. Five Borrowed Design Patterns

### 2.1 Periodic Nudge → Feedback Triage

**Hermes pattern**: Instead of dumping every interaction to memory in real-time, the agent receives periodic internal prompts asking "is anything from recent activity worth persisting?" This is agent-curated memory, not automatic logging.

**NORIA adaptation**: `tools/kb-feedback-triage.ts` runs periodically (cron or manual), not in real-time. It scans `outputs/queries/` for pending feedback, classifies by kind, clusters recurring themes, and generates a triage report to `outputs/reviews/`.

**Key difference**: Hermes lets the agent decide what's important. We let **humans decide** — the triage script only summarizes and recommends, it never modifies wiki/.

**Why this matters**: Prevents hallucination amplification. If feedback were processed immediately and automatically, a single incorrect "accuracy" report could silently corrupt wiki content before anyone reviews it.

### 2.2 Skill Extraction → Gap-to-Action Pattern

**Hermes pattern**: After completing a complex task (≥5 tool calls, error recovery), the agent auto-generates a reusable "skill document" in structured markdown (agentskills.io standard): when to use, procedure, pitfalls, verification.

**NORIA adaptation**: From recurring `gap` feedback, the triage script extracts **knowledge gap patterns** — not skills, but actionable signals:

- If 2+ queries hit the same uncovered topic → recommend `/kb-sync` + `/kb-compile`
- If gaps align with existing Open Questions in concept pages → link them
- Future: if a gap involves a known citekey but the source page is too thin → recommend `/kb-deepen` (not yet implemented)

**Output format**: Recommendations in the triage report, not auto-executed actions. The human (or Claude under explicit instruction) decides what to act on.

### 2.3 Four-Layer Memory → NORIA Layer Mapping

Hermes uses a deliberate four-layer memory architecture, each with different persistence and cost characteristics:

| Hermes Layer | Purpose | NORIA Equivalent | Status |
|---|---|---|---|
| **Prompt Memory** (~2200 chars, always-on) | Frozen snapshot in system prompt | Claude Code auto-memory (`~/.claude/projects/.../memory/`) | Existing |
| **Session Search** (SQLite FTS5, on-demand) | Searchable history of past sessions | `outputs/queries/` feedback files + triage script | **New (this implementation)** |
| **Skills** (progressive disclosure) | Reusable procedures | `/kb-compile`, `/kb-deepen` etc. skill definitions in `.claude/commands/` | Existing |
| **External Providers** (optional plugins) | Enhanced semantic search | Codex MCP / GPT-5.4 nightmare review | Existing |

**Key insight**: NORIA's gap was Layer 2 — structured retrieval over historical Q&A. The feedback triage system fills this by making past queries searchable and classifiable.

### 2.4 Progressive Disclosure → Feedback Tiered Exposure

**Hermes pattern**: Skills load summaries by default; full content loads only when the agent needs to execute the skill. Token cost stays flat regardless of skill library size.

**NORIA adaptation**: The triage report uses tiered exposure:

1. **Summary table** (always shown): count by kind, date range
2. **Recommendations** (always shown): actionable one-liners (HIGH/LINK/AUDIT/SYNTHESIS)
3. **Theme clusters** (shown per kind): grouped gap themes, accuracy targets, insight candidates
4. **Full entries** (appendix): detailed table of all feedback files

This means a human reviewer can triage 50 feedback items by reading 10 lines of recommendations, not 50 full documents.

**Isolation guarantee**: `wiki/index.md` never indexes feedback files. The MCP server's `search` tool only searches `wiki/`, not `outputs/`. Feedback stays quarantined until explicitly promoted.

### 2.5 Patch-Style Skill Updates → Incremental Concept Updates

**Hermes pattern**: When a skill improves during use, the agent patches only the changed section, not the entire file. This is token-efficient and avoids clobbering unrelated content.

**NORIA adaptation**: When feedback leads to wiki updates:

- **Append new sections** rather than rewriting existing ones
- **Preserve `user-verified` content** unconditionally (CLAUDE.md rule)
- **Add `## Contradictions`** when new evidence conflicts with existing claims
- **Update `updated:` frontmatter date** to track freshness

This is already governance in CLAUDE.md but the Hermes analogy reinforces why: incremental updates maintain provenance chain integrity. A full rewrite loses the audit trail of which claims came from which sources.

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                Remote Research Machine                   │
│  Claude Code / Codex queries NORIA via MCP              │
│                                                         │
│  search("topic") → wiki results                        │
│  submit_feedback(gap, ...) → append to outputs/queries/ │
└──────────────┬──────────────────────────────────────────┘
               │ MCP connection (SSH tunnel or localhost)
┌──────────────▼──────────────────────────────────────────┐
│                    NORIA Host                           │
│                                                         │
│  noria-mcp-server.py                                    │
│  ├── search   → reads wiki/                             │
│  ├── get      → reads wiki/                             │
│  └── submit_feedback → writes outputs/queries/ ONLY     │
│                                                         │
│  kb-feedback-triage.ts (periodic)                       │
│  ├── scans outputs/queries/*.md                         │
│  ├── classifies: gap / accuracy / insight               │
│  ├── clusters themes, links to Open Questions           │
│  └── writes outputs/reviews/<date>-feedback-triage.md   │
│                                                         │
│  Human / Claude (manual)                                │
│  ├── reads triage report                                │
│  ├── decides which feedback to act on                   │
│  └── updates wiki/ from raw/ (provenance preserved)     │
└─────────────────────────────────────────────────────────┘
```

## 4. Feedback Schema

Each feedback file in `outputs/queries/` uses this frontmatter:

```yaml
---
title: "Remote feedback: <summary>"
type: query
provenance: query-derived
feedback_kind: gap | accuracy | insight
review_status: pending | triaged | accepted | rejected
answer_status: supported | partial | unsupported
wiki_pages: [concepts/ui-drift.md, sources/...]
citekeys: [citekey1, citekey2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### Feedback kinds

| Kind | Definition | Triage action |
|---|---|---|
| `gap` | Wiki lacks coverage for this query | Cluster → recommend /kb-sync + /kb-compile |
| `accuracy` | Wiki content may conflict with source | Flag for citation audit against raw/ |
| `insight` | New cross-paper connection discovered | Check ≥2 citekeys → candidate for /kb-reflect |

## 5. Governance Boundaries

These rules are non-negotiable, inherited from CLAUDE.md:

1. **`query-derived` never enters `wiki/`** — feedback is a signal, not a source
2. **All wiki modifications require human approval** — no auto-promotion
3. **Feedback files are append-only** — server cannot modify or delete existing files
4. **`outputs/queries/` is never indexed by search** — prevents circular contamination
5. **Accuracy disputes go through citation audit** — Claude verifies against `raw/`, not feedback text

## 6. What Hermes Does That We Deliberately Don't

| Hermes feature | Why we skip it |
|---|---|
| Agent-curated memory (agent decides what to persist) | Provenance model requires human curation — agent decisions are `query-derived` |
| Auto-skill improvement during execution | Wiki updates are gated by lint + human review, not real-time self-modification |
| Cross-session user model (USER.md) | Claude Code's auto-memory already handles this at the right level |
| External memory providers (Honcho, Mem0) | Adds infrastructure complexity; feedback files + triage is sufficient for current scale |
| RL-based trajectory training | NORIA is a knowledge base, not an agent training loop |

## 7. Implemented Extensions (from Hermes-Wiki deep analysis)

Based on deeper analysis of the [Hermes-Wiki](https://github.com/cclank/Hermes-Wiki) architecture documentation (31 pages, 4753+ lines of source-verified architecture docs):

### 7.1 Lint Hard Gate Hook (Hermes lifecycle hook pattern)

**Source pattern**: Hermes uses pre/post LLM call hooks and lifecycle hooks to inject guardrails. Plugins register hooks that execute before/after key operations.

**Implementation**: `tools/hooks/lint-gate.sh` registered as `UserPromptSubmit` hook in `settings.local.json`. When user types `/kb-reflect`, the hook auto-runs `kb-lint.ts --json` and blocks the prompt if any check fails.

This converts the "lint before reflect" rule from **documentary constraint** to **enforced gate** — the most requested fix across 3 GPT nightmare reviews.

### 7.2 MCP Server Index Cache (Hermes frozen snapshot pattern)

**Source pattern**: Hermes freezes MEMORY.md and USER.md as read-only snapshots at session start, injected into system prompt without mid-session modification. This enables prompt prefix caching (~75% token savings).

**Implementation**: `noria-mcp-server.py` pre-loads all wiki pages into `_wiki_cache` at startup via `_build_cache()`. The `search_wiki()` function now searches in-memory instead of `os.walk()` + `open()` per request. `get_doc()` checks cache first, falls back to filesystem for post-startup additions.

Trade-off: Cache is stale if wiki is modified while server runs. Acceptable because wiki updates are infrequent and server restarts are cheap.

## 8. Future Extensions (Not Yet Implemented)

### From initial Hermes analysis
- **FTS5 index over feedback**: If feedback volume grows, add SQLite full-text search for deduplication ("was this question asked before?"). Directly mirrors Hermes's Session Search layer.
- **Automated triage scheduling**: Wire `kb-feedback-triage.ts` to a cron job or Claude Code `/loop` for hands-off periodic triage.
- **Feedback-driven concept thickening**: Auto-generate `/kb-compile` batches for the most-gapped topics.
- **Cross-project feedback aggregation**: If multiple remote projects submit feedback, aggregate across projects for institution-level gap analysis.

### From Hermes-Wiki deep analysis
- **Context compression for kb-ask**: 4-phase algorithm (prune old results → determine boundaries → structured summary → assemble). Apply to `/kb-ask` when query needs 10+ pages — read frontmatter+Summary first, full text only on demand.
- **Tool auto-discovery**: Hermes uses 3-source discovery (built-in, user plugins, pip entry points). Could scan `tools/*.ts` for standard exports and auto-populate `/wiki-help --status` without manually maintaining CLAUDE.md tool list.
- **API key pool rotation**: Hermes rotates multiple API keys per provider with thread-safe least_used strategy. Could apply to Semantic Scholar API for higher throughput.
- **Credential pool pattern**: Multi-key S2 access if rate limits become a bottleneck.
