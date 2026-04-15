# NORIA Reviewer Routing Protocol

> Shared reference for all review-capable skills. Defines how to select the external reviewer model.

## Default Behavior

All review calls default to **Codex MCP** (`mcp__codex__codex`) with `reasoning_effort: xhigh`. This is the non-negotiable floor — never downgrade below this.

## Reviewer Selection

| `-- reviewer:` value | Backend | Model | When to use |
|---|---|---|---|
| *(omitted)* | Codex MCP | GPT-5.4 xhigh | Default. Everyday review, brainstorm, validation |
| `codex` | Codex MCP | GPT-5.4 xhigh | Explicit default (same as omitting) |
| `oracle-pro` | Oracle MCP | GPT-5.4 Pro | Deep proof verification, top-venue paper review, critical novelty check |

## Oracle Pro Setup

```bash
npm install -g @steipete/oracle
claude mcp add oracle -s user -- oracle-mcp
# Optional (faster, recommended): export OPENAI_API_KEY=sk-...
```

**Two modes**:
- **API mode** (fast): Requires `OPENAI_API_KEY` env var. Suitable for loops and batch operations.
- **Browser mode** (slow, 1-2 min per call): Requires Chrome + ChatGPT Pro login. NOT suitable for auto-review loops or any iterative skill.

## Routing Logic (for skill authors)

```markdown
1. Parse $ARGUMENTS for `-- reviewer: <value>`
2. If `oracle-pro`:
   a. Check if `mcp__oracle__oracle` tool is available
   b. If YES → use Oracle MCP
   c. If NO → warn user "Oracle MCP not installed, falling back to Codex MCP"
      → use `mcp__codex__codex` with xhigh reasoning
3. If `codex` or omitted → use `mcp__codex__codex` with xhigh reasoning
```

## Skills That Support Oracle Pro

| Skill | Default Reviewer | Oracle Pro Benefit |
|---|---|---|
| `/gpt-nightmare-review` | codex exec (hardcoded) | Pro-level independent repo audit |
| `/research-review` | Codex MCP xhigh | Deeper architectural critique |
| `/plan-review-loop` | Codex MCP xhigh | More rigorous plan stress-testing |
| `/kb-hypothesize` | Codex MCP xhigh | Higher-quality brainstorm + devil's advocate |
| `/kb-novelty-check` | Codex MCP xhigh | More thorough prior work detection |

## Non-Negotiable Constraints

1. **xhigh is a floor, not a ceiling** — Oracle Pro reasoning is ≥ xhigh by design
2. **Reviewer independence** — same rules as `reviewer-independence.md`: do NOT pre-digest content for the reviewer
3. **Effort tiers do NOT change the reviewer model** — effort scales work volume, not reviewer quality
4. **Browser mode ban in loops** — if a skill runs multiple review rounds (auto-review-loop, plan-review-loop), Oracle browser mode MUST NOT be used. API mode only. If no API key, fall back to Codex.
5. **Graceful degradation** — Oracle not installed = zero errors, zero warnings in normal flow. Only warn when user explicitly requests `-- reviewer: oracle-pro`.
