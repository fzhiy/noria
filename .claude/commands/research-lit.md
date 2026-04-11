---
name: research-lit
description: Search and synthesize literature for this LLM wiki from local raw/wiki content and the web. Use when building related work, source coverage, or topic surveys.
argument-hint: [topic-or-paper-url]
allowed-tools: Bash(*), Read, Grep, Glob, Write, Edit
---

# Research Literature Review

Search the current knowledge base first, then fill gaps from external sources.

## Repo Sources

- `raw/zotero/papers/` for synced paper notes and metadata
- `raw/web/` for captured web sources
- `raw/notes/` for user notes
- `wiki/sources/`, `wiki/concepts/`, and `wiki/synthesis/` for processed knowledge
- `wiki/index.md` for coarse routing

## Workflow

1. Parse the topic from `$ARGUMENTS`.
2. Read `wiki/index.md` and search local repo sources before going to the web.
3. Prefer existing `raw/` and `wiki/` material when it already answers the question.
4. When the local KB is incomplete, search recent papers and primary sources on the web. If Semantic Scholar is available (via global `/semantic-scholar` skill or `tools/semantic-scholar-search.ts`), prefer it for published venue papers (IEEE, ACM, Springer) with citation counts and venue metadata.
5. Distinguish clearly between:
   - already in the KB
   - found externally but not yet ingested
   - still uncertain or conflicting
6. Output a structured literature table with paper, venue, method, key claim, relevance, and source origin.
7. Save review artifacts to `outputs/reviews/` only if the user asked for persistence.

## Rules

- Cite sources for every non-trivial claim.
- Prefer source pages over concept pages when checking fine-grained details.
- Never write external findings back into `wiki/` from this command alone.
