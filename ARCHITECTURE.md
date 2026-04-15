# NORIA Knowledge Base — Architecture

> Last updated: 2026-04-11. Review history: `outputs/reviews/`

## Vision

NORIA is an **agent-first, CLI-first academic research knowledge service** for CS/AI researchers.

**Core goals**:
- Provide reliable knowledge retrieval and Q&A with minimal token cost
- Accelerate research through a knowledge flywheel (feedback → gap detection → expansion → better retrieval)
- Use Obsidian as a human-friendly visualization frontend (MOC + Juggl + Dataview + sigma.js)
- Serve as an MCP knowledge service for research projects, accepting feedback to improve the KB
- Rapidly distill research topics: papers → concepts → synthesis → citable structured knowledge

**Design principles**:
- **Provenance-first**: Every claim carries trust level and citation traced to section level
- **Token-efficient**: Progressive reading + RT pre-screening + manifest-gated compile
- **Human-gated**: Auto-discovery but human-approved expansion — prevents knowledge pollution
- **Lean CLAUDE.md**: Agent instructions under 80 lines; full schema in `schema.md`

Extends the [Karpathy llm-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) with 5-level trust hierarchy, multi-model adversarial review, progressive PDF reading, and dual-track information architecture.

## Three-Layer Architecture

```
Raw Sources (user owns)  →  LLM Engine (Claude Code)  →  Wiki (LLM maintains)
                                                        →  Retrieval Layer (QMD MCP)
```

### Layer 1: Raw Sources (user owns, LLM reads only)

| Directory | Source | Provenance on compile |
|---|---|---|
| `raw/zotero/papers/` | Auto-synced from Zotero | `source-derived` |
| `raw/arxiv/` | arXiv API search results | `source-derived` |
| `raw/semantic-scholar/` | Semantic Scholar API | `source-derived` |
| `raw/twitter/` | Twitter/X posts (quality-filtered) | `social-lead` |
| `raw/wechat/` | WeChat articles (quality-filtered) | `social-lead` |
| `raw/github/` | GitHub repos, releases | `social-lead` (exception: paper artifact → `source-derived`) |
| `raw/notes/` | Human/Claude analysis notes | `llm-derived` |

### Layer 2: Wiki Knowledge (LLM maintains, user verifies)

| Directory/File | Content | Count (current) |
|---|---|---|
| `wiki/sources/` | One summary per ingested source | **142** pages |
| `wiki/concepts/` | Topic articles with wikilinks | **32** pages |
| `wiki/synthesis/` | Cross-cutting themes (post-lint only) | **12** pages |
| `wiki/entities/` | Lab/researcher/project profiles (≥3 source appearances) | **2** pages |
| `wiki/archive/` | Superseded/retracted pages | — |
| `wiki/index.md` | Master index for coarse routing | 1 |
| `wiki/dashboard.md` | Dataview dashboard (5 queries) | 1 |
| `wiki/moc-*.md` | Maps of Content (agent, peft, benchmark, adaptation, safety) | 5 |

High-frequency entities (labs, researchers) get dedicated pages in `wiki/entities/`. Lower-frequency entities use **frontmatter tags**: `author:hinton`, `method:transformer`, etc.

### Layer 3: Schema & Instructions

| File | Purpose | Loaded when |
|---|---|---|
| `CLAUDE.md` | Lean agent instructions (~71 lines) | Every request (auto) |
| `schema.md` | Full wiki schema, provenance rules, page format | On demand by skills |
| `AGENTS.md` | Codex/GPT agent instructions | Auto-loaded by Codex CLI |

## Provenance Model

5-level trust hierarchy (full rules in `schema.md`):

| Level | Trust | Can support synthesis? |
|---|---|---|
| `user-verified` | Highest | Yes |
| `source-derived` | High | Yes |
| `llm-derived` | Medium | Yes (must cite ≥2 sources) |
| `social-lead` | Low | **No** — discovery leads only |
| `query-derived` | Lowest | **No** — lives in `outputs/` only |

**Hard rule**: `query-derived` content NEVER enters `wiki/`. Synthesis requires ≥2 `source-derived` citations.

## Dual-Track Information Architecture

| Track | Sources | Provenance | Can modify concepts? |
|---|---|---|---|
| **Track A** (Social/Tool Intelligence) | Twitter, GitHub, WeChat, web | `social-lead` | No |
| **Track B** (Academic Research) | arXiv, Semantic Scholar, Zotero | `source-derived` | Yes |

Track A discovers leads; Track B provides evidence. Track A→B promotion via `tools/track-promote.ts` (explicit, never automatic).

## Operations Pipeline

### Token-Efficient Execution Pattern

Every pipeline step follows the progressive reading pattern:

```
1. noria-reader --exists  (dedup check, ~10 tokens)
2. noria-reader --brief   (RT relevance screen, ~200 tokens)
3. noria-reader --head    (section structure, ~800 tokens)
4. noria-reader --section (targeted read, variable)
5. Full read only if needed   (last resort)
```

### Phase 1 — Ingest & Compile (operational)

| Order | Command | What It Does | Key Detail |
|---|---|---|---|
| 1 | `/kb-sync` | Zotero/arXiv/S2/Twitter/WeChat/GitHub → raw/ | Multi-platform, relevance-filtered |
| 2 | `/kb-ingest` | Stage URLs/notes/PDFs → raw/ | Manual staging |
| 3 | `/kb-compile` | raw/ → wiki/sources/ + concepts/ + index.md | Manifest-gated, idempotent |
| 4 | `/kb-lint` | 7-check health gate on wiki/ | **Mandatory** before synthesis (enforced by hook) |
| 5 | `/kb-ask` | Query → synthesized answer → outputs/ | Query-derived, never enters wiki/ |

### Phase 2 — Intelligence (operational)

| Order | Command | What It Does |
|---|---|---|
| 6 | `/kb-reflect` | Cross-cutting synthesis (requires lint pass) |
| 7 | `/kb-deepen` | Read local PDFs to enrich beyond abstract level |
| 8 | `/research-lit` | Multi-source literature review (KB + arXiv + S2 + web) |
| 9 | `/kb-trending` | Discover trending papers via DeepXiv social signals |

### Phase 3 — Service (operational)

| Component | Implementation | Status |
|---|---|---|
| Remote MCP Server | `tools/noria-mcp-server.py` via SSH tunnel | Operational |
| Topic Bundle | `tools/kb-topic-bundle.ts` for external project queries | Operational |
| Obsidian Vault | Wikilink pipe syntax, Juggl typed links, Dataview | Operational |
| sigma.js Graph | `tools/kb-graph-export.ts` → standalone HTML | Operational |
| Feedback Loop | `submit_feedback` → triage → signal-index → gap scan → expand | Operational (signal-index.jsonl + demand prior) |
| Knowledge Service | `/kb-service` + `/noria-consult` cross-project protocol | Operational (service-index.jsonl + preview search + GPT review gate) |
| HTTP API | Deferred | Not started |

### All 25 Slash Commands (Claude Code Skills)

Skill files in `.claude/commands/`, loaded on demand (not in CLAUDE.md):

| Phase | Commands |
|-------|----------|
| **Ingest & Compile** | `/kb-sync`, `/kb-ingest`, `/kb-import`, `/kb-compile`, `/kb-lint` |
| **Intelligence** | `/kb-ask`, `/kb-reflect`, `/kb-deepen`, `/kb-discover`, `/kb-deep-research`, `/research-lit` |
| **Research** | `/kb-hypothesize`, `/kb-novelty-check` |
| **Flywheel** | `/kb-triage`, `/kb-gap-scan`, `/kb-expand`, `/kb-trending` |
| **Maintenance** | `/kb-merge`, `/kb-output`, `/meta-optimize` |
| **Review** | `/research-review`, `/gpt-nightmare-review`, `/plan-review-loop` |
| **Service** | `/kb-service`, `/noria-consult` (external template) |
| **Utility** | `/wiki-help`, `/agent-team-plan`, `/mermaid-diagram` |

## Tools Inventory (30 files)

### Readers (token-efficient, progressive)
| Tool | Purpose |
|---|---|
| `noria-reader.ts` | Local progressive reader (7 modes: brief/head/section/triage/search/budget/exists) |
| `deepxiv-reader.ts` | Cloud reader for 2.9M arXiv papers (zero LLM cost, 10K/day API) |

### Search & Ingestion
| Tool | Purpose |
|---|---|
| `arxiv-search.ts` | arXiv API search |
| `semantic-scholar-search.ts` | S2 Graph API (venue papers, citations, related) |
| `github-search.ts` | GitHub repos, releases, tagged search |
| `twitter-ingest.ts` | Twitter/X extraction (3-layer quality filter) |
| `twitter-scweet-bridge.py` | Scweet Python bridge for search/profile |
| `wechat-ingest.ts` | WeChat articles (Docker, 3-layer filter) |
| `zotero_sync.py` | Zotero sync (online/offline dual-path) |
| `zotero_push.py` | Push to Zotero Web API + PDF download |

### Knowledge Processing
| Tool | Purpose |
|---|---|
| `kb-lint.ts` | 8-check deterministic linter |
| `kb-gap-scan.ts` | 5-type knowledge gap detection (demand/depth/structural/frontier/audit) |
| `kb-discover.ts` | Cross-paper insight extraction (claims/questions/distances) |
| `kb-relations.ts` | Sidecar typed relation graph (10 edge types + community detection) |
| `kb-topic-bundle.ts` | External project knowledge query |
| `kb-feedback-triage.ts` | Feedback classification + signal-index.jsonl output |
| `kb-merge.ts` | Concept page merger with backlink rewiring |
| `kb-canvas.ts` | Obsidian Canvas generation |
| `kb-import.ts` | External notes importer |
| `kb-export.ts` | Provenance-filtered export |
| `kb-output.ts` | Multi-format exporter (JSONL/Marp/Report) |
| `kb-graph-export.ts` | Graph export (JSON/GraphML/HTML) |
| `kb-juggl-inject.ts` | Juggl CSS styling injection |
| `chatgpt-research-agent.ts` | ChatGPT Pro automation (Playwright-based) |

### Quality & Verification
| Tool | Purpose |
|---|---|
| `venue-verify.ts` | Venue claims verification (S2 + DBLP) |
| `track-promote.ts` | Track A→B promotion (social-lead → source-derived) |
| `relevance-filter.ts` | 3-layer pre-ingestion relevance filter |
| `backfill_metadata.py` | Metadata backfill for existing pages |

### Infrastructure
| Tool | Purpose |
|---|---|
| `noria-mcp-server.py` | Remote MCP server (search + get + feedback + gap_scan + list_concepts + graph_neighbors) |
| `qmd-reindex.ts` | QMD search index management |
| `serve-remote.sh` | SSH tunnel setup script |

## Directory Structure

```
noria/
├── CLAUDE.md              # Lean agent instructions (~71 lines)
├── schema.md              # Full wiki schema + provenance rules
├── ARCHITECTURE.md        # This file
├── AGENTS.md              # Codex/GPT agent instructions
├── log.md                 # Append-only operation log
├── raw/                   # Raw sources (user owns, LLM reads only)
│   ├── zotero/papers/     # Zotero-synced paper metadata
│   ├── arxiv/             # arXiv search results
│   ├── semantic-scholar/  # S2 search results
│   ├── twitter/           # Twitter/X posts
│   ├── wechat/            # WeChat articles
│   ├── github/            # GitHub repos/releases
│   └── notes/             # Analysis notes
├── wiki/                  # Knowledge wiki (LLM maintains)
│   ├── index.md           # Master index
│   ├── dashboard.md       # Dataview dashboard
│   ├── moc-*.md           # Maps of Content (5 MOCs)
│   ├── sources/           # 142 source summaries
│   ├── concepts/          # 32 concept articles
│   ├── synthesis/         # 12 synthesis articles
│   ├── entities/          # 2 lab/researcher profiles
│   └── archive/           # Superseded pages
├── outputs/               # Generated artifacts (NEVER fed back)
│   ├── queries/           # Q&A results (query-derived)
│   └── reviews/           # GPT/Codex review results
├── tools/                 # 30 TS/Python tools
├── docs/                  # Reference documentation
│   ├── tooling-reference.md
│   ├── agent-team-workflow.md
│   ├── remote-wiki-access.md
│   └── feedback-loop-design.md
├── .kb/                   # Internal state
│   ├── manifest.json      # Compilation state
│   ├── relations.jsonl    # Typed relation graph
│   ├── graph-features.json # Precomputed graph features for reranking
│   ├── signal-index.jsonl # Feedback demand signals (flywheel)
│   ├── communities.json   # Shared-concept community clusters
│   ├── trend-metrics.json # Frontier scores per concept
│   └── sync_state.json    # Sync state
├── .llm/                  # Multi-model agent config
│   └── agent-team.json    # Model routing rules
└── .claude/
    ├── commands/          # 23 slash command skills
    └── settings.local.json
```

## Multi-Agent Model Routing

| Role | Model | Use Case |
|---|---|---|
| **Orchestrator** | Claude Opus 4.6 | Main session: planning, synthesis, architecture |
| **Worker** (default) | Claude Sonnet 4.6 | Compile, search, deepen, code writing |
| **Triage** | Claude Haiku 4.5 | Lint, exists-check, simple reads |
| **Reviewer** | GPT-5.4 via Codex MCP | Adversarial nightmare review |

Enforced via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` (env var) + CLAUDE.md routing table.

## Zotero Integration (dual-path)

| Path | When | How | Failure domain |
|---|---|---|---|
| **Online** | Zotero running | pyzotero local API via Windows host IP:23119 | Zotero process + network |
| **Offline** | Zotero closed | Better BibTeX JSON export file | Filesystem only |

Collection-level sync supported: `--list-collections`, `--collection "Name"`, `--tag-collection "Name"`. PDF paths resolved via `zotero_sync.py --pdf-paths` (read-only SQLite query).

## Technology Stack

| Component | Technology |
|---|---|
| Wiki Engine | Claude Code (Opus 4.6 orchestrator) |
| Zotero Access | pyzotero (online) / JSON import (offline) |
| Search | QMD (BM25 + vector + RRF) via MCP |
| Literature | arXiv API + Semantic Scholar API + DeepXiv |
| Knowledge Viewer | Obsidian (Juggl + Dataview + MOC) + sigma.js HTML |
| Version Control | Git (worktree isolation for parallel work) |
| Adversarial Review | Codex CLI (GPT-5.4 xhigh) |

## Key Design Principles

1. **User owns raw/, LLM maintains wiki/** — clear ownership boundary
2. **Provenance everywhere** — every claim tagged, query-derived quarantined
3. **Lint before reflect** — deterministic checks before LLM synthesis (enforced by hook)
4. **Few directories, rich metadata** — entity types as tags, not premature taxonomy
5. **Token-efficient by default** — progressive reading, manifest gating, RT pre-screening
6. **Lean CLAUDE.md** — under 80 lines; schema and tools loaded on demand
7. **Multi-model routing** — cheapest model that can handle each task
8. **Conflicts flagged, not hidden** — contradictions surfaced explicitly
