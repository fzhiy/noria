---
name: agent-team-plan
description: Render a repo-local batch plan for Claude, Codex, and Gemini by project and goal.
argument-hint: <project-id> <goal>
allowed-tools: Bash(python3 tools/llm_tooling/agent_team.py *), Read, Grep, Glob
---

# Agent Team Plan

Generate the working plan for a batch using the repo-local agent-team manifest.

## Workflow

1. Read `AGENT_TEAM_WORKFLOW.md` if needed.
2. Run `python3 tools/llm_tooling/agent_team.py list-projects` when the project id is unknown.
3. Run `python3 tools/llm_tooling/agent_team.py plan-batch --project <project-id> --goal <goal>`.
4. Use the generated plan as the routing baseline for Claude/Codex/Gemini cooperation.
