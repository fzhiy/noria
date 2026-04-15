---
name: noria
description: Show NORIA knowledge service tools and workflow. Use when you need literature knowledge for your research.
allowed-tools: ""
---

# NORIA Knowledge Service

A provenance-tracked academic knowledge base covering **continual adaptation of web agents under UI drifts and workflow drifts**. 116 source pages, 32 concepts, 5 syntheses, 1400+ citations.

## Local Mirror (preferred)

`noria/` is a read-only copy of the wiki, auto-synced after each NORIA commit. **Prefer local reads over MCP** — faster and cheaper.

```
noria/index.md          # Start here: topic routing
noria/sources/*.md      # 116 paper pages with [source: citekey, sec.X] citations
noria/concepts/*.md     # 32 cross-paper concept pages
noria/synthesis/*.md    # 5 thematic synthesis articles
```

**Quick start with local files:**
```
Read noria/index.md                    # Browse topics
Grep "ui drift" noria/sources/         # Find relevant papers
Read noria/concepts/ui-drift.md        # Understand a concept
```

## MCP Tools (for feedback + advanced queries)

| Tool | When to use |
|---|---|
| `mcp__noria__topic` | Structured topic overview (concepts + sources + open questions) |
| `mcp__noria__submit_feedback` | Report gaps, errors, or cross-paper insights |
| `mcp__noria__ask` | Fallback QA when local search isn't enough |
| `mcp__noria__help` | Full usage guide |

## Feedback Types

- **gap** — wiki lacks coverage → drives new paper discovery
- **accuracy** — wiki content may conflict with your findings → triggers citation audit
- **insight** — you found a cross-paper connection → synthesis candidate

## Provenance Warning

All NORIA content is `query-derived` when used here. Verify against primary sources before citing in publications. Never modify `noria/` directly — it is overwritten by rsync.
