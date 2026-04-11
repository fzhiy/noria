---
name: kb-compile
description: Compile unprocessed raw/ files into wiki/sources/ and wiki/concepts/. Updates index.md. Core knowledge pipeline.
argument-hint: [optional: specific file in raw/ to compile]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# KB Compile: raw/ → wiki/

Process uncompiled files from `raw/` into wiki pages with proper provenance.

## Context: $ARGUMENTS

## Prerequisites
- Read `schema.md` for wiki page format, provenance model, and citation rules.
- Read `CLAUDE.md` for forbidden operations and ownership boundaries.
- Read `.kb/manifest.json` for current compilation state.

## Workflow

### Step 1: Identify Uncompiled Files

Read `.kb/manifest.json`. Scan `raw/` recursively for all `.md` and `.json` files. Any file NOT listed in manifest, or listed with a status other than `"compiled"` or `"pruned"`, is a candidate.

> Files with `"status": "pruned"` are intentionally excluded from compilation. Do not recompile them unless `--force` is explicitly used.

If `$ARGUMENTS` specifies a file, only compile that file.

### Step 2: For Each Uncompiled File

**A. Read the raw file completely.**

**B. Create source page** at `wiki/sources/<slug>.md`:
- `type: source`
- `provenance: source-derived`
- Include: summary, key points with assertion-level citations `[source: citekey, location]`, metadata
- Slug format: `<firstauthor><year>-<keyword>` for papers, descriptive slug for notes/web
- If the raw file has `collections: [Name1, Name2]` in frontmatter, add `collection:kebab-name` tags to the source page's `tags:` field (e.g., `collections: [LLM Safety]` → `tags: [collection:llm-safety]`).
- **Bibliographic metadata**: Extract from the raw file frontmatter and include in wiki source page frontmatter:
  - `authors:` — author list from raw file
  - `year:` — publication year
  - `venue:` — conference/journal name (if available)
  - `venue_tier:` — classify as `top-conf` / `top-journal` / `workshop` / `arxiv-preprint`
  - `doi:` — DOI if available
  - `citation_count:` — from S2 raw files (if available)
  - `institution:` — primary author affiliations (extract from paper if identifiable)
  - `github_url:` — official code repo (if mentioned in abstract or known)
  - `code_available:` — true/false/unknown
  - `venue_verified:` — run `npx tsx tools/venue-verify.ts <citekey> --dry-run` for `top-conf`/`top-journal` papers. If S2/DBLP confirm the venue, set `true`. If unverified, set `false` and note the manual check URL in the commit message.
  - `venue_verification_source:` — `s2` / `dblp` / `manual` / `auto-unverified`

**C. Identify and update concept pages:**
- Extract 3-7 key concepts from the source.
- For each concept:
  - Check if `wiki/concepts/<concept-slug>.md` exists.
  - If YES: read existing page, append new information with source citation. Preserve existing content. If contradictions found, add a `## Contradictions` section.
  - If NO: create new page with `type: concept`, `provenance: llm-derived`, citing this source.
  - When creating or updating concept pages, consider adding an `## Open Questions` section listing 1-3 unresolved questions from the literature. These are consumed by external tools like `/idea-creator` for research gap discovery. Only add when the source material reveals genuine open problems.
- Use `[[wikilinks]]` to cross-reference between pages.

**D. Update `wiki/index.md`:**
- Add entry under `## Sources`: `- [[Source Slug]] — one-line summary`
- Add/update entries under `## Concepts` for new or updated concepts.
- Replace placeholder text (`_No sources compiled yet._` etc.) on first compile.

**E. Update `.kb/manifest.json`:**
```json
{
  "files": {
    "raw/zotero/papers/example.md": {
      "status": "compiled",
      "compiled_at": "2026-04-06T12:00:00Z",
      "source_page": "wiki/sources/example.md",
      "concepts_touched": ["concept-a", "concept-b"]
    }
  }
}
```

### Step 3: Log and Commit

**MUST** append to `log.md` (this is required, not optional — log.md is the wiki's activity dashboard for humans in Obsidian):
```
[2026-04-06 12:00] [COMPILE] <source-slug>: +1 source, +N concepts (new: X, updated: Y)
```

Git commit with message: `compile: <source-slug> (+1 source, +N concepts)`

## Key Rules

- ALWAYS read CLAUDE.md before starting.
- EVERY claim in a source page must cite `[source: citekey, location]`.
- NEVER create wiki pages without provenance frontmatter.
- NEVER modify files in `raw/`.
- If a concept page already exists, READ it first before appending.
- Flag contradictions explicitly — do not silently resolve them.
- Keep source pages factual. Save interpretation for concept pages.
- When compiling >10 papers in one session, process in batches of 5-10. Run `/kb-lint` between batches. This controls context window usage and catches issues early.
