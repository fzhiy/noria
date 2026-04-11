# NORIA — Agent Instructions

> Lean instruction file. Full schema: `schema.md`. Tool docs: `docs/tooling-reference.md`.

## Ownership (hard boundaries)

| Directory | Owner | Rule |
|---|---|---|
| `raw/` | User | **NEVER modify, delete, or reorganize** |
| `wiki/` | LLM | LLM creates/updates. Preserve `user-verified` content. |
| `outputs/` | LLM | Generated reviews/queries. **NEVER feed back into wiki/** |
| `tools/` | Shared | LLM may modify with user approval |

## Forbidden Operations

- Never delete `raw/` files
- Never overwrite `user-verified` content without explicit user request
- Never feed `outputs/` content back into `wiki/`
- Never create wiki pages without provenance frontmatter (see `schema.md`)
- Never fabricate citations — mark uncertain claims with `[UNVERIFIED]`
- Never assign `source-derived` to social media content (twitter/wechat/github README) — use `social-lead`. Exception: GitHub repo that IS a paper's official artifact may use `source-derived` with the paper citekey
- Never use `venue_tier: top-conf/top-journal` without venue verification

## Token Efficiency

- ALWAYS `noria-reader --brief` before full reads (saves ~70%)
- ALWAYS `noria-reader --exists` before saving any paper to raw/
- Use `--triage` for batch evaluation, `--head` before `--section`
- Only call `deepxiv-reader` when local reader cannot provide content
- For kb-deepen: RT pre-screen first — skip OFF-TOPIC, lite-read PARTIAL

## Multi-Agent Model Routing (MANDATORY)

Main session = Opus. Subagents use cheapest sufficient model.

| Task | Model | Rationale |
|---|---|---|
| lint, triage, exists-check | `model: "haiku"` | Deterministic, no reasoning needed |
| compile, search, deepen, code | `model: "sonnet"` | Routine work (default via env var) |
| synthesis, architecture, planning | `model: "opus"` | Deep reasoning required |
| adversarial review | `mcp__codex__codex` (GPT-5.4) | Cross-model, separate quota |

Default subagent = Sonnet (enforced: `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`).

## Conventions

- Filenames: kebab-case. Source slugs: `<author><year>-<keyword>`
- Dates: ISO 8601. Log timestamps: local time (BST, UTC+1)
- **Worktree Edit ENOENT**: Use `python3 -c "..."` via Bash for wiki/ edits in worktrees
- **Git lock cleanup**: `rm -f .git/worktrees/feature-agent/index.lock` before commits

## KB Workflow

Commands: `/kb-sync`, `/kb-ingest`, `/kb-compile`, `/kb-lint`, `/kb-ask`, `/kb-reflect`, `/kb-deepen`, `/kb-trending`

Each command has its own skill file with full instructions. Schema rules are in `schema.md`.

Key rules:
- `kb-lint` is **mandatory** before `kb-reflect` (enforced by hook)
- `query-derived` content never enters `wiki/`
- `social-lead` content cannot be cited in synthesis (≥2 `source-derived` required)
- Final wiki writes remain Claude-led

## Tooling

> Full reference: `docs/tooling-reference.md`

- Readers: `noria-reader.ts` (local), `deepxiv-reader.ts` (cloud)
- Search: S2, arXiv, GitHub, Twitter, WeChat tools in `tools/`
- Review: `/gpt-nightmare-review`, Codex MCP
- Agent team config: `.llm/agent-team.json`
- **Effort tiers**: 5-level scaling (lite → beast). See `.claude/commands/shared/effort-contract.md`
