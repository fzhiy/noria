---
name: plan-review-loop
description: Autonomous plan-review loop. Claude Opus 4.6 (max effort, deep thinking) plans and revises; GPT 5.4 (xhigh, extended thinking) nightmare-reviews. Iterates until GPT approves or max rounds. Use when you want adversarial plan verification before implementation.
argument-hint: <plan-file-path> [--max-rounds N] [--scope "scope description"] [-- reviewer: codex|oracle-pro]
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# Plan Review Loop

Automated adversarial plan-review cycle between two frontier models at maximum reasoning depth:

- **Planner**: Claude Opus 4.6 — max effort, deep analytical thinking
- **Reviewer**: GPT-5.4 — xhigh reasoning effort, extended thinking, nightmare mode (direct filesystem access). Override with `-- reviewer: oracle-pro` for GPT-5.4 Pro (see `shared/reviewer-routing.md`).

Both models operate at their absolute maximum reasoning capacity. This is not a lightweight check — it is a full adversarial verification protocol.

## Arguments

Parse from ARGUMENTS string:
- `plan_file`: path to the plan file (required, first positional arg)
- `--max-rounds N`: maximum review iterations (default: 5)
- `--scope "..."`: description of what the plan covers (used in GPT prompt)

## Protocol

### INITIALIZATION

1. Read the plan file specified in `plan_file`
2. Set `round = 0`, `findings_history = []`
3. If `--scope` not provided, infer scope from the plan's first heading

### LOOP (repeat until APPROVE or round >= max_rounds)

```
round += 1
print "═══ Plan Review Loop — Round {round}/{max_rounds} ═══"
```

#### Phase A: Claude Deep Analysis (BEFORE sending to GPT)

**You are Claude Opus 4.6. Apply maximum analytical depth. This is not a surface pass.**

Before generating the GPT review prompt, YOU must first verify the plan yourself:

1. Read the plan file in full
2. For every file path mentioned in the plan, READ that actual file:
   - Verify line numbers are correct
   - Verify function signatures match
   - Verify interfaces/types are compatible
   - Verify the proposed changes don't conflict with existing code
3. For every claim like "this function is exported" or "this flag exists", GREP to confirm
4. Fix any issues you find BEFORE sending to GPT. Update the plan file directly.
5. Output a brief changelog:
   ```
   [Round {round} Pre-Review Fixes]
   - Fixed: X (was wrong because Y, verified at file:line)
   - Verified: Z (confirmed correct at file:line)
   ```

**Why this matters**: If you send a sloppy plan to GPT, GPT will catch trivial errors and waste a review round. Fix the obvious issues yourself first so GPT can focus on deeper architectural concerns.

#### Phase B: Generate Nightmare Review Prompt

Create prompt at `outputs/reviews/{date}-plan-review-loop-r{round}-prompt.md`:

```markdown
# Plan Review — Round {round}

## Scope
{scope}

## The Plan
Read in full: {plan_file}

## Prior Findings History
{for each previous round: round number, findings, what was fixed}

## Verification Instructions

You are GPT-5.4 operating at xhigh reasoning effort with extended thinking.
Apply your deepest analytical capabilities. Do not surface-level skim.

For every claim in the plan:
1. Read the actual file referenced
2. Verify line numbers, function signatures, types, and interfaces
3. Check for conflicts with existing code patterns
4. Verify the proposed change is implementable as described

Focus on:
- Implementability: can the proposed code changes actually work?
- Consistency: do all parts of the plan agree with each other?
- Completeness: are there missing steps or undefined transitions?
- Correctness: do proposed interfaces match actual codereferences?

## Output Format
[SEVERITY] ID: Title
Evidence: file:line reference
Recommendation: specific fix

End with: APPROVE / CONDITIONAL_APPROVE / REJECT
If CONDITIONAL_APPROVE, list specific conditions.

IMPORTANT: If you find no HIGH or CRITICAL issues, issue APPROVE or CONDITIONAL_APPROVE.
Only REJECT if there are genuine blockers that prevent implementation.
```

#### Phase C: Run GPT-5.4 Nightmare Review

```bash
node tools/review/run_codex_exec.js outputs/reviews/{date}-plan-review-loop-r{round}-prompt.md --nightmare
```

This hardcodes GPT-5.4 with `model_reasoning_effort="xhigh"` and `--full-auto` (set in `run_codex_exec.js`, not configurable).

Save the raw output to `outputs/reviews/{date}-plan-review-loop-r{round}-review.md`.

#### Phase D: Parse Verdict and Decide

Read the review output. Extract the verdict line (APPROVE / CONDITIONAL_APPROVE / REJECT).

**If APPROVE**:
```
print "═══ APPROVED at Round {round}/{max_rounds} ═══"
print "Plan is ready for implementation."
```
Save findings history to the plan file as an appendix. STOP.

**If CONDITIONAL_APPROVE**:
```
print "═══ CONDITIONAL APPROVE at Round {round}/{max_rounds} ═══"
print "Conditions: {list conditions}"
```
Present conditions to user. STOP. (User decides whether to proceed or fix.)

**If REJECT**:
Extract all findings. Append to `findings_history`.
```
print "═══ REJECTED at Round {round} — {N} findings ═══"
print "{findings summary}"
```

**Convergence check**:
- If `round >= 2` AND current finding count >= previous finding count:
  ```
  print "⚠ Findings not decreasing ({prev} → {curr}). Consider scope reduction."
  ```
- If all findings are LOW or MEDIUM (no HIGH/CRITICAL):
  ```
  print "No HIGH/CRITICAL findings. Treating as CONDITIONAL_APPROVE."
  ```
  STOP.

**If continuing**: Go back to Phase A with the new findings.

#### Phase E: Deep Revision (within Phase A of next round)

**You are Claude Opus 4.6. This is the most critical phase. Think deeply.**

For EACH finding from GPT:
1. Read the finding's evidence (file path + line number)
2. Read that ACTUAL FILE at those lines — do not trust the plan's description
3. Determine the root cause:
   - Is it a plan prose error (wrong line number, wrong variable name)?
   - Is it an interface mismatch (plan claims X but code has Y)?
   - Is it a design flaw (the proposed approach can't work)?
   - Is it a scope issue (plan promises something the tool can't deliver)?
4. Fix the root cause in the plan file
5. After fixing, re-read the surrounding plan sections — did this fix break anything else?
6. Record in changelog: what you fixed, why, what file:line you verified against

**Anti-patterns to avoid** (these cause infinite loops):
- Fixing the plan text without reading the actual code → GPT will catch the same issue
- Using placeholder values ("~50 lines") without counting → GPT will verify
- Claiming "reuse X" without confirming X is exported/callable → GPT will check
- Adding a fix that contradicts another part of the plan → GPT will find the inconsistency

### MAX ROUNDS REACHED

If `round >= max_rounds` and still REJECT:
```
print "═══ MAX ROUNDS ({max_rounds}) REACHED — NOT APPROVED ═══"
print "Remaining findings: {list}"
print "Recommendation: Review findings manually and decide whether to proceed or restructure."
```

Save all findings to the plan file as an appendix. STOP.

## Rules

- **NEVER skip Phase A** (Claude self-check). This is what prevents shallow iterations.
- **NEVER modify GPT's output**. Present findings verbatim.
- **NEVER argue with GPT's findings without reading the actual code**. If you disagree, verify against the file first.
- **ALWAYS save both prompt and review files** to `outputs/reviews/` for auditability.
- The `--nightmare` flag is mandatory. It ensures GPT-5.4 xhigh + full-auto.
- All review files must include the round number in the filename.

ARGUMENTS: $ARGUMENTS
