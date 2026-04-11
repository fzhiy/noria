---
name: kb-lint
description: Deterministic 7-check health gate on wiki/. Must pass before any /kb-reflect. Checks frontmatter, wikilinks, citations, orphans, provenance, outputs quarantine, duplicates.
argument-hint: [optional: --fix | --json | --semantic]
allowed-tools: Bash(*), Read, Grep, Glob
---

# KB Lint: Wiki Health Check

Run deterministic checks on wiki/ content. This MUST pass before any `/kb-reflect` synthesis.

## Context: $ARGUMENTS

## How to Run

```bash
npx tsx tools/kb-lint.ts              # Core 7 checks
npx tsx tools/kb-lint.ts --semantic   # + 5 semantic review checks
npx tsx tools/kb-lint.ts --json       # Structured JSON output
npx tsx tools/kb-lint.ts --fix        # Auto-fix safe citation issues
```

## Core Checks (7)

| # | Check | What It Does |
|---|---|---|
| 1 | Frontmatter Validation | Every wiki page has required fields (title, type, provenance, sources, tags, created, updated). Provenance must be source-derived/llm-derived/user-verified. index.md needs title+type. |
| 2 | Wikilink Resolution | All `[[wikilinks]]` in wiki/ resolve to existing pages in sources/concepts/synthesis/ |
| 3 | Citation Validation | All `[source: citekey, location]` have valid citekeys (matching source pages) and standard locators (abstract/title/webpage/sec.X) |
| 4 | Orphan Detection | Every page in sources/ and concepts/ is linked from index.md |
| 5 | Provenance Rules | llm-derived pages have >=2 sources, source-derived have >=1 |
| 6 | Outputs Quarantine | No wiki/ page (including index.md) references outputs/. No query-derived provenance smuggled in body text. |
| 7 | Duplicate Detection | No concept pages share the same normalized title |

## Semantic Checks (--semantic flag, 5 additional)

| Check | What It Does |
|---|---|
| Thin Concepts | Flags concept pages with <3 bold bullet points |
| Low Citation Density | Flags pages where >50% of paragraphs lack citations |
| Single-Source Concepts | Flags llm-derived concepts with only 1 source |
| Fuzzy Near-Duplicates | Finds concept pairs with >0.7 title similarity ratio |
| Staleness Detection | Flags concept/synthesis pages not updated in 30+ days |

## Auto-fix (--fix flag)

Only fixes unambiguous citation issues:
- Adds `title` locator to citations missing a location: `[source: key]` → `[source: key, title]`
- Does NOT auto-fix broken wikilinks, orphans, or provenance issues

## Output

- Text mode: `=== Check Name ===` sections with PASS/FAIL/WARN/REVIEW per item, summary at end
- JSON mode: Structured object with checks, summary counts, severity levels
- Exit code: 0 = all checks pass, 1 = any FAIL found

## Key Rules

- This is a **deterministic** check — no LLM judgment.
- MUST pass 7/7 before running `/kb-reflect`.
- `query-derived` provenance is rejected in all wiki/ pages.
- Results go to stdout, not to files.
