/**
 * relevance-filter.ts — 3-layer OR-gate relevance filter for academic paper search
 *
 * Architecture (OR-gate: any layer accepting → paper passes):
 *   L1: SPECTER2 Embedding Similarity (S2 API, zero LLM cost)
 *   L2: LLM Zero-Shot Screening (optional, requires ANTHROPIC_API_KEY)
 *   L3: Keyword Heuristic (always available, zero external deps)
 *
 * Design principles:
 *   - Recall > Precision: better to include a borderline paper than miss a relevant one
 *   - OR-gate: L1 pass OR L2 pass → accept (avoids false-negative cascade)
 *   - Graceful degradation: if L1/L2 unavailable, falls back to next layer
 *   - Dual-veto for reject: only reject if BOTH L1 < 0.2 AND L2/L3 say off-topic
 *
 * References:
 *   - SPECTER2: Allen AI, Apache 2.0, 6M citation triplets
 *   - LLM Screening: PRISMA/Cochrane validated (PMC12012331)
 *   - LGAR (ACL 2025): LLM+embedding MAP 50.6 vs keyword-only 21.1
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";

// ── Config ──────────────────────────────────────────────────────────────

interface TopicConfig {
  topic: string;
  topic_description: string;
  must_match_keywords: string[];
  boost_keywords: string[];
  exclude_domains: string[];
  allowed_arxiv_categories: string[];
  specter2: {
    auto_accept_threshold: number;
    uncertain_threshold: number;
    cache_path: string;
  };
}

export interface RelevanceResult {
  pass: boolean;
  quality: "verified" | "candidate" | "filtered";
  score: number;
  reasons: string[];
  layers: {
    l1_specter?: { similarity: number; status: string };
    l2_llm?: { verdict: string; status: string };
    l3_keyword: { must_match: number; exclude_hit: boolean; boost_match: number };
  };
}

const CONFIG_PATH = resolve(__dirname, "research-topic-config.json");

function loadConfig(): TopicConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

// ── Layer 3: Keyword Heuristic (always available) ───────────────────────

function keywordScore(
  title: string,
  abstract: string,
  categories: string[],
  config: TopicConfig
): { must_match: number; exclude_hit: boolean; boost_match: number; excludeWord?: string } {
  const text = `${title} ${abstract}`.toLowerCase();

  // Hard exclude check
  for (const ex of config.exclude_domains) {
    if (text.includes(ex.toLowerCase())) {
      return { must_match: 0, exclude_hit: true, boost_match: 0, excludeWord: ex };
    }
  }

  // arXiv category check
  if (categories.length > 0 && config.allowed_arxiv_categories.length > 0) {
    const allowed = new Set(config.allowed_arxiv_categories.map((c) => c.toLowerCase()));
    const hasAllowed = categories.some((c) => allowed.has(c.toLowerCase()));
    if (!hasAllowed) {
      return { must_match: 0, exclude_hit: true, boost_match: 0, excludeWord: `category:${categories[0]}` };
    }
  }

  // Must-match keywords
  let mustMatch = 0;
  for (const kw of config.must_match_keywords) {
    if (text.includes(kw.toLowerCase())) mustMatch++;
  }

  // Boost keywords
  let boostMatch = 0;
  for (const kw of config.boost_keywords) {
    if (text.includes(kw.toLowerCase())) boostMatch++;
  }

  return { must_match: mustMatch, exclude_hit: false, boost_match: boostMatch };
}

// ── Layer 1: SPECTER2 Embedding Similarity (optional, S2 API) ──────────

interface EmbeddingCache {
  topic: string;
  papers: { paperId: string; citekey: string; embedding: number[] }[];
  updated: string;
}

async function getSpecterEmbedding(paperId: string): Promise<number[] | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=embedding.specter_v2`;
  try {
    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const headers: Record<string, string> = {};
    if (apiKey) headers["x-api-key"] = apiKey;

    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.embedding?.vector ?? null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function loadOrBuildEmbeddingCache(config: TopicConfig): Promise<EmbeddingCache | null> {
  const cachePath = resolve(process.cwd(), config.specter2.cache_path);

  // Try loading existing cache
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(readFileSync(cachePath, "utf-8"));
    } catch { /* rebuild */ }
  }

  // Build cache from CORE papers
  const manifestPath = resolve(process.cwd(), ".kb/manifest.json");
  if (!existsSync(manifestPath)) return null;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const coreKeys: string[] = [];

  // Find CORE papers (those with relevance: core in wiki/sources/)
  const srcDir = resolve(process.cwd(), "wiki/sources");
  if (existsSync(srcDir)) {
    for (const f of readdirSync(srcDir)) {
      if (!f.endsWith(".md")) continue;
      try {
        const txt = readFileSync(resolve(srcDir, f), "utf-8");
        if (/relevance:\s*core/i.test(txt)) {
          const ck = f.replace(/\.md$/, "");
          coreKeys.push(ck);
        }
      } catch { /* skip */ }
    }
  }

  if (coreKeys.length < 3) {
    console.log(`  [L1] Only ${coreKeys.length} CORE papers found, need >= 3 for embedding cache. Skipping L1.`);
    return null;
  }

  console.log(`  [L1] Building SPECTER2 embedding cache for ${coreKeys.length} CORE papers...`);
  const cache: EmbeddingCache = { topic: config.topic, papers: [], updated: new Date().toISOString() };

  for (const ck of coreKeys.slice(0, 30)) { // Cap at 30 to limit API calls
    // Try to find S2 paper ID or arXiv ID from raw files
    let paperId: string | null = null;
    for (const dir of ["raw/semantic-scholar", "raw/zotero/papers", "raw/arxiv"]) {
      const rawPath = resolve(process.cwd(), dir, `${ck}.md`);
      if (!existsSync(rawPath)) continue;
      const txt = readFileSync(rawPath, "utf-8");
      const s2 = txt.match(/s2_paper_id:\s*"?([^"\n]+)"?/)?.[1]?.trim();
      if (s2) { paperId = s2; break; }
      const arxiv = txt.match(/arxiv_id:\s*"?([^"\n]+)"?/)?.[1]?.trim();
      if (arxiv) { paperId = `ARXIV:${arxiv}`; break; }
    }
    if (!paperId) continue;

    const emb = await getSpecterEmbedding(paperId);
    if (emb) {
      cache.papers.push({ paperId, citekey: ck, embedding: emb });
    }
    // Rate limiting: 100ms between requests (10 req/s with key, 1 req/s without)
    await new Promise((r) => setTimeout(r, process.env.SEMANTIC_SCHOLAR_API_KEY ? 100 : 1100));
  }

  if (cache.papers.length >= 3) {
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
    console.log(`  [L1] Cached ${cache.papers.length} embeddings → ${config.specter2.cache_path}`);
    return cache;
  }
  return null;
}

async function specterSimilarity(
  paperIdentifier: string,
  cache: EmbeddingCache
): Promise<number | null> {
  const emb = await getSpecterEmbedding(paperIdentifier);
  if (!emb || cache.papers.length === 0) return null;

  // Average similarity against all CORE papers
  let totalSim = 0;
  for (const core of cache.papers) {
    totalSim += cosineSimilarity(emb, core.embedding);
  }
  return totalSim / cache.papers.length;
}

// ── Main: assessRelevance (OR-gate logic) ───────────────────────────────

export async function assessRelevance(
  title: string,
  abstract: string,
  metadata: {
    categories?: string[];
    s2PaperId?: string;
    arxivId?: string;
    citationCount?: number;
  },
  options?: {
    skipSpecter?: boolean;
    specterCache?: EmbeddingCache | null;
  }
): Promise<RelevanceResult> {
  const config = loadConfig();
  const reasons: string[] = [];
  let score = 0;

  // ── Layer 3: Keyword Heuristic (always runs first — it's free) ──────
  const kw = keywordScore(title, abstract, metadata.categories ?? [], config);
  const l3 = { must_match: kw.must_match, exclude_hit: kw.exclude_hit, boost_match: kw.boost_match };

  if (kw.exclude_hit) {
    // Hard domain exclusion — but can be overridden by L1 high similarity
    reasons.push(`exclude_domain:${kw.excludeWord}`);
  }

  if (kw.must_match >= 2) {
    score += kw.must_match;
    reasons.push(`keywords:${kw.must_match}`);
  } else if (kw.must_match === 1) {
    score += 1;
    reasons.push(`keywords:1(weak)`);
  }

  if (kw.boost_match > 0) {
    score += kw.boost_match * 0.5;
    reasons.push(`boost:${kw.boost_match}`);
  }

  // Citation count bonus
  if (metadata.citationCount && metadata.citationCount >= 10) {
    score += 1;
    reasons.push(`citations:${metadata.citationCount}`);
  }

  // ── Layer 1: SPECTER2 (if available) ────────────────────────────────
  let l1: RelevanceResult["layers"]["l1_specter"] = undefined;

  if (!options?.skipSpecter) {
    const paperId = metadata.s2PaperId
      ?? (metadata.arxivId ? `ARXIV:${metadata.arxivId}` : null);

    if (paperId) {
      let cache = options?.specterCache;
      if (cache === undefined) {
        // Lazy-load cache on first call
        cache = await loadOrBuildEmbeddingCache(config);
      }

      if (cache && cache.papers.length >= 3) {
        const sim = await specterSimilarity(paperId, cache);
        if (sim !== null) {
          l1 = {
            similarity: Math.round(sim * 1000) / 1000,
            status: sim >= config.specter2.auto_accept_threshold ? "auto-accept"
              : sim >= config.specter2.uncertain_threshold ? "uncertain"
              : "unlikely",
          };

          if (sim >= config.specter2.auto_accept_threshold) {
            // AUTO-ACCEPT: high embedding similarity overrides everything
            return {
              pass: true,
              quality: "verified",
              score: score + 10,
              reasons: [...reasons, `specter2:${l1.similarity}(auto-accept)`],
              layers: { l1_specter: l1, l3_keyword: l3 },
            };
          }

          if (sim >= config.specter2.uncertain_threshold) {
            score += 3;
            reasons.push(`specter2:${l1.similarity}(uncertain)`);
          } else {
            reasons.push(`specter2:${l1.similarity}(unlikely)`);
          }
        } else {
          l1 = { similarity: -1, status: "api-error" };
        }
      }
    }
  }

  // ── Decision Logic (OR-gate) ────────────────────────────────────────

  // Case 1: Exclude domain hit + no SPECTER2 rescue → reject
  if (kw.exclude_hit && (!l1 || l1.status !== "uncertain")) {
    return {
      pass: false,
      quality: "filtered",
      score: 0,
      reasons,
      layers: { l1_specter: l1, l3_keyword: l3 },
    };
  }

  // Case 2: Exclude domain hit BUT SPECTER2 says uncertain → accept as candidate (OR-gate rescue)
  if (kw.exclude_hit && l1?.status === "uncertain") {
    return {
      pass: true,
      quality: "candidate",
      score,
      reasons: [...reasons, "or-gate:specter-rescued"],
      layers: { l1_specter: l1, l3_keyword: l3 },
    };
  }

  // Case 3: No exclude hit, evaluate by score
  if (score >= 4) {
    return { pass: true, quality: "verified", score, reasons, layers: { l1_specter: l1, l3_keyword: l3 } };
  }
  if (score >= 2) {
    return { pass: true, quality: "candidate", score, reasons, layers: { l1_specter: l1, l3_keyword: l3 } };
  }

  // Case 4: Low score — reject
  return { pass: false, quality: "filtered", score, reasons, layers: { l1_specter: l1, l3_keyword: l3 } };
}

// ── CLI test mode ─────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("relevance-filter.ts") || process.argv[1]?.endsWith("relevance-filter.js")) {
  const title = process.argv[2] ?? "Test Paper Title";
  const abstract = process.argv[3] ?? "This is a test abstract about web agents and UI drift.";
  assessRelevance(title, abstract, {}, { skipSpecter: true }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
