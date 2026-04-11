# llm-wiki-agent Bootstrap

This repo now includes a reusable starter for a new independent project named `llm-wiki-agent`.

## Recommendation

You can use `oh-my-claudecode + ARIS` in `llm-wiki-agent`, but only with this ownership model:

- `ARIS` defines research semantics
- `oh-my-claudecode` provides runtime orchestration
- `Claude Max` stays the control plane
- `Codex` and `Gemini` stay specialist workers
- `cc-switch` remains config-only

## Starter Location

Use:

- `templates/llm-wiki-agent/`

Key files:

- `templates/llm-wiki-agent/README.md`
- `templates/llm-wiki-agent/RESEARCH_TOOLING.md`
- `templates/llm-wiki-agent/AGENT_TEAM_WORKFLOW.md`
- `templates/llm-wiki-agent/CLAUDE_APPENDIX.md`
- `templates/llm-wiki-agent/.llm/agent-team.json`

## Suggested Bootstrap Steps

1. Create a new repo for `llm-wiki-agent`.
2. Copy the public `llm-wiki` framework into it.
3. Copy `templates/llm-wiki-agent/` into the new repo root.
4. Merge `CLAUDE_APPENDIX.md` into the new repo's `CLAUDE.md`.
5. Replace placeholder project ids and collection names in `.llm/agent-team.json`.
6. Keep OMC off until the baseline `kb-*` flow is stable.
7. Enable OMC first for `review`, `compare`, and `tooling`.

## Why This Exists

The `bhra`-oriented working repo already has local hooks, HUD, `agent-deck`, and ARIS-specific runtime assumptions. A fresh `llm-wiki-agent` repo is the right place to define OMC ownership from the beginning instead of retrofitting it into an already busy runtime.
