---
name: research-review
description: Get an external deep review of the wiki architecture, workflow, or research artifacts. Use when you want critical feedback from GPT with maximum reasoning depth.
argument-hint: [topic-or-scope]
allowed-tools: Bash(*), Read, Grep, Glob, Write, Edit
---

# Research Review

Use an external reviewer for critical feedback on this repository.

## Preferred Targets

- `ARCHITECTURE.md`
- `CLAUDE.md`
- `.claude/commands/`
- `tools/`
- `wiki/` and `.kb/` when reviewing knowledge quality

## Workflow

1. Gather the relevant project context for the requested scope.
2. Summarize core claims, current implementation state, known gaps, and open risks.
3. Prefer Codex MCP when available.
4. If Codex MCP is not available, fall back to `node tools/review/run_codex_exec.js <prompt-file>`.
5. Request concrete outputs from the reviewer:
   - severity-ranked findings
   - minimum safe fix
   - missing tests or evidence
   - whether the current state is coherent enough to proceed
6. Save the review to `outputs/reviews/` when the user wants an artifact.

## Rules

- Ask for brutally honest feedback, not general advice.
- Keep the scope explicit so the reviewer can verify claims.
- Prefer actionable criticism over brainstorming.
