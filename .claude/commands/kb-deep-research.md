---
name: kb-deep-research
description: Orchestrate ChatGPT Pro Thinking deep research sessions for academic knowledge expansion. Routes tasks to Codex CLI (auto) or ChatGPT Web (manual) with auto-parsing.
argument-hint: <think|manual|parse|auto-loop> [--topic "..."] [--effort medium|high|xhigh] [--auto-sync]
allowed-tools: Bash(npx tsx tools/*), Read, Write, Edit, Grep, Glob
---

> **Effort**: Default `extended`. See `shared/effort-contract.md` for 5-tier scaling.


# KB Deep Research

Orchestrate ChatGPT Pro Thinking sessions for structured academic knowledge expansion.

## CLI Interface

```
npx tsx tools/chatgpt-research-agent.ts think --topic "..." [--effort medium|high|xhigh] [--auto-sync]
npx tsx tools/chatgpt-research-agent.ts manual --topic "..." [--model pro|thinking] [--level standard|extended]
npx tsx tools/chatgpt-research-agent.ts parse --input <file> [--auto-sync]
npx tsx tools/chatgpt-research-agent.ts auto-loop [--max-rounds 5] [--max-gaps 3]
```

## Execution Layers

| Layer | Method | When Used |
|---|---|---|
| L1 Codex CLI | `codex exec` via `runCodexExec()` | All effort levels (`think` mode and `auto-loop`) |
| L2 Playwright | private Playwright driver at `~/.local/noria-private/` (if available) | Auto-detected; used instead of codex CLI when present |
| L3 Manual | Generate prompt → paste into ChatGPT Web → save output → `parse` mode | `manual` mode, or when web search is needed |

## Effort Routing

| Effort | ChatGPT Web Level | Driver Level | Use For |
|---|---|---|---|
| `lite` | Standard (lite) | `--level standard` | Quick lookup, abstract confirmation |
| `standard` | Standard | `--level standard` | Paper summary, simple lookup |
| `extended` | Extended | `--level extended` | Gap analysis, claim verification |
| `heavy` | Heavy | `--level heavy` | Cross-domain synthesis, hypothesis |
| `beast` | Heavy (exhaustive) | `--level heavy` | Comprehensive survey, multi-round iteration |

Default: auto-selected from topic keywords (`standard`/`extended`/`heavy`). All effort levels use `model_reasoning_effort="xhigh"` (non-negotiable floor per effort contract). Legacy names (`medium`/`high`/`xhigh`) are accepted and mapped automatically.

## Modes

### `think` — Automated via Codex CLI

1. Select effort: auto-select unless `--effort` is provided.
2. Build prompt from RT config and topic.
3. Run: `npx tsx tools/chatgpt-research-agent.ts think --topic "<topic>" [--effort lite|standard|extended|heavy|beast]`
4. Save output to `outputs/research/chatgpt-sessions/<date>-<slug>.md`.
5. If `--auto-sync`: extract arXiv IDs, run `/kb-sync`, then `/kb-compile`.

### `manual` — ChatGPT Web paste

1. Generate filled prompt and print to terminal.
2. User pastes into ChatGPT Pro web and retrieves result.
3. User saves response to a file.
4. Continue with `parse` mode.

### `parse` — Process saved result file

1. Read the result file specified by `--input <file>`.
2. Extract paper references (arXiv IDs, DOIs).
3. Save structured session to `outputs/research/chatgpt-sessions/<date>-<slug>.md`.
4. Print sync commands to stdout.

### `auto-loop` — Continuous gap closure

1. Run `kb-gap-scan --json` to get current gap list.
2. Filter: keep HIGH and MEDIUM severity gaps, plus any LOW gaps where `type === 'frontier'`.
3. Skip `depth` type gaps (handled by `/kb-deepen`).
4. For each eligible gap:
   - If web search keywords detected: save manual prompt session (L3).
   - Otherwise: run `think` mode via codex exec (L1/L2).
5. Save loop report to `outputs/research/auto-loop/<date>-report.md`.

## Storage Rules

- ALL output goes to `outputs/research/` — NEVER to `raw/`
- Filename: `<date>-<slug>.md`
- ChatGPT text is reference only — wiki claims must cite the actual papers
