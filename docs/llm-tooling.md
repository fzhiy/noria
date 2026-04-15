# LLM Tooling

This repo treats MCP and cross-tooling assets as a separate config layer from account auth.

## What It Manages

- Canonical MCP manifest: `.llm/tooling.json`
- Canonical agent-team manifest: `.llm/agent-team.json`
- Claude project MCP config: `.mcp.json`
- Optional shared assets:
  - Claude global commands: `.llm/shared/claude-commands/`
  - Codex global skills: `.llm/shared/codex-skills/`

## What It Does Not Touch

- `~/.codex/auth.json`
- `~/.claude/.credentials.json`
- ChatGPT Plus / Claude Max login flows
- Existing repo-local `.claude/commands/`
- Existing Claude hooks or status-line settings unless you intentionally wire them in

## Commands

Inspect the repo-local multi-model team:

```bash
python3 tools/llm_tooling/agent_team.py doctor
```

Copy the `noria` starter into a new repo:

```bash
python3 tools/llm_tooling/scaffold_llm_wiki_agent.py /path/to/new-repo
```

## Notes

- `.mcp.json` is the Claude Code project-scope MCP file. It keeps project MCP separate from Claude's user settings and OAuth state.
- The agent-team manifest is intentionally lightweight. It defines routing, roles, and project mappings without introducing another runtime harness.
- The `templates/noria/` starter is for new independent repos that want `ARIS-first` semantics with optional `oh-my-claudecode` runtime orchestration.
