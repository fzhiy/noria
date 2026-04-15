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

## Dual-Model Workflow (Optional)

NORIA supports a dual-model workflow where one model (e.g., Claude) acts as orchestrator and another (e.g., GPT) acts as adversarial reviewer. See `/gpt-nightmare-review` for the review command.

### Quality Gates

1. **kb-lint 7/7 PASS** required before any kb-reflect
2. **Adversarial review** recommended before merge to main
3. **No CRITICAL findings** allowed in final review before merge
