# Research Tooling Strategy

This project is an independent NORIA knowledge service repo.

## Primary Rule

- `ARIS` defines research workflow semantics.
- `oh-my-claudecode` is optional runtime orchestration.
- `cc-switch` is configuration-layer support only.

## Tool Ownership

### ARIS

Use for:

- literature review
- critique loops
- command semantics
- research-oriented workflow policy

Never replace ARIS with OMC.

### oh-my-claudecode

Use for:

- Claude-led worker orchestration
- long-running `team` execution
- parallel Codex/Gemini worker dispatch
- autopilot only after the repo is stable

Do not let OMC define:

- provenance rules
- final `wiki/` write policy
- lint gates
- query-derived promotion rules

### cc-switch

Use for:

- MCP profiles
- prompt/provider presets
- multi-machine or multi-repo config sync

Do not use it for:

- auth ownership
- workflow ownership
- replacing repo-local semantics

## Adoption Rule

Enable OMC in this project only when:

- the baseline ARIS workflow works without it
- worker fan-out has become a real bottleneck
- rollback of hooks/state/runtime is documented

## Default Stack

- Control plane: `Claude Max`
- Reviewer/implementer: `Codex`
- Auxiliary analysis workers: `Gemini`
- Runtime orchestration: `oh-my-claudecode` when justified
- Config layer: repo-local `.llm/` files and optional `cc-switch`
