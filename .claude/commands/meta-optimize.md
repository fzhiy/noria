---
name: meta-optimize
description: Analyze ARIS usage logs and propose repo-local workflow improvements. Use when optimizing the harness itself from accumulated usage data.
argument-hint: [target-skill-or-all]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# Meta-Optimize

Analyze `.aris/meta/events.jsonl` and improve the workflow around this repository.

## Scope

- Optimize the harness, not the wiki artifacts.
- Valid targets include `.claude/commands/`, `.claude/skills/`, `tools/meta_opt/`, and workflow defaults in docs.
- Do not optimize `raw/`, `wiki/`, or generated outputs unless the user explicitly asks.

## Prerequisites

1. Read `CLAUDE.md`, `tools/meta_opt/check_ready.sh`, `tools/meta_opt/log_event.sh`, and `.aris/meta/events.jsonl`.
2. Run `node tools/meta_opt/analyze_events.js .aris/meta/events.jsonl`.
3. If fewer than 5 `skill_invoke` events exist, stop and report that there is not enough signal yet.

## Workflow

1. Build a summary table from the event log:
   - most-used skills and slash commands
   - repeated tool failures
   - common manual follow-ups or interruptions
   - readiness since the last `.aris/meta/.last_optimize`
2. Rank optimization opportunities by evidence strength.
3. For each proposed change, generate a minimal patch and explain the signal that supports it.
4. Never auto-apply speculative changes. Only apply repo-local changes that are clearly supported by the log.
5. Before changing an existing command or skill, back it up to `.aris/meta/backups/`.
6. Append an optimization record to `.aris/meta/optimizations.jsonl` with timestamp, target, rationale, and changed files.
7. Update `.aris/meta/.last_optimize` only after the optimization pass is complete.

## Rules

- Log-driven, not speculative.
- Minimal patches only.
- Reversible changes only.
- Keep the report self-contained and cite the observed usage signal.
