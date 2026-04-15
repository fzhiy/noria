---
name: noria-consult
description: Consult NORIA knowledge base from an external research project. Introspects project state, formulates questions, submits via MCP. Copy this file to your project's .claude/commands/.
argument-hint: [question or topic]
allowed-tools: Bash(*), Read, Grep, Glob, mcp__noria__*
---

# NORIA Consult — External Project Knowledge Request

Submit knowledge requests to the NORIA KB from your research project.
NORIA handles all review and quality gating server-side.

## Prerequisites

- NORIA MCP server running and accessible via `.mcp.json`
- SSH tunnel or local connection to NORIA host

## Workflow

### Step 1: Project Introspection

Read your project context:
1. `CLAUDE.md` or `README.md` → long-term goals
2. `git log --oneline -10` → current phase
3. Recent `outputs/` → experimental results, blocking problems

Summarize: `{goals, current_phase, blocking_problems}`

### Step 2: Formulate Question

Based on introspection, identify the specific knowledge need.

Classify severity (hint only — NORIA decides the actual review level):
- `lookup` — factual query, no feedback intent
- `feedback` — gap/accuracy/insight report
- `direction_change` — proposing research pivot or challenging assumptions

### Step 3: Submit via MCP

For lookups (no feedback):
```
mcp__noria__ask(question="your question", max_pages=5)
```

For feedback:
```
mcp__noria__submit_feedback(
  query_summary="concise question",
  feedback_kind="gap|accuracy|insight",
  feedback_detail="project context and specific need",
  origin_project="your-project-name",
  severity_hint="feedback|direction_change",
  wiki_pages=["relevant/pages"],
  citekeys=["relevant-citekeys"]
)
```

Save the returned `request_id` for later retrieval.

### Step 4: Retrieve Response

After NORIA processes the request (may involve review + search + human approval):

```
mcp__noria__get_service_response(request_id="srv-a1b2c3d4e5f6")
```

The response includes:
- Existing wiki coverage (concepts, sources, open questions)
- Freshness assessment
- Newly ingested sources (if any)
- Gap status (resolved/partially_resolved/unresolved)
- **If unresolved/partial**: `verification_needed: true` + `suggested_search_terms` + `closest_sources` + guidance note

**Important**: 
- Response is `provenance: query-derived` — verify against primary sources before citing
- **`unresolved` or `partially_resolved` does NOT mean "novel"** — it means NORIA's initial search found no or insufficient match. Novelty remains UNVERIFIED. Run `/novelty-check` and expand search with suggested synonyms before making novelty claims

ARGUMENTS: $ARGUMENTS
