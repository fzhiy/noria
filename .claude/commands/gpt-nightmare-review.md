---
name: gpt-nightmare-review
description: Run a hostile external repo review where GPT reads the repository directly via codex exec. Use before major merges, architecture shifts, or when you want adversarial verification.
argument-hint: [optional: target scope or files]
allowed-tools: Bash(*), Read, Grep, Glob, Write, Edit
---

# GPT Nightmare Review (codex exec)

ARIS-style `nightmare` review: GPT reads the repository **independently** via `codex exec`.

## How It Differs From Other Reviews

| Review Type | Method | Who Curates Context | Trust Model |
|---|---|---|---|
| `/research-review` (normal) | Codex MCP or exec | Claude summarizes, GPT reviews summary | Medium — GPT sees what Claude shows |
| `/research-review` with xhigh (hard) | Codex MCP with `model_reasoning_effort: xhigh` | Claude summarizes with more depth | Higher reasoning, still Claude-curated |
| `/gpt-nightmare-review` (nightmare) | **codex exec only** | **GPT reads repo files directly** | Highest — GPT verifies claims against actual files |

The key difference: nightmare review gives GPT **direct filesystem access** so it can independently verify every claim in the repository without relying on Claude's summary.

## Workflow

### Step 1: Prepare the prompt file

Create a prompt file at `outputs/reviews/<timestamp>-nightmare-prompt.md` containing:
- The review scope (what to audit)
- The repo structure overview (directory layout)
- Key files GPT should read first (`CLAUDE.md`, `wiki/index.md`, `.kb/manifest.json`)
- Specific verification instructions (check provenance, validate citations, find broken links)
- Output format: severity-ranked findings with file:line references

### Step 2: Run via codex exec (non-interactive)

```bash
node tools/review/run_codex_exec.js outputs/reviews/<timestamp>-nightmare-prompt.md --nightmare
```

The `--nightmare` flag is **mandatory** for this skill. It hardcodes:
- `--model gpt-5.4` (highest capability model)
- `-c 'model_reasoning_effort="xhigh"'` (maximum reasoning depth)
- `--full-auto` (non-interactive)

These are set in `tools/review/run_codex_exec.js`, NOT inherited from `~/.codex/config.toml`. This ensures nightmare reviews always use GPT-5.4 xhigh regardless of the user's local Codex configuration.

This launches GPT in a sandboxed read-only environment where it:
- Reads any file in the repository
- Runs grep/find to search the codebase
- Independently verifies claims against actual file contents
- Produces findings without Claude filtering or summarizing

### Step 3: Save and process results

1. Save raw review output to `outputs/reviews/<timestamp>-nightmare-review.md`
2. Extract severity-ranked findings
3. Present results to user with file references
4. Optionally create tasks for critical/high findings

## Review Focus For This Repo

- Architecture claims in `CLAUDE.md` vs actual implementation
- Provenance safety: are `source-derived` claims actually backed by raw files?
- Citation integrity: do `[source: citekey, location]` citations point to real content?
- Pipeline integrity: `raw/ → wiki/ → outputs/` — any contamination?
- Manifest consistency: do `.kb/manifest.json` entries match actual wiki/ state?
- Link integrity: do all `[[wikilinks]]` resolve to existing pages?
- Schema compliance: does every wiki page have valid frontmatter?
- Pruning stability: can pruned content accidentally re-enter the wiki?

## Rules

- **ALWAYS use codex exec**, never MCP prompt relay for nightmare reviews
- Do not soften, filter, or summarize GPT's output before showing the user
- GPT must verify claims by reading actual files, not trusting descriptions
- Prefer evidence-backed criticism (file:line references) over style commentary
- Save both prompt and result to `outputs/reviews/` for auditability
