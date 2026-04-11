# Multi-Platform Search Integration Analysis for NORIA

> Date: 2026-04-09 | Reviewers: Claude Opus 4.6 + GPT-5.4 xhigh (adversarial)
> Status: **Decided** — see Final Recommendations below
> GPT Nightmare Score: 3/10

## Context

NORIA is a provenance-tracked academic knowledge base for PhD research on "your research topic". The researcher evaluated expanding information sources beyond Semantic Scholar, arXiv, and Zotero to include GitHub, Reddit, Twitter/X, WeChat公众号, and 小红书.

## Agent-Reach Assessment

**Repository**: `Panniantong/Agent-Reach` | 16.6k stars | MIT | Python | Beta

Agent-Reach is a tool-installer + health-checker, NOT a scraping framework. It installs upstream CLI tools (twitter-cli, xhs-cli, rdt-cli etc.) and teaches LLM agents to call them. Not suitable as a NORIA dependency due to:

- No unified output format (each platform returns different structures)
- Jina Reader (`r.jina.ai`) proxies all URLs through external servers (data exfiltration)
- Exa search queries sent to external `mcp.exa.ai`
- Large dependency surface (npm/pip CLI tools)

Borrowable patterns: Exa domain-filtered WeChat search, rookiepy cookie extraction, platform coverage reference.

## Tool Maturity Assessment


| Tool                       | Maturity         | Key Finding                                                         |
| -------------------------- | ---------------- | ------------------------------------------------------------------- |
| GitHub REST API            | **Production**   | First breaking change in 2026-03; old versions supported 24+ months |
| Snoowrap (JS Reddit)       | **Abandoned**    | Archived 2024-03, 80 unresolved issues. Use PRAW or TRAW instead    |
| sogou-weixin-mcp-server    | **Experimental** | 5 stars, 1 contributor, 2 commits, zero CAPTCHA handling            |
| weixin_search_mcp          | **Alpha**        | 73 stars, better but fragile Sogou dependency                       |
| Scweet (Twitter)           | **Beta+**        | v5.0 (2026-03), X breaks scrapers every 2-4 weeks                   |
| MediaCrawler (XHS)         | **Beta**         | 47k stars but XHS permanently banning accounts (Issue #865)         |
| xiaohongshu-cli            | **Beta**         | No credential requirement (safer), but API breaks frequently        |
| Anthropic sandbox-runtime  | **Alpha**        | 0.0.x, WSL2 bugs (#31708), "research preview"                       |
| Semgrep/Gitleaks/Scorecard | **Production**   | ~1 hour setup, ~15 min/week maintenance                             |


## Signal-to-Noise by Platform


| Platform              | Actionable Signal        | Noise                   | Source       |
| --------------------- | ------------------------ | ----------------------- | ------------ |
| GitHub official repos | 10-25% (allowlisted)     | <5% broad search        | GPT estimate |
| Reddit r/ML           | 1-5% KB-actionable       | ~95%                    | GPT estimate |
| Twitter/X curated     | 3-10% as discovery leads | >90% broad              | GPT estimate |
| WeChat 机器之心等          | 5-15% China-specific     | Heavy exaggeration bias | Claude + GPT |
| 小红书                   | <1%                      | >99%                    | Both agree   |


## GPT Nightmare Review: Critical Findings

### Security Findings (7 HIGH)

1. **[HIGH] Provenance laundering already happening**: A 4-like tweet promoted to `source-derived` with `venue: "Twitter/X"` and `venue_tier: arxiv-preprint` — schema abuse, not provenance. [wiki/sources/yiliuli-2026-03-16-introducing-avenir-web-a-.md]
2. **[HIGH] kb-lint doesn't check adversarial text**: Only validates structure, not content. GitHub READMEs, Reddit posts could contain prompt injection or misleading claims that pass all 7 checks.
3. **[HIGH] Reddit Data API Terms toxic for archival KB**: On termination, Reddit requires deletion of cached content AND derived data/models.
4. **[HIGH] Existing low-quality web captures as source-derived**: cli-anything pages already in wiki/.
5. **[HIGH] sogou-weixin-mcp-server not a serious dependency**: 5 stars, 2 commits.
6. **[HIGH] Cookie-based X auth is session theft liability**: Scweet state DB leakage = live authenticated session.
7. **[HIGH] MediaCrawler is industrialized anti-detection scraping**: QR login, proxy pools, legal disclaimers — not PhD KB foundation.

### Academic Suitability Findings

- GitHub is the ONLY defensible non-academic addition, and only as narrow official-artifact lane
- FORCE11 Software Citation Principles support citing software artifacts, but NOT social media posts as technical evidence
- Social media claims should never overwrite peer-reviewed content
- `social-lead` provenance must be implemented BEFORE any new source integration

## Decisions

### Do Now

1. **Fix provenance model**: Add `social-lead` level, update kb-lint, audit existing Twitter/web pages
2. **GitHub narrow allowlist only**: Official paper repos, benchmark implementations, tagged releases

### Defer

- Reddit (API Terms deletion clause)
- WeChat (no mature tools, manual snapshots preferred)

### Abandon

- 小红书 (no research value, high ban risk)

### Maintain (no enhancement)

- Twitter/X via Scweet (fix provenance first)

## Security Tooling (Confirmed Viable)


| Tool                                 | Purpose                     | Status                                    |
| ------------------------------------ | --------------------------- | ----------------------------------------- |
| Semgrep                              | Static code scanning        | Production, use before any integration    |
| Gitleaks                             | Secret detection            | Production, pre-commit hook               |
| OpenSSF Scorecard                    | Quick repo assessment       | Production, scorecard.dev                 |
| bubblewrap (bwrap)                   | Runtime sandboxing          | Production, already installed             |
| Docker --network=none                | Network isolation           | Production, for tools needing containment |
| `npm config set ignore-scripts true` | npm supply chain protection | One-time setup                            |


Anthropic sandbox-runtime: NOT ready (0.0.x, WSL2 bugs). Use bwrap + Docker instead.

## Core Conclusion

> NORIA's strength is provenance-pure academic knowledge. Blindly expanding social media sources dilutes this advantage. The correct path: fix provenance model → add only GitHub narrow allowlist → invest in kb-deepen of existing 92 abstract-only papers.

