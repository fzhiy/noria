---
name: kb-reflect
description: Generate synthesis articles from multiple source-derived pages after lint passes. Use when creating cross-cutting wiki synthesis.
argument-hint: [optional: --apply]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# KB Reflect

Create cross-cutting synthesis only after the wiki is healthy.

## Workflow

1. Run `/kb-lint` first and stop if it reports critical issues.
2. Read `wiki/index.md` and the relevant concept pages.
3. Write a synthesis article only if the evidence supports it with multiple source-derived citations.
4. Update `wiki/index.md` with the new synthesis entry.
5. Do not use `outputs/` content as a source for wiki updates.

6. **MUST** append to `log.md`:
```
[YYYY-MM-DD HH:MM] [REFLECT] <synthesis-slug>: synthesized N sources into <topic>. Citations: X→Y.
```

## Notes

- Keep synthesis in `wiki/synthesis/` only.
- If the user passes `--apply`, make the smallest safe edit set that resolves the synthesis request.
