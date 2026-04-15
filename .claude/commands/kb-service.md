---
name: kb-service
description: Process external project service requests. Receives reviewed feedback, searches locally then externally, filters, gates ingestion through human approval, generates structured responses. NORIA-side skill.
argument-hint: [--request <request_id>] [--dry-run] [-- effort: lite|standard|extended]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob, mcp__codex__codex
---

# KB Service — Cross-Project Knowledge Service

Process service requests from external research projects submitted via MCP `submit_feedback`.

**Models**: Claude Opus 4.6 (orchestrator) + GPT-5.4 xhigh (nightmare review, host-side)
**Effort**: default `standard`. Review type determined by content, NOT by effort.

| Tier | External search limit | Bundle max_sources |
|------|----------------------|-------------------|
| lite | 3 | 5 |
| standard | 5 | 10 |
| extended | 10 | 15 |

## Workflow

### Step 1: Identify Pending Requests

Read `.kb/service-index.jsonl`. Group by `request_id`, take latest status per request.

Selectable requests:
- `status == "pending"` → start from Step 2
- `status == "claimed"` AND `new Date(lease_expires).getTime() < Date.now()` → expired claim, start from Step 2
- `status == "review_passed"` AND `new Date(lease_expires).getTime() < Date.now()` → expired post-review, **skip review, start from Step 3**
- All other states → skip

If `--request <id>` specified, process only that request.

Write a `claimed` record with `lease_owner` and `lease_expires` (1 hour from now).

### Step 2: NORIA Content Classification + Review

**Do NOT trust `severity_hint`** — classify based on content analysis.

#### Step 2a: Derive operation + risk (server-side, not client-supplied)

Read the feedback file. Determine the **requested knowledge operation**:

| Operation | Detection signals | Example |
|-----------|------------------|---------|
| `lookup` | Simple factual question, no feedback_kind or kind=gap with no synthesis refs | "What methods detect UI drift?" |
| `verify` | feedback_kind=accuracy, references specific claims | "wiki says X but our data shows Y" |
| `synthesize` | Requests cross-paper synthesis, comparative taxonomy, or new analytical framework; references ≥3 synthesis pages OR contains "synthesis"/"cross-paper"/"taxonomy"/"comparative" | "Need synthesis on live vs replay evaluation standards" |
| `update` | Requests expansion of existing synthesis with new evidence | "New paper Z should be incorporated into synthesis W" |
| `challenge` | feedback_kind=insight that challenges existing thesis; or proposes research direction change | "Core assumption W is wrong because..." |
| `promote` | feedback_kind=save; Q&A pair worth persisting as concept/source | "This answer should be in the wiki" |

Determine the **risk level**:
- `factual` — verify/correct specific claims against source material
- `strategic` — new synthesis, taxonomy, comparative framework, or corpus-boundary decisions
- `governance` — ceiling/hierarchy impact, direction change, cross-project architectural decision

Determine the **target level**:
- `source` — individual paper coverage
- `concept` — concept page update
- `synthesis` — synthesis creation/update
- `corpus` — cross-cutting policy/architecture

#### Step 2b: Route to review tier

```
IF operation == lookup → hard review (scope gate)
IF risk == factual (verify/correct claims) → nightmare_factual
IF risk == strategic (synthesize/update/taxonomy) → nightmare_strategic
IF risk == governance (challenge/direction) → nightmare_strategic
DEFAULT → hard review
```

**Log `route_reason` in service-index** for auditability:
`{"request_id":"...","route":"nightmare_strategic","route_reason":"operation=synthesize, target=synthesis, refs=5 synthesis pages"}`

#### Step 2c: Execute review

**Hard review** (Codex MCP `mcp__codex__codex`):
- Is the question well-formed? In scope? Actionable?
- Verdict: PASS/FAIL

**Nightmare review — factual mode** (`run_codex_exec.js --nightmare`):
- GPT reads wiki directly, compares feedback claims against existing content
- Focus: are the claimed contradictions/errors real?
- Verdict: PASS/FAIL with findings

**Nightmare review — strategic mode** (`run_codex_exec.js --nightmare`):
- GPT reads wiki synthesis layer (hierarchy, theses, scope registry)
- Evaluates: does the requested synthesis fit the existing architecture? Would it breach ceiling? Does it overlap existing theses? What's the minimum viable scope?
- Verdict: PASS/FAIL with architectural recommendations

On FAIL → append `{request_id, status: "review_failed", findings: [...]}` to service-index. STOP.
On PASS → append `{request_id, status: "review_passed", lease_owner: "...", lease_expires: "...", operation: "...", risk: "...", target_level: "...", route: "hard|nightmare_factual|nightmare_strategic", route_reason: "..."}`.

**Manual override**: If operator disagrees with automatic classification, override with `route_reason: "manual_override: <reason>"`.

### Step 3: Local Search

```bash
npx tsx tools/kb-topic-bundle.ts "<topic from feedback>" --format json
```

**Coverage check**:
- Parse bundle JSON. Get `sourceCount` from stats.
- Read `wiki/sources/<slug>.md` frontmatter for each source in bundle to get `year:`.
- Skip redirects (`redirect:` in frontmatter) and yearless pages.
- `sufficient = sourceCount >= 3 AND (isFresh OR unknown)`
  - `isFresh = newestYear >= currentYear - 1` (if any source has year)
  - `unknown` = no sources have year → don't trigger external search

If sufficient → skip to Step 6.

### Step 4: External Search (--preview, no raw/ writes)

```bash
npx tsx tools/arxiv-search.ts --query "<topic>" --limit {effort_limit} --preview
npx tsx tools/semantic-scholar-search.ts --query "<topic>" --limit {effort_limit} --preview
npx tsx tools/deepxiv-reader.ts --search "<topic>" 2>/dev/null || true
```

Parse JSON stdout from arXiv/S2 preview. DeepXiv is text-only, best-effort.

**If all candidates filtered (empty JSON arrays)** → do NOT conclude novelty. Instead:

1. **Recommend expanded search strategies** to the operator:
   - Synonym/upper-concept reformulation (e.g., "prerequisite insertion" → "workflow prerequisite", "mandatory login wall", "consent barrier")
   - Related work backtrace: read the `## References` section of the closest existing wiki sources for leads
   - Run `/novelty-check "<claim>"` for systematic verification
   - Check workshop papers, tech reports, and non-indexed venues manually

2. **Generate response with `gap_status: "unresolved"` + `verification_needed: true`**:
   - Include `suggested_search_terms` (synonyms and upper-concepts)
   - Include `closest_sources` (top 3 from local search for related work backtrace)
   - Explicitly state: "Absence from NORIA + arXiv + S2 does not confirm novelty. Further verification required."

3. **Do NOT claim novelty** — only claim "initial search did not find direct coverage."

### Step 5: Human Approval

Present structured decision bundle to the NORIA operator:

```
=== NORIA Service Request [{request_id}] ===
Origin: {origin_project} (logging only)
Type: {feedback_kind}
Review: PASS ({review_type}, host-side)

Local: {conceptCount} concepts, {sourceCount} sources (newest: {year})
External candidates (--preview, not written to raw/):
  [1] {citekey} ({source}, relevance: {score}) ✓
  [2] {citekey} ({source}, relevance: {score}) ✓
  [3] (DeepXiv: {status})

Approve? [Y/n/select]
```

### Step 6: Ingest Approved Candidates

```bash
# arXiv
npx tsx tools/arxiv-search.ts --id <arxiv_id>
# S2
npx tsx tools/semantic-scholar-search.ts --paper <paperId>
```

Then run the /kb-compile workflow (this is a Claude skill, not a CLI tool):
- Read new raw/ files, generate wiki/sources/ + wiki/concepts/
- Update wiki/index.md and .kb/manifest.json

Verify: `npx tsx tools/kb-lint.ts` → 9/9 PASS

### Step 7: Generate Response

```bash
npx tsx tools/kb-service-respond.ts --request-id {id} --topic "<topic>" --origin {project} --ingested slug1,slug2
# Or for unresolved:
npx tsx tools/kb-service-respond.ts --request-id {id} --topic "<topic>" --unresolved --remaining-gaps "topic1,topic2"
```

Append to service-index:
- Normal: `{request_id, status: "serviced", response_file: "...", ingested: [...]}`
- Unresolved: `{request_id, status: "unresolved", response_file: "...", remaining_gaps: [...]}`

## Rules

- Review type is determined by content, NEVER by effort tier or client hints
- `query-derived` content never enters `wiki/`
- Feedback files in `outputs/queries/` are append-only — never modify them
- Service lifecycle tracked in `.kb/service-index.jsonl` (append-only sidecar)
- Single operator constraint: no atomic claim locks

ARGUMENTS: $ARGUMENTS
