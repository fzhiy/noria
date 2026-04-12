---

name: kb-reflect
description: Generate synthesis articles from multiple source-derived pages after lint passes. Use when creating cross-cutting wiki synthesis.
argument-hint: [optional: --apply] [-- effort: lite|standard|extended|heavy|beast]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

> **Effort**: Default `heavy`. See `shared/effort-contract.md` for all tiers.



# KB Reflect

Create cross-cutting synthesis only after the wiki is healthy.

## Workflow

### Step 1: Lint gate
Run `/kb-lint` first and stop if it reports critical issues.

### Step 2: Synthesis decision (UPDATE vs CREATE)

Before writing ANY new synthesis, run this decision process:

1. Read ALL existing `## Thesis` sections from `wiki/synthesis/*.md`
2. For the candidate topic, identify the top 3 existing thesis matches
3. Print the decision table:
   ```
   [kb-reflect] Synthesis Decision for: <candidate topic>
     Match 1: continual-adaptation-web-agents (thesis overlap: high) → recommend UPDATE
     Match 2: self-evolving-agent-architectures (thesis overlap: low) → no match
     Match 3: (none)
   Decision: UPDATE continual-adaptation-web-agents
   ```
4. **Default action is UPDATE** when an existing thesis covers the insight
5. Only CREATE if no existing thesis covers it — state the justification
6. For UPDATE: add new sources, strengthen argument, update `last_reviewed:` and append to `decision_history:`

### Step 3: Write or update synthesis
- Read `wiki/index.md` and the relevant concept pages.
- Write or update the synthesis article with multiple source-derived citations.
- For new articles: include all required frontmatter (role, parent, scope, last_reviewed, decision_history).
- Update `wiki/index.md` with new or updated entry.
- Do not use `outputs/` content as a source for wiki updates.

6. **MUST** append to `log.md`:
```
[YYYY-MM-DD HH:MM] [REFLECT] <synthesis-slug>: synthesized N sources into <topic>. Citations: X→Y.
```

## Notes

- Keep synthesis in `wiki/synthesis/` only.
- If the user passes `--apply`, make the smallest safe edit set that resolves the synthesis request.
