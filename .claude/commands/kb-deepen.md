---

name: kb-deepen
description: Read local PDF to deepen a wiki source page beyond abstract-level. Enriches summary, adds method details, key results, and upgrades citation locators from abstract to sec.X.
argument-hint: <citekey> [--batch <N>] [--list] [-- effort: lite|standard|extended|heavy|beast]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

> **Effort**: Default `extended`. See `shared/effort-contract.md` for all tiers.



# KB Deepen

Deepen wiki source pages by reading the original paper PDF from local Zotero storage.

> **IMPORTANT**: Never use the Read tool for PDF files — it requires poppler-utils which is not installed. Always use pdfplumber via Bash: `python3 -c "import pdfplumber; ..."`. This is the only reliable PDF extraction method in this environment.

## Constants

- **ZOTERO_DB**: `/path/to/zotero/zotero.sqlite`
- **ZOTERO_ATTACHMENT_BASE**: `/path/to/zotero/storage/`
- Zotero stores linked attachments with `attachments:` prefix in DB; replace with ZOTERO_ATTACHMENT_BASE to get full WSL2 path
- **MAX_PAGES_PER_READ**: 15 (skip References/Appendix to save tokens)
- **MAX_BATCH**: 5 (papers per invocation)

## Modes

### Single paper: `/kb-deepen <citekey>`
Deepen one specific source page.

### Batch mode: `/kb-deepen --batch N`
Deepen N papers, auto-selecting those with highest concept connectivity that are still abstract-only.

### List candidates: `/kb-deepen --list`
Show all source pages still at abstract-level depth, ranked by concept connections.

## Workflow

### Step 0: Identify candidates (for `--list` or `--batch`)

1. Scan `wiki/sources/*.md` for pages where ALL citations use `abstract` locator.
2. Cross-reference with `.kb/manifest.json` to skip pruned papers.
3. Rank by number of concept pages that cite this source (more connections = higher priority).
4. For `--list`: display ranked table and exit.
5. For `--batch N`: select top N candidates.

### Step 0.5: RT Relevance Pre-Screen (before reading any content)

Run `npx tsx tools/noria-reader.ts --brief <citekey>` to get RT relevance classification.

Based on the `rt` field in the output:
- **✅ CORE** → proceed to full deepen (Step 1 → Step 2 full path)
- **🔶 PARTIAL** → deepen lite: only read Introduction + Conclusion (Step 2 lite path, saves ~67% tokens)
- **❌ OFF-TOPIC** → do NOT deepen. Mark `rt_relevance: off-topic` in wiki frontmatter. Skip to next paper.
  Agent should report: "Skipping <citekey>: off-topic (<reason>)"

This pre-screen costs ~200 tokens and can save 12K+ tokens per off-topic paper.

### Step 1: Locate the PDF

For the target citekey:

1. Read `raw/zotero/papers/<citekey>.md` to get:
   - `title:` field (for filename matching)
   - `zotero_key:` field (for directory matching)
   - `authors:` field (for filename matching)
   - `year:` field

2. Search for the PDF in ZOTERO_STORAGE using multiple strategies:
   ```bash
   # Strategy A: Match by Zotero key subdirectory (standard Zotero layout)
   ls "$ZOTERO_STORAGE/<zotero_key>/"*.pdf

   # Strategy B: Match by author+year filename (flat layout)
   ls "$ZOTERO_STORAGE/" | grep -i "<first_author>.*<year>"

   # Strategy C: Match by title keywords
   ls "$ZOTERO_STORAGE/" | grep -i "<title_keywords>"
   ```

3. If no PDF found, try DeepXiv API fallback (for arXiv papers):
   ```bash
   # Check if paper has arxiv_id in raw/ frontmatter
   # If yes, use DeepXiv progressive reading:
   npx tsx tools/deepxiv-reader.ts --head <arxiv_id>    # Get ACTUAL section names + token counts
   # Read the section names from --head output, then request each by EXACT name:
   # DO NOT hardcode "Method"/"Experiments" — papers use varied names like
   # "Approach", "Experimental Setup", "Results and Discussion", etc.
   npx tsx tools/deepxiv-reader.ts --section <arxiv_id> "<exact-section-name-from-head>"
   # Typically read: the intro section, the method/approach section, experiments/results, conclusion
   # Then continue from Step 3 (Update the source page) as normal
   ```
   If DeepXiv also unavailable (no arxiv_id, or rate limited), report:
   ```
   PDF not found locally for <citekey>. DeepXiv unavailable.
   Consider downloading to Zotero first, then re-run /kb-deepen.
   ```
   Skip this paper and continue to next (in batch mode).

### Step 2: Read the PDF (selective)

Read the PDF via pdfplumber (as stated in the IMPORTANT note above — never use the Read tool for PDFs). Read strategically:

1. **Pages 1-3**: Title, Abstract, Introduction (always read)
2. **Pages 4-8**: Method/Approach section (always read)
3. **Pages 8-12**: Experiments/Results (read first 3-4 pages)
4. **Last 1-2 pages before References**: Conclusion/Discussion
5. **SKIP**: References, Appendix, Supplementary Material

If the paper is > 15 pages, use the `pages` parameter: `pages: "1-12"` then `pages: "N-M"` for conclusion.

### Step 3: Update the source page

Read existing `wiki/sources/<citekey>.md`. Then update:

1. **Preserve existing content** — do not delete anything.
2. **Enrich Summary**: Expand from 2-3 sentences to a comprehensive paragraph.
3. **Add/expand sections**:
   - `## Method` — Describe the approach with concrete details (architecture, training, key design choices)
   - `## Key Results` — Specific numbers, benchmarks, comparisons
   - `## Limitations` — Acknowledged limitations from the paper
4. **Upgrade citation locators**: Replace `[source: citekey, abstract]` with specific `[source: citekey, sec.X]` where the information actually appears.
   - Only use `sec.X` if you actually read that section from the PDF
   - Keep `abstract` for claims that are only verifiable from the abstract
5. **Update frontmatter**: Set `updated:` to today's date.
6. **Extract domain-specific comparison fields** (see `schema.md` § Domain-specific comparison fields):
   Based on the paper's method/results sections, populate applicable fields in frontmatter:
   - `drift_type`: what environment change is addressed? (ui-drift / workflow-drift / concept-drift / data-drift / none)
   - `adaptation_mode`: how does the agent adapt? (rl / sft / gradient-free / prompt-only / hybrid / none)
   - `benchmark_type`: evaluation type? (interactive-env / static-dataset / live-web / simulation / none)
   - `recovery_metric`: primary success metric? (success-rate / task-completion / step-accuracy / reward / other)
   - `safety_scope`: safety dimension? (adversarial / alignment / robustness / privacy / none)
   - `memory_form`: experience storage? (parametric / episodic / external-kb / hybrid / none)
   Only add fields that are clearly applicable — omit inapplicable ones. Do NOT guess.
7. **Venue verification**: If `venue_tier` is `top-conf` or `top-journal` and `venue_verified` is missing or `false`, run `npx tsx tools/venue-verify.ts <citekey>` to verify the venue claim. Update `venue_verified` and `venue_verification_source` in frontmatter. If the paper's actual venue differs from the claimed venue (e.g., S2/DBLP report a different conference), **fix the venue field** and flag the correction in the log.

### Step 4: Update related concept pages

1. Read `wiki/sources/<citekey>.md` to find which concept pages reference this source (from `sources:` in concept frontmatter, or wikilinks).
2. For each related concept page:
   - Read the existing page
   - If the paper's deeper content adds meaningful new information to the concept, append it with proper `[source: citekey, sec.X]` citations
   - Do NOT rewrite existing content — only add new details
   - Preserve `user-verified` sections untouched

### Step 5: Verify

```bash
npx tsx tools/kb-lint.ts
```

Must remain 7/7 PASS. If any check fails, fix before proceeding to next paper.

### Step 6: Log

**MUST** append to `log.md` (required — log.md is the wiki's activity dashboard visible in Obsidian):
```
[YYYY-MM-DD HH:MM] [DEEPEN] <citekey>: enriched source page from PDF (+X lines, Y citations upgraded)
```

## Key Rules

- **NEVER fabricate section numbers.** Only use `sec.X` for content you actually read from the PDF.
- **NEVER modify raw/ files.** Source pages live in wiki/sources/, raw/ is read-only.
- **Preserve existing content.** Deepen = add, not replace.
- **Respect provenance.** Deepened pages remain `source-derived` (same raw source, more detail).
- **Control token cost.** Read selectively (intro + method + results + conclusion), skip references and appendices.
- **One paper at a time in single mode.** Use `--batch` for multiple, capped at MAX_BATCH.
- If a concept page has `user-verified` provenance, do NOT modify it.
