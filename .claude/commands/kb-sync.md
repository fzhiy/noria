---
name: kb-sync
description: Sync Zotero, arXiv, and other raw literature into raw/. Use when refreshing the source layer.
argument-hint: [optional: arxiv "<query>" --limit N | --offline <export.json> | --status | --collection <name> | --list-collections | --tag-collection <name>]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# KB Sync

Sync the raw source layer for the knowledge base.

## Sources

### Zotero (default)

1. Read `CLAUDE.md` and `.kb/manifest.json` before changing anything.
2. If the user passes `--list-collections`, run `python tools/zotero_sync.py --list-collections`.
3. If the user passes `--collection <name>`, run `python tools/zotero_sync.py --collection "<name>"` (online, single collection).
4. Prefer the online sync path by running `python tools/zotero_sync.py` (full library if no collection specified).
5. If the user requests offline mode or Zotero is unavailable, run `python tools/zotero_sync.py --offline <export.json>`. Optionally with `--tag-collection "<name>"` to associate imported items with a collection.
6. If the user passes `--status`, run `python tools/zotero_sync.py --status`.

### arXiv

Search arXiv for papers and import them into `raw/arxiv/`. Invoke when the first argument is `arxiv`:

```
/kb-sync arxiv "web agent continual learning" --limit 10
/kb-sync arxiv "LLM agent benchmark" --limit 5 --category cs.AI
/kb-sync arxiv "your search query" --since 2025-01-01
/kb-sync arxiv --dry-run "self-evolving agent"
```

Maps to the underlying tool:
```bash
npx tsx tools/arxiv-search.ts --query "<query>" [--limit N] [--category <cat>] [--since YYYY-MM-DD] [--dry-run]
```

- Files are saved to `raw/arxiv/<citekey>.md` with `source_type: arxiv` frontmatter.
- Deduplicates against both `raw/arxiv/` and `raw/zotero/papers/` by citekey and arxiv_id.
- Use `--dry-run` to preview results without saving.
- Use `--since` to filter to papers published after a date.
- Use `--category` to restrict to an arXiv category (e.g., `cs.AI`, `cs.CL`, `cs.LG`).

### Semantic Scholar

Search published venue papers (IEEE, ACM, Springer, etc.) and import them into `raw/semantic-scholar/`. Invoke when the first argument is `semantic-scholar` or `s2`:

```
/kb-sync semantic-scholar "web agent continual learning" --limit 10
/kb-sync s2 "LLM agent benchmark" --year 2024- --min-citations 10
/kb-sync s2 "example query" --type conference
/kb-sync s2 --paper "DOI:10.1109/..."
/kb-sync s2 --related "ARXIV:2401.12345" --limit 5
/kb-sync s2 --citations "ARXIV:2401.12345" --limit 10
/kb-sync s2 --dry-run "self-evolving agent"
```

Maps to the underlying tool:
```bash
npx tsx tools/semantic-scholar-search.ts --query "<query>" [--limit N] [--year RANGE] [--min-citations N] [--type TYPE] [--fields FIELDS] [--dry-run]
npx tsx tools/semantic-scholar-search.ts --paper "<ID>"
npx tsx tools/semantic-scholar-search.ts --related "<ID>" [--limit N]
npx tsx tools/semantic-scholar-search.ts --citations "<ID>" [--limit N]
```

- Files are saved to `raw/semantic-scholar/<citekey>.md` with `source_type: semantic-scholar` frontmatter.
- Includes venue metadata, citation counts, DOI, TLDR, and open-access PDF links.
- Deduplicates against `raw/semantic-scholar/`, `raw/arxiv/`, and `raw/zotero/papers/` by citekey, DOI, arXiv ID, and S2 paper ID.
- Use `--dry-run` to preview results without saving.
- Use `--year` to filter by year range (e.g., `2024-`, `2020-2024`).
- Use `--min-citations` to filter by minimum citation count.
- Use `--type` to restrict publication type (`JournalArticle`, `Conference`, `Review`, `all`).
- Use `--fields` to change field-of-study filter (default `Computer Science`, use `all` to remove).
- Set `SEMANTIC_SCHOLAR_API_KEY` env var for higher rate limits (free at https://www.semanticscholar.org/product/api#api-key-form).
- `--related` and `--citations` modes discover cross-domain connections between papers.

## General Rules

1. Do not edit files in `raw/` manually if the sync tool can produce them.
2. Do not touch `wiki/` in this command. Compilation happens in `/kb-compile`.

## Notes

- The Zotero sync tool writes its own state to `.kb/sync_state.json`.
- New raw files should be left for compilation, not pre-summarized here.
- **Collections are metadata, not directories.** All Zotero raw files stay flat in `raw/zotero/papers/`. Collection membership is stored in the `collections:` frontmatter field of each raw file.
- A paper can belong to multiple collections. Re-syncing a different collection that contains an already-synced paper will update its `collections:` field without rewriting the file.
- `--collection` is online-only; `--tag-collection` is offline-only. They cannot be combined.
- arXiv files live in `raw/arxiv/` (separate from Zotero) but follow the same citekey convention and are compatible with `/kb-compile`.
