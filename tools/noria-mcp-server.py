#!/usr/bin/env python3
"""Lightweight NORIA MCP server — pure text search, zero ML dependencies.
Serves wiki/ content over Streamable HTTP MCP transport.
Includes submit_feedback for append-only feedback ingestion.

Usage: python3 tools/noria-mcp-server.py [port] [wiki-dir]
"""
import http.server, json, os, re, secrets, sys, uuid
from datetime import datetime, timezone

WIKI_DIR = "wiki"
OUTPUTS_DIR = "outputs/queries"
# Derived paths — computed lazily after CLI override in __main__
_PROJECT_ROOT = ""
_KB_DIR = ""
_BUNDLES_DIR = ""
VALID_FEEDBACK_KINDS = {"gap", "accuracy", "insight", "save"}
VALID_ANSWER_STATUSES = {"supported", "partial", "unsupported"}
VALID_EVIDENCE_VERIFICATION_STATUSES = {"reviewed", "verified", "disputed"}
MAX_FIELD_LEN = 2000       # per-field character limit
MAX_ARRAY_ITEMS = 20       # max wiki_pages or citekeys entries
MAX_REQUEST_BYTES = 65536  # 64KB total request size
# Simple rate limit: max submissions per minute (per server instance)
_feedback_timestamps: list = []
_evidence_query_timestamps: list = []
MAX_FEEDBACK_PER_MINUTE = 10
MAX_EVIDENCE_QUERY_PER_MINUTE = MAX_FEEDBACK_PER_MINUTE
EVIDENCE_QUERY_DEFAULT_LIMIT = 8
MAX_EVIDENCE_QUERY_LIMIT = 20
HIGH_RELEVANCE_THRESHOLD = 0.75


def _sanitize(val: str, max_len: int = MAX_FIELD_LEN) -> str:
    """Strip control chars and newlines, truncate. Prevents YAML frontmatter injection."""
    cleaned = re.sub(r'[\x00-\x1f\x7f]', ' ', str(val))  # replace ALL control chars with space
    return cleaned.strip()[:max_len]


def _sanitize_item(val: str) -> str:
    """Sanitize a single array item (citekey or wiki path). Alphanums, hyphens, dots, slashes only."""
    cleaned = _sanitize(val, 200)
    return re.sub(r'[^a-zA-Z0-9._/ -]', '', cleaned).strip()


# ── Index cache (Hermes-inspired frozen snapshot at startup) ──────────
# Pre-loads all wiki pages into memory so search doesn't hit filesystem per request.
_wiki_cache: list = []  # [{path, title, summary, content_lower, slug}]
_graph_features: dict = {}  # slug -> {centrality, bridge_score, citation_overlap, ...}
_demand_prior: dict = {}  # slug -> demand_count (from signal-index.jsonl)

def _load_graph_features():
    """Load precomputed graph features for search reranking."""
    global _graph_features
    gf_path = os.path.join(os.path.dirname(WIKI_DIR), ".kb", "graph-features.json")
    if os.path.exists(gf_path):
        import json as _json
        with open(gf_path) as fh:
            _graph_features = _json.load(fh)
        print(f"Graph features: {len(_graph_features)} pages loaded")
    else:
        print("Graph features: not found (search will use text-only ranking)")


def _load_signal_index():
    """Load signal-index.jsonl and aggregate demand counts per slug."""
    global _demand_prior
    si_path = os.path.join(os.path.dirname(WIKI_DIR), ".kb", "signal-index.jsonl")
    if not os.path.exists(si_path):
        print("Signal index: not found (demand prior disabled)")
        return
    counts = {}
    with open(si_path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            slugs = list(rec.get("anchors") or [])
            if rec.get("target"):
                slugs.append(rec["target"])
            if rec.get("topic"):
                slugs.append(rec["topic"])
            for slug in slugs:
                counts[slug] = counts.get(slug, 0) + rec.get("count", 1)
    _demand_prior = counts
    print(f"Signal index: {len(_demand_prior)} demand priors loaded")


def _build_cache():
    """Walk WIKI_DIR once, cache page metadata + lowercase content for search."""
    _wiki_cache.clear()
    for root, dirs, files in os.walk(WIKI_DIR):
        # Exclude archive/ and graph/ directories from indexing
        dirs[:] = [d for d in dirs if d not in ("archive", "graph")]
        for f in files:
            if not f.endswith(".md"):
                continue
            path = os.path.join(root, f)
            with open(path) as fh:
                content = fh.read()
            title_m = re.search(r'title:\s*"(.+?)"', content)
            title = title_m.group(1) if title_m else f
            summ_m = re.search(r'## Summary\s*\n(.+?)(?=\n##|\Z)', content, re.DOTALL)
            summary = summ_m.group(1).strip()[:500] if summ_m else content[:300]
            rel_path = os.path.relpath(path, WIKI_DIR)
            slug = os.path.splitext(f)[0]
            _wiki_cache.append({
                "path": rel_path, "title": title, "summary": summary,
                "content_lower": content.lower(), "content": content,
                "slug": slug,
            })
    print(f"Index cache: {len(_wiki_cache)} pages loaded")
    _load_graph_features()
    _load_signal_index()


def _cache_stats():
    """Count pages by type from cache paths."""
    src = sum(1 for p in _wiki_cache if p["path"].startswith("sources/"))
    con = sum(1 for p in _wiki_cache if p["path"].startswith("concepts/"))
    syn = sum(1 for p in _wiki_cache if p["path"].startswith("synthesis/"))
    return src, con, syn


def _dynamic_search_desc():
    """Generate search tool description with live stats."""
    src, con, syn = _cache_stats()
    return f"Search NORIA ({src} sources, {con} concepts, {syn} syntheses) for web-agent continual adaptation knowledge"


def search_wiki(query, limit=5):
    terms = query.lower().split()
    # Pass 1: text scoring
    candidates = []
    for page in _wiki_cache:
        text_score = sum(page["content_lower"].count(t) for t in terms)
        if text_score > 0:
            ev = _graph_features.get(page.get("slug", ""), {}).get("evidence_score", 0.3)
            candidates.append({"path": page["path"], "title": page["title"],
                               "summary": page["summary"], "slug": page.get("slug", ""),
                               "text_score": text_score, "evidence_score": ev})

    if not candidates:
        return []

    # Pre-pass: detect superseded pages (frontmatter superseded_by: [...])
    _superseded = set()
    for page in _wiki_cache:
        if "superseded_by:" in page.get("content", ""):
            m = re.search(r'superseded_by:\s*\[([^\]]+)\]', page["content"])
            if m and m.group(1).strip():
                _superseded.add(page.get("slug", ""))

    # Pass 2: Reciprocal Rank Fusion (Cormack et al. 2009, k=60)
    # Standard RRF: score = Σ 1/(k + rank_i) across independent signal rankings
    top_slugs = {c["slug"] for c in sorted(candidates, key=lambda x: -x["text_score"])[:20]}

    # Compute per-candidate signal values for independent ranking
    for c in candidates:
        feat = _graph_features.get(c["slug"], {})
        overlap = 0.0
        for peer, jaccard in feat.get("citation_overlap", {}).items():
            if peer in top_slugs:
                overlap += jaccard
        c["_overlap"] = min(overlap, 3.0)
        aa_sum = 0.0
        for peer, score in feat.get("adamic_adar", {}).items():
            if peer in top_slugs:
                aa_sum += score
        c["_aa"] = min(aa_sum, 3.0)
        c["_demand"] = min(_demand_prior.get(c["slug"], 0) / 5.0, 1.0)

    # Standard RRF with 1-based ranks; zero-signal items excluded from that signal's ranking
    k = 60

    def rrf_rank_map(signal_key):
        """Build 1-based rank map, excluding candidates with zero signal value."""
        active = [(i, candidates[i].get(signal_key, 0)) for i in range(len(candidates)) if candidates[i].get(signal_key, 0) > 0]
        active.sort(key=lambda x: -x[1])
        return {idx: rank + 1 for rank, (idx, _) in enumerate(active)}  # 1-based

    rm_text = rrf_rank_map("text_score")
    rm_overlap = rrf_rank_map("_overlap")
    rm_aa = rrf_rank_map("_aa")
    rm_demand = rrf_rank_map("_demand")

    for i, c in enumerate(candidates):
        rrf = 0.0
        # Only contribute to score if candidate appears in that signal's ranking
        if i in rm_text: rrf += 1.0 / (k + rm_text[i])
        if i in rm_overlap: rrf += 1.0 / (k + rm_overlap[i])
        if i in rm_aa: rrf += 1.0 / (k + rm_aa[i])
        if i in rm_demand: rrf += 1.0 / (k + rm_demand[i])
        c["score"] = rrf
        # Superseded pages get 30% penalty
        if c["slug"] in _superseded:
            c["score"] *= 0.7

    # Clean up internal signal fields
    for c in candidates:
        c.pop("_overlap", None)
        c.pop("_aa", None)
        c.pop("_demand", None)

    candidates.sort(key=lambda x: -x["score"])

    # Pass 3: type affinity — boost same-type pages when top-5 shows a dominant type
    type_counts = {}
    for c in candidates[:5]:
        p = c["path"]
        t = "source" if p.startswith("sources/") else "concept" if p.startswith("concepts/") else "synthesis" if p.startswith("synthesis/") else None
        if t:
            type_counts[t] = type_counts.get(t, 0) + 1
    dominant_type = max(type_counts, key=type_counts.get) if type_counts else None
    if dominant_type and type_counts.get(dominant_type, 0) >= 3:
        prefix = {"source": "sources/", "concept": "concepts/", "synthesis": "synthesis/"}[dominant_type]
        for c in candidates[5:]:
            if c["path"].startswith(prefix):
                c["score"] *= 1.05
        candidates.sort(key=lambda x: -x["score"])

    # Concept backfill: top source hits inject their linked concept/synthesis pages
    # This surfaces structural neighbors that keyword search might miss
    top_source_slugs = [c["slug"] for c in candidates[:10] if c["path"].startswith("sources/")]
    existing_slugs = {c["slug"] for c in candidates}
    backfill_cache = {p["slug"]: p for p in _wiki_cache}

    for src_slug in top_source_slugs:
        feat = _graph_features.get(src_slug, {})
        # Find concept/synthesis neighbors via citation_overlap (high Jaccard = strong link)
        for peer, jaccard in feat.get("citation_overlap", {}).items():
            if jaccard < 0.15 or peer in existing_slugs:
                continue
            peer_page = backfill_cache.get(peer)
            if not peer_page or not (peer_page["path"].startswith("concepts/") or peer_page["path"].startswith("synthesis/")):
                continue
            # Inject with a synthetic score based on the referring source's score
            ref_score = next((c["score"] for c in candidates if c["slug"] == src_slug), 0)
            candidates.append({
                "path": peer_page["path"], "title": peer_page["title"],
                "summary": peer_page["summary"], "slug": peer,
                "score": ref_score * jaccard * 0.6,  # discounted by overlap strength
                "evidence_score": _graph_features.get(peer, {}).get("evidence_score", 0.3),
            })
            existing_slugs.add(peer)

        # Adamic-Adar backfill: surface topologically close pages missed by citation overlap
        for peer, aa_score in feat.get("adamic_adar", {}).items():
            if aa_score < 0.25 or peer in existing_slugs:
                continue
            peer_page = backfill_cache.get(peer)
            if not peer_page or not (peer_page["path"].startswith("concepts/") or peer_page["path"].startswith("synthesis/")):
                continue
            ref_score = next((c["score"] for c in candidates if c["slug"] == src_slug), 0)
            candidates.append({
                "path": peer_page["path"], "title": peer_page["title"],
                "summary": peer_page["summary"], "slug": peer,
                "score": ref_score * aa_score * 0.4,  # lower discount than citation overlap
                "evidence_score": _graph_features.get(peer, {}).get("evidence_score", 0.3),
            })
            existing_slugs.add(peer)

    candidates.sort(key=lambda x: -x["score"])
    # Clean up internal fields before returning
    for c in candidates:
        c.pop("text_score", None)
        c.pop("slug", None)
    return candidates[:limit]


def _extract_frontmatter_token(content, field):
    """Extract a simple single-token frontmatter value from cached page content."""
    m = re.search(rf'^{re.escape(field)}:\s*(\S+)', content, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _strip_frontmatter(content):
    """Remove YAML frontmatter so evidence matching prefers body sections."""
    return re.sub(r'^---\n.*?\n---\n?', '', content, flags=re.DOTALL)


def _split_sections(content):
    """Split markdown body into second-level sections for section-local evidence."""
    body = _strip_frontmatter(content).strip()
    if not body:
        return []

    sections = []
    heading = "body"
    lines = []
    for line in body.splitlines():
        if line.startswith("## "):
            if lines:
                sections.append({"heading": heading, "text": "\n".join(lines).strip()})
            heading = line[3:].strip() or "body"
            lines = []
        else:
            lines.append(line)
    if lines:
        sections.append({"heading": heading, "text": "\n".join(lines).strip()})
    return sections


def _claim_terms(claim):
    """Tokenize a claim into stable keyword terms for cache-local matching."""
    stopwords = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in",
        "into", "is", "of", "on", "or", "that", "the", "their", "this", "to",
        "under", "using", "via", "with",
    }
    seen = set()
    terms = []
    for token in re.findall(r'[a-z0-9]+', claim.lower()):
        if len(token) <= 1 or token in stopwords or token in seen:
            continue
        seen.add(token)
        terms.append(token)
    return terms


def _count_term_matches(text, term):
    return len(re.findall(rf'\b{re.escape(term)}\b', text))


def _match_stats(text, terms, phrase):
    counts = {term: _count_term_matches(text, term) for term in terms}
    unique_hits = sum(1 for count in counts.values() if count > 0)
    total_hits = sum(counts.values())
    phrase_hit = 1 if phrase and phrase in text else 0
    raw_score = total_hits + (unique_hits * 2) + (phrase_hit * max(len(terms), 1))
    return {
        "counts": counts,
        "unique_hits": unique_hits,
        "total_hits": total_hits,
        "phrase_hit": phrase_hit,
        "raw_score": raw_score,
    }


def _best_matching_section(content, terms, phrase):
    best = None
    for section in _split_sections(content):
        stats = _match_stats(section["text"].lower(), terms, phrase)
        if stats["raw_score"] <= 0:
            continue
        if best is None or stats["raw_score"] > best["stats"]["raw_score"]:
            best = {"heading": section["heading"], "text": section["text"], "stats": stats}
    return best


def _evidence_relevance(page_stats, section_stats, term_count):
    term_count = max(term_count, 1)
    coverage = section_stats["unique_hits"] / term_count
    density = min(section_stats["total_hits"] / term_count, 1.0)
    phrase_bonus = 0.1 if section_stats["phrase_hit"] else 0.0
    page_bonus = min(page_stats["unique_hits"] / term_count, 1.0) * 0.1
    return round(min(1.0, (coverage * 0.55) + (density * 0.25) + phrase_bonus + page_bonus), 2)


def _first_passage(text, limit=200):
    clean = re.sub(r'\s+', ' ', text).strip()
    return clean[:limit]


def _classify_evidence_stance(claim, passage, verification_status):
    """Best-effort support/conflict routing for claim-level evidence."""
    if verification_status == "disputed":
        return "conflict"

    positive_terms = {
        "improve", "improves", "improved", "improvement", "better", "boost",
        "gain", "gains", "increase", "increases", "outperform", "outperforms",
        "recover", "recovery", "robust", "robustness", "success",
    }
    negative_terms = {
        "challenge", "challenges", "contradict", "contradiction", "degrade",
        "degrades", "degradation", "drop", "drops", "fail", "fails", "failing",
        "limited", "limitation", "limitations", "negative", "unstable", "worse",
        "without", "not",
    }

    claim_lower = claim.lower()
    passage_lower = passage.lower()
    claim_positive = sum(claim_lower.count(term) for term in positive_terms)
    claim_negative = sum(claim_lower.count(term) for term in negative_terms)
    passage_positive = sum(passage_lower.count(term) for term in positive_terms)
    passage_negative = sum(passage_lower.count(term) for term in negative_terms)

    if claim_positive > claim_negative and passage_negative > passage_positive:
        return "conflict"
    if claim_negative > claim_positive and passage_positive > passage_negative:
        return "conflict"
    return "support"


def evidence_query(claim, max_evidence=EVIDENCE_QUERY_DEFAULT_LIMIT):
    """Search reviewed wiki pages for supporting or conflicting evidence for a claim."""
    import time

    now_ts = time.time()
    _evidence_query_timestamps[:] = [t for t in _evidence_query_timestamps if now_ts - t < 60]
    if len(_evidence_query_timestamps) >= MAX_EVIDENCE_QUERY_PER_MINUTE:
        return {
            "status": "unsupported",
            "evidence": [],
            "conflicts": [],
            "coverage": {"total_matches": 0, "reviewed_matches": 0},
            "missing": ["rate limit exceeded"],
            "confidence": "low",
            "note": f"Rate limit exceeded: max {MAX_EVIDENCE_QUERY_PER_MINUTE} evidence queries per minute",
        }
    _evidence_query_timestamps.append(now_ts)

    safe_claim = _sanitize(claim)
    if not safe_claim:
        return {
            "status": "unsupported",
            "evidence": [],
            "conflicts": [],
            "coverage": {"total_matches": 0, "reviewed_matches": 0},
            "missing": ["claim is required"],
            "confidence": "low",
            "note": "Only reviewed/verified/disputed pages included.",
        }

    try:
        max_evidence = int(max_evidence)
    except (TypeError, ValueError):
        max_evidence = EVIDENCE_QUERY_DEFAULT_LIMIT
    max_evidence = max(1, min(max_evidence, MAX_EVIDENCE_QUERY_LIMIT))

    terms = _claim_terms(safe_claim)
    if not terms:
        terms = [safe_claim.lower()]
    phrase = safe_claim.lower()
    min_unique_hits = 1 if len(terms) <= 2 else 2

    support_items = []
    conflict_items = []
    total_matches = 0
    reviewed_matches = 0
    excluded_unreviewed = 0
    excluded_missing_status = 0

    for page in _wiki_cache:
        body = _strip_frontmatter(page["content"])
        page_text = f"{page.get('title', '')}\n{body}".lower()
        page_stats = _match_stats(page_text, terms, phrase)
        if page_stats["raw_score"] <= 0:
            continue
        if page_stats["unique_hits"] < min_unique_hits and not page_stats["phrase_hit"]:
            continue

        total_matches += 1
        verification_status = _extract_frontmatter_token(page["content"], "verification_status")
        if verification_status == "unreviewed":
            excluded_unreviewed += 1
            continue
        if verification_status not in VALID_EVIDENCE_VERIFICATION_STATUSES:
            excluded_missing_status += 1
            continue

        reviewed_matches += 1
        best_section = _best_matching_section(page["content"], terms, phrase)
        if not best_section:
            continue
        if best_section["stats"]["unique_hits"] < min_unique_hits and not best_section["stats"]["phrase_hit"]:
            continue

        provenance = _extract_frontmatter_token(page["content"], "provenance") or "unknown"
        passage = _first_passage(best_section["text"])
        item = {
            "slug": page["slug"],
            "title": page["title"],
            "path": page["path"],
            "provenance": provenance,
            "verification_status": verification_status,
            "relevance_score": _evidence_relevance(page_stats, best_section["stats"], len(terms)),
            "key_passage": passage,
        }
        if _classify_evidence_stance(safe_claim, passage, verification_status) == "conflict":
            conflict_items.append(item)
        else:
            support_items.append(item)

    support_items.sort(key=lambda item: -item["relevance_score"])
    conflict_items.sort(key=lambda item: -item["relevance_score"])

    evidence = support_items[:max_evidence]
    conflicts = conflict_items[:max_evidence]
    high_relevance_items = [item for item in evidence if item["relevance_score"] >= HIGH_RELEVANCE_THRESHOLD]

    if len(high_relevance_items) >= 2:
        status = "supported"
    elif evidence:
        status = "partial"
    else:
        status = "unsupported"

    if len(evidence) >= 3:
        confidence = "high"
    elif evidence:
        confidence = "medium"
    else:
        confidence = "low"

    missing = []
    if total_matches == 0:
        missing.append("no matching wiki pages found for this claim")
    elif reviewed_matches == 0:
        missing.append("matching pages exist but none are reviewed/verified/disputed")
        missing.append("no section-level evidence for this claim")
    elif not evidence and not conflicts:
        missing.append("no section-level evidence for this claim")

    excluded_note = f"{excluded_unreviewed} unreviewed pages excluded"
    if excluded_missing_status:
        excluded_note += f"; {excluded_missing_status} pages without verification_status excluded"

    return {
        "status": status,
        "evidence": evidence,
        "conflicts": conflicts,
        "coverage": {"total_matches": total_matches, "reviewed_matches": reviewed_matches},
        "missing": missing,
        "confidence": confidence,
        "note": f"Only reviewed/verified/disputed pages included. {excluded_note}.",
    }


def get_doc(path):
    # Resolve and verify the path stays within WIKI_DIR (prevents traversal)
    wiki_root = os.path.realpath(WIKI_DIR)
    full = os.path.realpath(os.path.join(WIKI_DIR, path))
    if not full.startswith(wiki_root + os.sep) and full != wiki_root:
        return f"Access denied: path must be within wiki/"
    # Try cache first
    for page in _wiki_cache:
        if page["path"] == path:
            return page["content"]
    # Fallback to filesystem (for files added after cache build)
    if os.path.exists(full) and os.path.isfile(full):
        with open(full) as f:
            return f.read()
    return f"File not found: {path}"


HELP_TEXT = """# NORIA Knowledge Service

Research topic: **Continual adaptation of web agents under UI drifts and workflow drifts**
Coverage: 116 source pages, 32 concepts, 5 syntheses, 1400+ citations

## Tools

### ask(question, max_pages=5)
Ask a research question. Returns full wiki page content with citation locators for LLM synthesis.
Best for: answering questions, finding evidence, grounding claims in literature.
Example: ask("what causes UI drift in web agents?")

### search(query, limit=5)
Keyword search across wiki. Returns titles + summaries (not full content).
Best for: quick lookup, browsing, finding specific papers.
Example: search("LoRA catastrophic forgetting")

### get(path)
Retrieve a single wiki page by path.
Best for: reading a specific page you already know about.
Example: get("sources/wei2025-webagent-r1.md"), get("concepts/ui-drift.md")

### submit_feedback(query_summary, feedback_kind, ...)
Report knowledge gaps, accuracy issues, or cross-paper insights back to NORIA.
- **gap**: wiki lacks coverage for a topic → triggers source discovery
- **accuracy**: wiki content may conflict with your findings → triggers citation audit
- **insight**: new cross-paper connection discovered → triggers synthesis candidate
Example: submit_feedback(query_summary="RL for drift recovery", feedback_kind="gap", feedback_detail="No coverage of online RL methods for real-time drift adaptation")

## Recommended Workflow
1. `ask` your research question → get cited literature context
2. Use the citations in your research/experiments
3. `submit_feedback` when you find gaps, errors, or new connections
4. Your feedback drives NORIA to expand and deepen → better answers next time

## Provenance Note
All answers from NORIA are `query-derived` and should be verified against primary sources before use in publications."""


def ask_wiki(question, max_pages=5):
    """Structured context retrieval for remote QA. Returns full page content."""
    hits = search_wiki(question, max_pages)
    if not hits:
        return "No relevant pages found for: " + question

    # Index.md routing hint: find which section of index matched
    routing_hint = ""
    for page in _wiki_cache:
        if page["path"] == "index.md":
            terms = question.lower().split()
            sections = re.split(r'\n(?=##\s)', page["content"])
            best_sec, best_score = "", 0
            for sec in sections:
                score = sum(sec.lower().count(t) for t in terms)
                if score > best_score:
                    best_score, best_sec = score, sec.split("\n")[0].strip()
            if best_sec:
                routing_hint = best_sec
            break

    # Build response with full page content
    parts = []
    if routing_hint:
        parts.append(f"**Routing**: Most relevant index section: {routing_hint}\n")
    parts.append(f"**Found {len(hits)} relevant pages** (showing full content for citation):\n")

    for i, hit in enumerate(hits):
        for page in _wiki_cache:
            if page["path"] == hit["path"]:
                parts.append(f"---\n### [{i+1}] {hit['title']} (wiki/{hit['path']}, relevance={hit['score']})\n")
                parts.append(page["content"])
                parts.append("")
                break

    # Save query record to outputs/queries/ (query-derived, maintains quarantine)
    safe_question = _sanitize(question)
    title_escaped = _sanitize(question[:80]).replace('"', "'")
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%dT%H-%M-%SZ")
    slug = re.sub(r"[^a-z0-9]+", "-", safe_question[:50].lower()).strip("-") or "ask"
    filename = f"{ts}-remote-ask-{slug}.md"
    filepath = os.path.join(OUTPUTS_DIR, filename)
    os.makedirs(OUTPUTS_DIR, exist_ok=True)
    pages_used = [f"wiki/{h['path']}" for h in hits]
    with open(filepath, "w") as f:
        f.write(f"---\ntitle: \"Remote ask: {title_escaped}\"\ntype: query\nprovenance: query-derived\n")
        f.write(f"wiki_pages: {json.dumps(pages_used)}\ncreated: {now.strftime('%Y-%m-%d')}\n---\n\n")
        f.write(f"## Question\n\n{safe_question}\n\n## Pages Retrieved\n\n")
        for h in hits:
            f.write(f"- {h['title']} (wiki/{h['path']}, score={h['score']})\n")

    # Append lightweight query signal to signal-index.jsonl for demand-prior enrichment
    si_path = os.path.join(os.path.dirname(WIKI_DIR), ".kb", "signal-index.jsonl")
    try:
        top_slug = hits[0].get("path", "").replace(".md", "").split("/")[-1] if hits else ""
        anchor_slugs = [h.get("path", "").replace(".md", "").split("/")[-1] for h in hits[:5]]
        signal = {"ts": now.strftime("%Y-%m-%d"), "kind": "query", "topic": top_slug,
                  "anchors": anchor_slugs, "count": 1}
        os.makedirs(os.path.dirname(si_path), exist_ok=True)
        with open(si_path, "a") as sf:
            sf.write(json.dumps(signal) + "\n")
    except Exception:
        pass  # signal-index is best-effort, never fail the query

    return "\n".join(parts)


def _append_service_index(record: dict):
    """Append a record to .kb/service-index.jsonl (append-only)."""
    idx_path = os.path.join(_KB_DIR, "service-index.jsonl")
    os.makedirs(_KB_DIR, exist_ok=True)
    with open(idx_path, "a") as f:
        f.write(json.dumps(record) + "\n")


def get_service_response(args):
    """Retrieve service response bundle by request_id."""
    request_id = _sanitize(args.get("request_id", ""))[:50]
    if not request_id:
        return "request_id is required"
    # Validate request_id format (srv-{hex12})
    if not re.match(r'^srv-[0-9a-f]{12}$', request_id):
        return f"Invalid request_id format: {request_id}. Expected: srv-{{hex12}}"
    # Scan outputs/bundles/ for exact token match in filename
    if not os.path.isdir(_BUNDLES_DIR):
        return f"No bundles directory found. request_id={request_id} has no response yet."
    for f in sorted(os.listdir(_BUNDLES_DIR), reverse=True):
        if f.endswith(".json") and f"-{request_id}-" in f:
            try:
                content = open(os.path.join(_BUNDLES_DIR, f)).read()
                return content
            except Exception as e:
                return f"Error reading bundle: {e}"
    return f"No response found for request_id={request_id}. It may still be processing."


def submit_feedback(args):
    """Append-only feedback ingestion. Writes to outputs/queries/ only."""
    import time

    # Rate limiting
    now_ts = time.time()
    _feedback_timestamps[:] = [t for t in _feedback_timestamps if now_ts - t < 60]
    if len(_feedback_timestamps) >= MAX_FEEDBACK_PER_MINUTE:
        return "Rate limit exceeded: max 10 submissions per minute"
    _feedback_timestamps.append(now_ts)

    # Validate feedback_kind (enum, not user-controlled)
    kind = args.get("feedback_kind", "")
    if kind not in VALID_FEEDBACK_KINDS:
        return f"Invalid feedback_kind: {kind}. Must be one of: {', '.join(sorted(VALID_FEEDBACK_KINDS))}"

    # Sanitize all user-controlled fields
    query_summary = _sanitize(args.get("query_summary", ""))
    if not query_summary:
        return "query_summary is required"

    answer_summary = _sanitize(args.get("answer_summary", ""))
    feedback_detail = _sanitize(args.get("feedback_detail", ""))
    answer_status = args.get("answer_status", "partial")
    if answer_status not in VALID_ANSWER_STATUSES:
        answer_status = "partial"

    # New service fields (optional, logging/metadata only)
    origin_project = _sanitize(args.get("origin_project", ""))[:100]
    severity_hint = args.get("severity_hint", "feedback")
    if severity_hint not in ("lookup", "feedback", "direction_change"):
        severity_hint = "feedback"

    # Sanitize array fields — strict character whitelist
    wiki_pages = [_sanitize_item(p) for p in (args.get("wiki_pages") or [])[:MAX_ARRAY_ITEMS] if _sanitize_item(p)]
    citekeys = [_sanitize_item(c) for c in (args.get("citekeys") or [])[:MAX_ARRAY_ITEMS] if _sanitize_item(c)]

    # Generate request_id (server-side, high-entropy, non-guessable)
    request_id = f"srv-{secrets.token_hex(6)}"

    # Generate safe filename — server-controlled, no path traversal
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%dT%H-%M-%SZ")
    slug = re.sub(r"[^a-z0-9]+", "-", query_summary[:50].lower()).strip("-") or "feedback"
    filename = f"{ts}-remote-{slug}.md"
    filepath = os.path.join(OUTPUTS_DIR, filename)

    # Ensure outputs/queries/ exists
    os.makedirs(OUTPUTS_DIR, exist_ok=True)

    # Prevent overwrite (should never happen with timestamp, but be safe)
    if os.path.exists(filepath):
        filename = f"{ts}-remote-{slug}-{uuid.uuid4().hex[:6]}.md"
        filepath = os.path.join(OUTPUTS_DIR, filename)

    # Build frontmatter using JSON for arrays (injection-safe)
    wp_yaml = json.dumps(wiki_pages)   # ["a", "b"] — valid YAML
    ck_yaml = json.dumps(citekeys)
    title_escaped = query_summary[:80].replace('"', "'")

    lines = [
        "---",
        f'title: "Remote feedback: {title_escaped}"',
        "type: query",
        "provenance: query-derived",
        f"feedback_kind: {kind}",
        f"request_id: {request_id}",
        "review_status: pending",
        f"answer_status: {answer_status}",
        f"wiki_pages: {wp_yaml}",
        f"citekeys: {ck_yaml}",
    ]
    if origin_project:
        lines.append(f"origin_project: {origin_project}")
    if severity_hint != "feedback":
        lines.append(f"severity_hint: {severity_hint}")
    lines += [
        f"created: {now.strftime('%Y-%m-%d')}",
        f"updated: {now.strftime('%Y-%m-%d')}",
        "---",
        "",
        "## Question Summary",
        "",
        query_summary,
        "",
        "## Answer Summary",
        "",
        answer_summary or "(not provided)",
        "",
        "## Citations Used",
        "",
    ]
    for ck in citekeys:
        lines.append(f"- [source: {ck}]")
    if not citekeys:
        lines.append("(none)")
    lines += [
        "",
        "## Feedback",
        "",
        feedback_detail or f"[{kind}] No additional detail provided.",
        "",
    ]

    with open(filepath, "w") as f:
        f.write("\n".join(lines) + "\n")

    # Append to service-index (pending record with feedback_file as join key)
    _append_service_index({
        "request_id": request_id,
        "feedback_file": filename,
        "origin_project": origin_project or "unknown",
        "status": "pending",
        "created": now.isoformat(),
    })

    return f"Feedback saved: {filename} (kind={kind}, request_id={request_id})"


def list_concepts():
    """Return all concept pages with metadata for external agents."""
    concepts = []
    for page in _wiki_cache:
        if not page["path"].startswith("concepts/"):
            continue
        feat = _graph_features.get(page["slug"], {})
        concepts.append({
            "slug": page["slug"],
            "title": page["title"],
            "path": page["path"],
            "summary": page["summary"][:200],
            "centrality": feat.get("centrality", 0),
            "bridge_score": feat.get("bridge_score", 0),
            "demand": _demand_prior.get(page["slug"], 0),
        })
    concepts.sort(key=lambda c: -c["centrality"])
    return concepts


def graph_neighbors(slug, depth=1):
    """Return graph neighbors for a page slug from relations.jsonl."""
    rel_path = os.path.join(os.path.dirname(WIKI_DIR), ".kb", "relations.jsonl")
    if not os.path.exists(rel_path):
        return {"error": "relations.jsonl not found"}
    rels = []
    with open(rel_path) as fh:
        for line in fh:
            if line.strip():
                try:
                    rels.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    # BFS to requested depth
    visited = {slug}
    frontier = [slug]
    edges = []
    for _ in range(depth):
        next_frontier = []
        for node in frontier:
            for r in rels:
                if r["source"] == node and r["target"] not in visited:
                    visited.add(r["target"])
                    next_frontier.append(r["target"])
                    edges.append({"source": r["source"], "target": r["target"], "type": r.get("type", "related")})
                elif r["target"] == node and r["source"] not in visited:
                    visited.add(r["source"])
                    next_frontier.append(r["source"])
                    edges.append({"source": r["source"], "target": r["target"], "type": r.get("type", "related")})
        frontier = next_frontier
    # Enrich nodes with titles
    slug_title = {p["slug"]: p["title"] for p in _wiki_cache}
    nodes = [{"slug": s, "title": slug_title.get(s, s)} for s in visited]
    return {"nodes": nodes, "edges": edges}


def gap_scan():
    """Run lightweight gap scan using cached data (no subprocess)."""
    gaps = []
    # Demand gaps from signal index
    topic_counts = {}
    si_path = os.path.join(os.path.dirname(WIKI_DIR), ".kb", "signal-index.jsonl")
    if os.path.exists(si_path):
        with open(si_path) as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("kind") == "gap" and rec.get("topic"):
                    topic_counts[rec["topic"]] = topic_counts.get(rec["topic"], 0) + rec.get("count", 1)
    for topic, count in topic_counts.items():
        if count >= 3:
            gaps.append({"type": "demand", "severity": "HIGH" if count >= 5 else "MEDIUM",
                         "description": f'"{topic}" has {count} gap reports', "action": f'/kb-sync s2 "{topic}"'})

    # Depth gaps: abstract-only sources linked to ≥3 concepts
    concept_slugs = {p["slug"] for p in _wiki_cache if p["path"].startswith("concepts/")}
    for page in _wiki_cache:
        if not page["path"].startswith("sources/"):
            continue
        if "[source:" in page["content"] and "sec." in page["content"]:
            continue  # has section-level citations, not abstract-only
        feat = _graph_features.get(page["slug"], {})
        n_concepts = sum(1 for peer in feat.get("citation_overlap", {}) if peer in concept_slugs)
        if n_concepts >= 3:
            gaps.append({"type": "depth", "severity": "MEDIUM",
                         "description": f'{page["slug"]} is abstract-only but linked to {n_concepts} concepts',
                         "action": f'/kb-deepen {page["slug"]}'})

    # Structural gaps: concept pairs sharing ≥3 sources but no synthesis bridge
    synthesis_slugs = {p["slug"] for p in _wiki_cache if p["path"].startswith("synthesis/")}
    concepts = [p for p in _wiki_cache if p["path"].startswith("concepts/")]
    for i in range(len(concepts)):
        for j in range(i + 1, len(concepts)):
            a_co = set(_graph_features.get(concepts[i]["slug"], {}).get("citation_overlap", {}).keys())
            b_co = set(_graph_features.get(concepts[j]["slug"], {}).get("citation_overlap", {}).keys())
            shared = len(a_co & b_co)
            if shared >= 3:
                # Check if any synthesis bridges both
                bridged = any(
                    concepts[i]["slug"] in _graph_features.get(s, {}).get("citation_overlap", {}) and
                    concepts[j]["slug"] in _graph_features.get(s, {}).get("citation_overlap", {})
                    for s in synthesis_slugs
                )
                if not bridged:
                    gaps.append({"type": "structural", "severity": "HIGH" if shared >= 5 else "MEDIUM",
                                 "description": f'{concepts[i]["slug"]} and {concepts[j]["slug"]} share {shared} overlap peers but no synthesis bridges them',
                                 "action": f'/kb-reflect'})

    gaps.sort(key=lambda g: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(g["severity"], 3))
    return gaps


class MCPHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_REQUEST_BYTES:
            self._json({"jsonrpc": "2.0", "error": {"code": -32600, "message": "Request too large (max 64KB)"}, "id": None}, "")
            return
        body = json.loads(self.rfile.read(length)) if length else {}
        method = body.get("method", "")
        params = body.get("params", {})
        req_id = body.get("id")
        session_id = self.headers.get("mcp-session-id") or str(uuid.uuid4())

        if method == "initialize":
            result = {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "noria", "version": "1.0.0"},
            }
            self._json({"jsonrpc": "2.0", "result": result, "id": req_id}, session_id)
        elif method == "notifications/initialized":
            self._json({"jsonrpc": "2.0", "result": None, "id": req_id}, session_id)
        elif method == "tools/list":
            tools = [
                {
                    "name": "help",
                    "description": "Show NORIA usage guide: available tools, workflow, and examples",
                    "inputSchema": {"type": "object", "properties": {}},
                },
                {
                    "name": "search",
                    "description": _dynamic_search_desc(),
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "limit": {"type": "integer", "description": "Max results (default 5)"},
                        },
                        "required": ["query"],
                    },
                },
                {
                    "name": "get",
                    "description": "Get full content of a wiki page by relative path (e.g. sources/wei2025-webagent-r1.md)",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                },
                {
                    "name": "ask",
                    "description": "Ask a research question — returns relevant wiki pages with FULL content for LLM synthesis and citation. Auto-logs query for feedback tracking. Use this instead of search+get when you need to answer a question.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string", "description": "Research question to answer from the wiki"},
                            "max_pages": {"type": "integer", "description": "Max pages to return (default 5, max 10)"},
                        },
                        "required": ["question"],
                    },
                },
                {
                    "name": "evidence_query",
                    "description": "Find reviewed evidence supporting or opposing a claim. Returns only reviewed/verified/disputed pages with provenance metadata and coverage counts.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "claim": {"type": "string", "description": "Claim to test against reviewed wiki evidence"},
                            "max_evidence": {"type": "integer", "description": "Max evidence items to return per stance (default 8, max 20)"},
                        },
                        "required": ["claim"],
                    },
                },
                {
                    "name": "submit_feedback",
                    "description": "Submit feedback on a wiki query (gap/accuracy/insight/save). Append-only to outputs/queries/.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query_summary": {"type": "string", "description": "Brief summary of the question asked"},
                            "answer_summary": {"type": "string", "description": "Brief summary of the answer received"},
                            "feedback_kind": {"type": "string", "enum": ["gap", "accuracy", "insight", "save"],
                                "description": "gap=wiki lacks coverage, accuracy=wiki content may be wrong, insight=new cross-paper connection, save=this Q&A is valuable enough to consider promoting to a concept/synthesis page"},
                            "feedback_detail": {"type": "string", "description": "Additional detail about the feedback"},
                            "wiki_pages": {"type": "array", "items": {"type": "string"}, "description": "Wiki pages consulted"},
                            "citekeys": {"type": "array", "items": {"type": "string"}, "description": "Source citekeys referenced"},
                            "answer_status": {"type": "string", "enum": ["supported", "partial", "unsupported"],
                                "description": "How well the wiki supported the answer"},
                            "origin_project": {"type": "string", "description": "Submitting project name (metadata/logging only)"},
                            "severity_hint": {"type": "string", "enum": ["lookup", "feedback", "direction_change"],
                                "description": "Client hint (logging only, does not affect NORIA review routing)"},
                        },
                        "required": ["query_summary", "feedback_kind"],
                    },
                },
                {
                    "name": "get_service_response",
                    "description": "Retrieve a service response bundle by request_id (returned from submit_feedback).",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "request_id": {"type": "string", "description": "The request_id returned by submit_feedback"},
                        },
                        "required": ["request_id"],
                    },
                },
                {
                    "name": "list_concepts",
                    "description": "List all concept pages with centrality, bridge score, and demand counts. Use for knowledge landscape overview.",
                    "inputSchema": {"type": "object", "properties": {}},
                },
                {
                    "name": "graph_neighbors",
                    "description": "Get graph neighbors for a wiki page (sources, concepts, synthesis linked via relations). Returns nodes + typed edges.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "slug": {"type": "string", "description": "Page slug (e.g. 'web-agent', 'qi2025-webrl')"},
                            "depth": {"type": "integer", "description": "BFS depth (default 1, max 3)"},
                        },
                        "required": ["slug"],
                    },
                },
                {
                    "name": "gap_scan",
                    "description": "Detect knowledge gaps: demand (queried but uncovered), depth (abstract-only high-connection sources), structural (concept pairs sharing sources but no synthesis bridge).",
                    "inputSchema": {"type": "object", "properties": {}},
                },
                {
                    "name": "refresh",
                    "description": "Hot-reload wiki cache after content changes. Returns updated page counts.",
                    "inputSchema": {"type": "object", "properties": {}},
                },
                {
                    "name": "topic",
                    "description": "Get structured topic overview: matching concepts, supporting sources, open questions. Higher-level than search — aggregates by theme.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "topic": {"type": "string", "description": "Topic to query (e.g. 'ui drift', 'LoRA', 'agent safety')"},
                        },
                        "required": ["topic"],
                    },
                },
            ]
            self._json({"jsonrpc": "2.0", "result": {"tools": tools}, "id": req_id}, session_id)
        elif method == "tools/call":
            name = params.get("name", "")
            args = params.get("arguments", {})
            if name == "help":
                content = [{"type": "text", "text": HELP_TEXT}]
            elif name == "search":
                hits = search_wiki(args.get("query", ""), args.get("limit", 5))
                text = "\n\n".join(
                    f"**{r['title']}** (wiki/{r['path']}, relevance={r['score']})\n{r['summary']}"
                    for r in hits
                )
                content = [{"type": "text", "text": text or "No results found."}]
            elif name == "get":
                content = [{"type": "text", "text": get_doc(args.get("path", ""))}]
            elif name == "ask":
                mp = min(int(args.get("max_pages", 5)), 10)
                result_text = ask_wiki(args.get("question", ""), mp)
                content = [{"type": "text", "text": result_text}]
            elif name == "evidence_query":
                result = evidence_query(args.get("claim", ""), args.get("max_evidence", EVIDENCE_QUERY_DEFAULT_LIMIT))
                content = [{"type": "text", "text": json.dumps(result, indent=2)}]
            elif name == "submit_feedback":
                result_text = submit_feedback(args)
                content = [{"type": "text", "text": result_text}]
            elif name == "get_service_response":
                result_text = get_service_response(args)
                content = [{"type": "text", "text": result_text}]
            elif name == "list_concepts":
                concepts = list_concepts()
                text = f"**{len(concepts)} concepts** (sorted by centrality):\n\n"
                text += "\n".join(f"- **{c['title']}** ({c['slug']}) centrality={c['centrality']}, bridge={c['bridge_score']}, demand={c['demand']}" for c in concepts)
                content = [{"type": "text", "text": text}]
            elif name == "graph_neighbors":
                slug = _sanitize(args.get("slug", ""), 200)
                depth = min(int(args.get("depth", 1)), 3)
                result = graph_neighbors(slug, depth)
                content = [{"type": "text", "text": json.dumps(result, indent=2)}]
            elif name == "gap_scan":
                gaps = gap_scan()
                if gaps:
                    text = f"**{len(gaps)} gaps found:**\n\n"
                    text += "\n".join(f"- [{g['severity']}] ({g['type']}) {g['description']}\n  Action: {g['action']}" for g in gaps)
                else:
                    text = "No gaps detected."
                content = [{"type": "text", "text": text}]
            elif name == "refresh":
                old_count = len(_wiki_cache)
                _build_cache()
                src, con, syn = _cache_stats()
                content = [{"type": "text", "text": f"Cache refreshed: {len(_wiki_cache)} pages ({src} sources, {con} concepts, {syn} syntheses). Was {old_count} pages."}]
            elif name == "topic":
                import subprocess
                topic_q = _sanitize(args.get("topic", ""), 200)
                try:
                    result = subprocess.run(
                        ["npx", "tsx", "tools/kb-topic-bundle.ts", topic_q, "--format", "json"],
                        capture_output=True, text=True, timeout=30,
                    )
                    content = [{"type": "text", "text": result.stdout or result.stderr or "No output"}]
                except subprocess.TimeoutExpired:
                    content = [{"type": "text", "text": "Topic query timed out (30s limit)"}]
                except Exception as e:
                    content = [{"type": "text", "text": f"Topic query error: {e}"}]
            else:
                content = [{"type": "text", "text": f"Unknown tool: {name}"}]
            self._json({"jsonrpc": "2.0", "result": {"content": content}, "id": req_id}, session_id)
        else:
            self._json(
                {"jsonrpc": "2.0", "error": {"code": -32601, "message": f"Unknown: {method}"}, "id": req_id},
                session_id,
            )

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"NORIA MCP server running\n")

    def _json(self, obj, session_id):
        data = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("mcp-session-id", session_id)
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3849
    if len(sys.argv) > 2:
        WIKI_DIR = sys.argv[2]
    # Compute derived paths AFTER WIKI_DIR override
    _PROJECT_ROOT = os.path.dirname(os.path.abspath(WIKI_DIR))
    _KB_DIR = os.path.join(_PROJECT_ROOT, ".kb")
    _BUNDLES_DIR = os.path.join(_PROJECT_ROOT, "outputs", "bundles")
    print(f"NORIA MCP server on :{port} wiki={WIKI_DIR} kb={_KB_DIR}")
    _build_cache()
    http.server.HTTPServer(("127.0.0.1", port), MCPHandler).serve_forever()
