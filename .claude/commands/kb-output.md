---
name: kb-output
description: Render wiki content as slides, reports, JSONL, or briefs. Output goes to outputs/.
argument-hint: <format> [--slug <page>] [--tag <filter>]
allowed-tools: Bash(npx tsx tools/kb-output.ts *), Read, Glob
---

# KB Output: Multi-Format Wiki Renderer

Render wiki knowledge in formats suitable for different consumers.

## Context: $ARGUMENTS

## Available Formats

| Format | Audience | Description |
|--------|----------|-------------|
| `jsonl` | LLM | One JSON object per page with extracted claims and links |
| `marp` | Human | Marp-compatible slide deck for a single page |
| `report` | Human | Structured markdown report filtered by tag |
| `markdown-brief` | LLM | Condensed overview for context stuffing |

## Usage

Parse `$ARGUMENTS` to determine the desired format and options, then run:

```bash
npx tsx tools/kb-output.ts --format <format> [--slug <page>] [--tag <filter>] --output <path>
```

### Examples

```bash
# Export all pages as JSONL for LLM ingestion
npx tsx tools/kb-output.ts --format jsonl --output outputs/wiki.jsonl

# Generate slides for a specific concept
npx tsx tools/kb-output.ts --format marp --slug web-agent --output outputs/slides/

# Report on all agent-tagged sources
npx tsx tools/kb-output.ts --format report --tag collection:agent --output outputs/reports/

# Condensed brief for context stuffing
npx tsx tools/kb-output.ts --format markdown-brief --output outputs/brief.md

# List available formats
npx tsx tools/kb-output.ts --list-formats
```

## Rules

- Output always goes to `outputs/` directory -- never to `wiki/`.
- The tool creates subdirectories as needed.
- For `marp`, `--slug` is required.
- For `report`, `--tag` is optional (defaults to all pages).
- Report the output path and record count to the user after completion.
