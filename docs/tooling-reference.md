# Installed Workflow Tooling Reference

> Extracted from CLAUDE.md to reduce per-request token overhead. This file is the authoritative tool reference.

## Core Infrastructure

- `agent-deck` is available as the local skill at `.claude/skills/agent-deck/SKILL.md` and the repo-local binary in `.codex-tools/bin/agent-deck`.
- Direct Codex CLI review is wrapped by `tools/review/run_codex_exec.js` for repo-local `nightmare` reviews.

## KB Workflow Commands

The KB workflow commands are `/kb-sync`, `/kb-ingest`, `/kb-compile`, `/kb-lint`, `/kb-ask`, and `/kb-reflect`.

## Search & Ingestion Tools

- **Semantic Scholar**: `tools/semantic-scholar-search.ts` searches published venue papers (IEEE, ACM, Springer) via S2 Graph API. Exposed through `/kb-sync semantic-scholar` or `/kb-sync s2`. Stores results in `raw/semantic-scholar/`. Supports `--related` and `--citations` modes for cross-domain paper discovery. Has `--no-filter` to bypass relevance filter.
- **Zotero push**: `tools/zotero_push.py` pushes search results to Zotero Web API + downloads PDFs to OneDrive. Creates item → downloads PDF → creates linked_file attachment. Requires `ZOTERO_API_KEY`, `ZOTERO_LIBRARY_ID`, `ZOTERO_COLLECTION_KEY` in `.env`. Usage: `python3 tools/zotero_push.py --from-raw raw/arxiv/*.md`.
- **Relevance filter**: `tools/relevance-filter.ts` provides 3-layer OR-gate pre-ingestion filtering for arXiv and S2 search results. Layer 1: SPECTER2 embedding similarity (S2 API, zero LLM cost). Layer 2: LLM zero-shot screening (optional). Layer 3: keyword heuristic with domain exclusion (always available). Configured via `tools/research-topic-config.json`. Use `--no-filter` on search tools to bypass. Design: OR-gate (any layer accepting → pass), recall > precision, graceful degradation.
- **Venue verification**: `tools/venue-verify.ts` verifies top-conf/top-journal venue claims against S2 API + DBLP API. Supports `<citekey>`, `--batch`, `--stats`, `--dry-run`. Unverified papers get manual check URLs (OpenReview/ACL Anthology/IEEE Xplore). Integrated into kb-compile and kb-deepen workflows.
- **Twitter/X ingest**: `tools/twitter-ingest.ts` + `tools/twitter-scweet-bridge.py`. Scweet for keyword search/profile scraping (dedicated account), xcancel for URL resolution. 3-layer quality filter (author authority, content signals, engagement). Outputs to `raw/twitter/`. Config in `tools/twitter-curated-accounts.json`. **Note**: Twitter content must use `provenance: social-lead` when compiled to wiki/sources/. Never `source-derived`.
- **GitHub search**: `tools/github-search.ts` fetches official paper repos, benchmark implementations, and tagged releases via GitHub REST API. Narrow allowlist design: `--repo OWNER/REPO` for specific repos, `--search "query" --min-stars N` for filtered search, `--releases OWNER/REPO` for release notes. Outputs to `raw/github/`. No auth required for public reads (60 req/hr); set `GITHUB_TOKEN` for 5000 req/hr. GitHub content compiles as `provenance: social-lead` unless the repo IS the paper's official artifact (then `source-derived` is acceptable with the paper citekey in `sources:`).
- **WeChat ingest**: `tools/wechat-ingest.ts` polls we-mp-rss API (Docker at localhost:8001) for WeChat Official Account articles. Modes: `--poll` (fetch new articles), `--subscribe <name>`, `--list`, `--search`, `--status`. 3-layer quality filter: account allowlist + keyword match + link detection (arXiv/DOI/GitHub). Setup: `cd tools/wechat && docker compose up -d`, then scan WeChat Reading QR at `http://localhost:8001/`. Outputs to `raw/wechat/`. Compiles as `provenance: social-lead`.

## Knowledge Tools

- **Sidecar relation graph**: `tools/kb-relations.ts` manages typed edges in `.kb/relations.jsonl`. Run `--scan` to extract wikilinks, `--bridges` to find cross-domain candidates. Does NOT modify wiki pages — relations live alongside, not inside.
- **Topic bundle query**: `tools/kb-topic-bundle.ts` answers "what does the wiki know about X?" for external project consumption. Returns concept summaries, source claims, related pages, and open questions. Supports `--format json` for LLM context stuffing.
- **`/wiki-help` command**: Self-documenting entry point showing architecture, commands, provenance model, and dynamic wiki status. Supports `--quick`, `--commands`, `--status`, `--workflow`, `--provenance` flags.
- **`/kb-deepen` command**: Read local Zotero PDFs to deepen source pages beyond abstract-level. Uses `zotero_sync.py --pdf-paths` to map citekeys to PDF files. Upgrades citation locators from `abstract` to `sec.X`.
- **Track promotion**: `tools/track-promote.ts` scans social-lead pages for links to peer-reviewed papers and manages Track A→B promotion. `--scan` lists candidates, `--check <slug>` inspects one page, `--promote <slug> --paper <citekey>` upgrades provenance to source-derived with the paper link. Promotion is always explicit (never automatic).
- **Dual-track configuration**: `tools/research-topic-config.json` defines Track A (Tool & Capability Intelligence: twitter/github/wechat) and Track B (Academic Research: arxiv/s2/zotero). Track A uses `social-lead` provenance; Track B uses `source-derived`. Track A content does NOT modify concept pages during kb-compile.

## Reader Layer

- **Local progressive reader**: `tools/noria-reader.ts` provides token-efficient access to local papers. Agent-first design inspired by DeepXiv's progressive reading. Modes: `--brief` (~200 tok, RT relevance + metadata), `--head` (~800 tok, section structure + token budget), `--section` (specific section only), `--triage` (batch screening ~100 tok/paper with ✅/🔶/❌ RT classification), `--search` (local keyword), `--budget` (visual token breakdown), `--exists` (dedup check, exit 0=exists). Zero external API calls. Uses raw/ + wiki/ + Zotero PDFs.
- **DeepXiv cloud reader**: `tools/deepxiv-reader.ts` provides progressive reading for all 2.9M arXiv papers via DeepXiv REST API (data.rag.ac.cn). Modes: `--brief`, `--head`, `--section`, `--search` (BGE-m3+BM25 hybrid), `--trending` (Twitter social signals with `--filter` for RT relevance), `--raw`, `--health`. Zero LLM token cost. 10K API calls/day with DEEPXIV_TOKEN in .env. Auto-fallback: exit code 2 on rate limit → caller uses noria-reader.
- **`/kb-trending` command**: Discover trending arXiv papers via DeepXiv social signals + local RT keyword filter. Zero LLM cost for discovery. Weekly workflow: trending → filter → brief → human review → compile.

## External Services

- Multi-model agent team config lives in `.llm/agent-team.json` and `docs/agent-team-workflow.md`.
- Agent team planning command: `/agent-team-plan`.
- QMD MCP server is configured in `.mcp.json` for local wiki search. Exposes `query`, `get`, `multi_get`, and `status` tools over 100 indexed wiki pages.
- Remote knowledge service: `tools/noria-mcp-server.py` (lightweight Python, zero ML deps) via SSH reverse tunnel. Exposes `search`, `get`, and `submit_feedback` tools. See `docs/remote-wiki-access.md`.
- Feedback triage: `tools/kb-feedback-triage.ts` periodically scans `outputs/queries/` for pending feedback, classifies by kind (gap/accuracy/insight), and outputs triage report to `outputs/reviews/`. Design rationale in `docs/feedback-loop-design.md`.
