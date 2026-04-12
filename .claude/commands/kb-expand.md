---

name: kb-expand
description: "Close the flywheel: route gap scan results to sync → compile → lint. Automates gap → expansion → retrieval loop."
argument-hint: [--dry-run] [--type demand|depth|structural|frontier] [--limit N] [-- effort: lite|standard|extended|heavy|beast]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

> **Effort**: Default `standard`. See `shared/effort-contract.md` for all tiers.



# KB Expand: Gap → Expansion Automation

Routes knowledge gaps from `/kb-gap-scan` into concrete expansion actions. This is the flywheel's "auto-expansion" step — it bridges gap detection and source acquisition.

## Prerequisites

1. Run `/kb-triage` first (ensures signal-index is fresh)
2. Run `/kb-gap-scan` to identify current gaps

## Workflow

### Step 1: Run gap scan

```bash
npx tsx tools/kb-gap-scan.ts --json
```

Parse the JSON output. Each gap has `type`, `severity`, `description`, `action`, `anchors`.

### Step 2: Route gaps by type

| Gap Type | Auto Action | Human Gate |
|----------|-------------|------------|
| **demand** | `/kb-sync s2 "<topic>" --limit 5` | Review results before compile |
| **depth** | `/kb-deepen <citekey>` | Automatic (RT pre-screen gates) |
| **structural** | `/kb-reflect` (suggest topic) | Human approves synthesis scope |
| **frontier** | `/kb-trending` + `/kb-sync s2 "<concept>" --year 2025-` | Review results |
| **audit** | Flag for manual review | Always human |

### Step 3: Execute (with dry-run)

For `--dry-run`: only print what would be done, do not execute any sync/compile.

For actual execution:
1. **Demand gaps**: Search S2 for the gap topic, save to `raw/semantic-scholar/`, then compile
2. **Depth gaps**: Run kb-deepen for each citekey (capped at `--limit`, default 3)
3. **Structural gaps**: Print synthesis suggestions (human-gated)
4. **Frontier gaps**: Search for recent papers on the concept

### Step 4: Post-expansion verification

After any sync+compile:
```bash
npx tsx tools/kb-lint.ts        # Must remain 8/8 PASS
npx tsx tools/kb-gap-scan.ts    # Verify gaps reduced
```

### Step 5: Flywheel Status Report

After verification, always print a structured status block:

```
═══ NORIA Flywheel Status ═══
  Actioned: {N} gaps ({breakdown by type, e.g. "2 depth, 1 demand"})
  Lint: {8/8 PASS | N warnings}
  Remaining: {N HIGH, N MEDIUM, N LOW gaps}
  Next: {one-line recommendation}
═══════════════════════════════
```

Next-step recommendation logic (first match wins):
1. Lint failed → "Fix lint errors before continuing."
2. HIGH structural gap exists → `/kb-reflect` (synthesis needed)
3. MEDIUM depth gaps remain → `/kb-expand --type depth` (continue deepening)
4. Demand/frontier gaps remain → `/kb-expand --type demand` or `/kb-trending`
5. All gaps LOW or zero → "Flywheel healthy. Run `/kb-discover` for new insights."
6. Lint warnings > 30 → "Run `/kb-lint` to investigate warnings before continuing."

Also print this status block in `--dry-run` mode (using current gap scan data without executing actions).

## Key Rules

- **Demand and frontier** gaps trigger external search — always review before compile
- **Depth** gaps trigger kb-deepen — RT pre-screen gates off-topic papers automatically
- **Structural** gaps suggest synthesis — never auto-generate synthesis without human approval
- **Audit** gaps are ALWAYS human-reviewed — never auto-fix accuracy disputes
- Cap parallel operations at `--limit` (default 3) to control token cost
- Log all expansion actions to `log.md`

## Example Session

```
/kb-expand --dry-run
# [DEMAND] "prerequisite-step-insertion" — would search S2 for 5 papers
# [DEPTH] qi2024-webrl — would deepen (RT: core)
# [STRUCTURAL] drift-detection × web-agent — would suggest /kb-reflect synthesis
# Dry run complete. 3 gaps actionable.
#
# ═══ NORIA Flywheel Status ═══
#   Actioned: 0 gaps (dry run)
#   Lint: 8/8 PASS | 21 warnings
#   Remaining: 1 HIGH, 10 MEDIUM, 2 LOW gaps
#   Next: /kb-reflect (1 HIGH structural gap: Agent Benchmark × Robustness)
# ═══════════════════════════════

/kb-expand --type depth --limit 2
# [DEPTH] malladi2023 — deepened (abstract → sec-level)
# [DEPTH] patwardhan2025 — deepened (abstract → sec-level)
#
# ═══ NORIA Flywheel Status ═══
#   Actioned: 2 gaps (2 depth)
#   Lint: 8/8 PASS | 21 warnings
#   Remaining: 1 HIGH, 8 MEDIUM, 2 LOW gaps
#   Next: /kb-reflect (1 HIGH structural gap: Agent Benchmark × Robustness)
# ═══════════════════════════════
```
