# noria-agent Starter

This template bootstraps an independent research knowledge-base repo that uses:

- `ARIS` as the research workflow layer
- `Claude Max` as the control plane
- `oh-my-claudecode` as an optional runtime for multi-worker orchestration
- `Codex` and `Gemini` as specialist workers

## Design Rule

Use:

- `ARIS-first`
- `OMC runtime second`

Do not use:

- `OMC-first`
- direct worker writes into `wiki/`
- auth ownership by config tooling
