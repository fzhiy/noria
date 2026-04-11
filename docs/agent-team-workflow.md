# Agent Team Workflow

This project supports a Claude-led agent team while staying compatible with `ARIS`.

## Core Model

- `Claude Max` is the orchestrator.
- `Codex` is the reviewer and implementer.
- `Gemini` is the comparison and triage worker.
- `oh-my-claudecode` may orchestrate runtime execution.

## Mandatory Boundaries

- Final writes to `wiki/` stay in the Claude-led flow.
- `kb-lint` remains mandatory before `kb-reflect`.
- Worker output goes to `outputs/` or temporary artifacts first.
- `query-derived` content never feeds `wiki/`.

## OMC Rollout Stages

### Stage 0

No OMC.

Run:

- `kb-sync`
- `kb-compile`
- `kb-lint`
- `kb-reflect`
- `research-review`

### Stage 1

OMC for review and compare only.

Allowed OMC lanes:

- `review`
- `compare`
- `tooling`

### Stage 2

OMC for compile preparation.

Allowed OMC output:

- concept candidates
- comparison checklists
- structured pre-write notes

Not allowed:

- direct final writes into `wiki/`

### Stage 3

Optional autopilot for long-running batches after metrics prove value.

## Team Rules

- If OMC is disabled, the repo must still operate correctly.
- If OMC is enabled, ARIS command semantics must remain unchanged.
- If OMC conflicts with repo hooks, OMC loses and must be limited or removed.

---

## NORIA Dual-Model Workflow (Claude Opus 4.6 + GPT-5.4 xhigh)

> Established: 2026-04-08. Active configuration for NORIA development and maintenance.

### Role Assignment

| Role | Model | Access Method | Strengths |
|---|---|---|---|
| **Orchestrator** | Claude Opus 4.6 (1M) | Claude Code CLI | Long-form writing, PDF reading, synthesis, wiki compilation, project leadership |
| **Adversarial Reviewer** | GPT-5.4 xhigh | Codex MCP / codex exec | Independent filesystem verification, hostile testing, code review, architecture audit |

### Workflow Patterns

#### Pattern A: Compile-Review Cycle (standard)

```
1. Claude: kb-compile / kb-deepen / kb-reflect → writes wiki/
2. Claude: commit changes
3. GPT: /gpt-nightmare-review → independent verification
   - Reads actual files (not Claude's summary)
   - Checks citation consistency, provenance, metadata
   - Produces severity-ranked findings
4. Claude: fixes findings → commit
5. Repeat if CRITICAL/HIGH findings remain
```

#### Pattern B: Parallel Analysis

```
Claude: literature research + source page writing
GPT (Codex MCP): independent architecture/classification evaluation
→ Claude merges both analyses
```

#### Pattern C: Tool Development-Verification

```
Claude: writes/modifies tools/ code
GPT (codex exec): independently runs code + validates correctness
→ Claude fixes issues found
```

### Trigger Rules

| Event | Action | Model |
|---|---|---|
| After every `kb-reflect` | Nightmare review on synthesis quality | GPT |
| After batch deepen (5+ papers) | Spot-check sec.X citation consistency | GPT |
| Before architecture changes | Independent feasibility assessment | GPT |
| New session start | Read previous review findings, prioritize unresolved | Claude |
| Before merge to main | Full KB nightmare review | GPT |

### Quality Gates

1. **kb-lint 7/7 PASS** required before any kb-reflect (enforced via UserPromptSubmit hook)
2. **GPT nightmare review** required before merge to main
3. **No CRITICAL findings** allowed in final review before merge
4. **HIGH findings** must have documented justification if not fixed

### Escalation to Three-Model Team (Future)

When GCP $300 trial is utilized:
- **Gemini 2.5 Pro** (1M context): full-wiki global consistency check, Google Search grounding for venue/code verification
- Trigger: after dual-model workflow stabilizes and if Gemini finds issues Claude+GPT missed
- Integration: Vertex AI batch API, not interactive agent

### Communication Protocol

- Claude → GPT: via Codex MCP `prompt` parameter or codex exec prompt files
- GPT → Claude: via review result files in `outputs/reviews/`
- Both models: append to `log.md` for audit trail
- Neither model: directly modifies the other's artifacts without going through the review cycle
