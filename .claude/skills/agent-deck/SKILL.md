---
name: agent-deck
description: Coordinate multiple AI coding sessions and parallel sub-tasks. Use when splitting work, forking conversations, or managing a multi-agent workflow.
---

# Agent Deck

Use this skill when a task can be split into independent work items and tracked as a deck instead of a single monolithic pass.

## Repo Setup

- Repo-local binary: `.codex-tools/bin/agent-deck`
- The bundled binary is a Linux/WSL build and will not run directly from native Windows PowerShell.
- The upstream project also provides a Claude Code plugin and skill install path.
- This repository uses the skill as a local coordination layer for wiki maintenance, compile/lint loops, and other multi-file changes.

## Upstream Install

- Add the marketplace: `/plugin marketplace add asheshgoplani/agent-deck`
- Install the skill/plugin: `/plugin install agent-deck@agent-deck-help`
- If you prefer a manual skill install, the upstream repo publishes `skills/agent-deck/SKILL.md` plus reference files under `skills/agent-deck/references/`

## When To Use

- A change can be broken into disjoint file slices.
- You need to coordinate parallel agent work without overlapping ownership.
- You want to keep one task card per scope and integrate results intentionally.

## Operating Rules

- Assign each sub-task a single owner and a disjoint write set.
- Keep one deck item focused on one deliverable.
- Do not let agents overwrite each other; adapt to existing edits instead.
- Summarize findings before merging them back into the main line of work.

## Repo Defaults

- Prefer this skill for bulk wiki compilation, lint fixes, and workflow setup work.
- Treat `raw/` as read-only and `wiki/` as the writable knowledge layer.
- Use `CLAUDE.md` as the authority for provenance and forbidden operations.
