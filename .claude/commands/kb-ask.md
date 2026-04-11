---
name: kb-ask
description: Answer questions from the wiki by routing through index.md and source pages. Use when retrieving knowledge from the KB.
argument-hint: [required: question]
allowed-tools: Read, Write, Edit, Grep, Glob
---

# KB Ask

Answer the user's question using the wiki as the source of truth.

## Workflow

1. Read `wiki/index.md` for coarse routing.
2. Select only the most relevant pages, then read them fully.
3. Answer with assertion-level citations in the form `[source: citekey, location]`.
4. Save the result to `outputs/queries/<timestamp>-<slug>.md`.
5. Mark the output as `query-derived`.
6. Do not update `wiki/` or `wiki/index.md`.

## Notes

- Prefer the smallest set of pages that can answer the question.
- If the wiki does not support the answer, say so clearly and do not fabricate citations.
