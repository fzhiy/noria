## Tooling Policy

- `ARIS` is the research workflow layer for this repo.
- `oh-my-claudecode` is optional runtime orchestration and must not redefine knowledge-base semantics.
- `cc-switch` is config-only and must not manage auth or repo workflow ownership.
- `Claude Max` is the default control plane.
- `Codex` is a secondary reviewer and implementer.
- `Gemini` is an auxiliary comparison and triage worker.
- Final writes into `wiki/` remain Claude-led.
- `kb-lint` stays mandatory before `kb-reflect`.
- `query-derived` artifacts never feed back into `wiki/`.
- If `oh-my-claudecode` is disabled, the repo must still function normally.
