#!/usr/bin/env npx tsx
/**
 * DeepXiv API Reader — Cloud progressive reading for arXiv papers.
 *
 * Complements noria-reader.ts (local) with DeepXiv cloud API:
 *   - Covers all 2.9M arXiv papers (even without local PDF)
 *   - Progressive reading: brief → head → section → raw
 *   - Trending discovery via Twitter social signals
 *   - BGE-m3 + BM25 hybrid search
 *
 * Free: 1000 req/day anonymous, 10000/day with registration.
 * Zero LLM token cost — all processing on DeepXiv servers.
 *
 * Usage:
 *   npx tsx tools/deepxiv-reader.ts --brief <arxiv_id>
 *   npx tsx tools/deepxiv-reader.ts --head <arxiv_id>
 *   npx tsx tools/deepxiv-reader.ts --section <arxiv_id> <section-name>
 *   npx tsx tools/deepxiv-reader.ts --search "query" [--limit N] [--mode hybrid|bm25|vector]
 *   npx tsx tools/deepxiv-reader.ts --trending [--days 7|14|30] [--limit N] [--filter]
 *   npx tsx tools/deepxiv-reader.ts --raw <arxiv_id>
 *   npx tsx tools/deepxiv-reader.ts --health
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DEEPXIV = resolve(ROOT, "raw", "deepxiv");
const CONFIG_PATH = resolve(ROOT, "tools", "research-topic-config.json");

// Load .env
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const DEEPXIV_TOKEN = process.env.DEEPXIV_TOKEN ?? "";
const BASE_URL = "https://data.rag.ac.cn";
const TRENDING_URL = "https://api.rag.ac.cn/trending_arxiv_papers/api/trending";

// ── API Client ─────────────────────────────────────────────────────────
async function dxFetch(url: string, retries = 2): Promise<any> {
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (DEEPXIV_TOKEN) headers["Authorization"] = `Bearer ${DEEPXIV_TOKEN}`;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 429) {
        // Return null instead of exiting — let caller handle gracefully
        return null;
      }
      if (!res.ok) throw new Error(`DeepXiv ${res.status}: ${res.statusText}`);
      return res.json();
    } catch (e: any) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ── RT Relevance Filter (reused from noria-reader pattern) ────────
function loadRTConfig(): { must: string[]; boost: string[]; exclude: string[] } {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  return {
    must: (raw.must_match_keywords ?? []).map((k: string) => k.toLowerCase()),
    boost: (raw.boost_keywords ?? []).map((k: string) => k.toLowerCase()),
    exclude: (raw.exclude_domains ?? []).map((k: string) => k.toLowerCase()),
  };
}

function matchKw(text: string, kw: string): boolean {
  if (kw.length <= 4) {
    return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i").test(text);
  }
  return text.includes(kw);
}

function rtFilter(title: string, tldr: string, keywords: string[]): { pass: boolean; level: string; emoji: string; matches: string[] } {
  const text = `${title} ${tldr} ${keywords.join(" ")}`.toLowerCase();
  const cfg = loadRTConfig();
  const mustHits = cfg.must.filter(k => matchKw(text, k));
  const boostHits = cfg.boost.filter(k => matchKw(text, k));
  const excludeHits = cfg.exclude.filter(k => matchKw(text, k));

  if (excludeHits.length > 0 && mustHits.length === 0) return { pass: false, level: "off-topic", emoji: "❌", matches: [] };
  if (mustHits.length >= 2 || boostHits.length >= 1) return { pass: true, level: "core", emoji: "✅", matches: [...mustHits, ...boostHits] };
  if (mustHits.length === 1) return { pass: true, level: "peripheral", emoji: "🔶", matches: mustHits };
  return { pass: false, level: "off-topic", emoji: "❌", matches: [] };
}

// ── Commands ───────────────────────────────────────────────────────────
async function cmdBrief(arxivId: string) {
  const data = await dxFetch(`${BASE_URL}/arxiv/?type=brief&arxiv_id=${arxivId}`);
  console.log(`title: ${data.title}`);
  console.log(`arxiv: ${data.arxiv_id}`);
  console.log(`published: ${data.publish_at?.split("T")[0] ?? "?"}`);
  console.log(`citations: ${data.citations ?? "?"}`);
  if (data.github_url) console.log(`github: ${data.github_url}`);
  console.log(`tldr: ${data.tldr ?? "(none)"}`);
  if (data.keywords?.length) console.log(`keywords: ${data.keywords.join(", ")}`);
}

async function cmdHead(arxivId: string) {
  const data = await dxFetch(`${BASE_URL}/arxiv/?type=head&arxiv_id=${arxivId}`);
  console.log(`=== ${arxivId}: ${data.title ?? "?"} ===`);
  console.log(`total_tokens: ${data.token_count ?? "?"}\n`);

  const sections = data.sections ?? [];
  console.log(`${"section".padEnd(35)} ${"tokens".padStart(6)}  tldr`);
  console.log("-".repeat(80));
  for (const s of sections) {
    const name = String(s.title ?? s.name ?? `sec-${s.idx}`).slice(0, 35);
    const tok = s.token_count ?? "?";
    const tldr = (s.tldr ?? "").slice(0, 60);
    console.log(`${name.padEnd(35)} ${String(tok).padStart(6)}  ${tldr}`);
  }
}

async function cmdSection(arxivId: string, sectionName: string) {
  const data = await dxFetch(`${BASE_URL}/arxiv/?type=section&arxiv_id=${arxivId}&section=${encodeURIComponent(sectionName)}`);
  if (typeof data === "string") {
    console.log(data);
  } else if (data.content) {
    console.log(data.content);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function cmdSearch(query: string, limit: number, mode: string) {
  const params = new URLSearchParams({
    type: "retrieve",
    query,
    size: String(limit),
    search_mode: mode,
  });
  const data = await dxFetch(`${BASE_URL}/arxiv/?${params}`);
  const results = data.results ?? data ?? [];
  console.log(`Search: "${query}" (mode: ${mode}, ${Array.isArray(results) ? results.length : "?"} results)\n`);

  if (Array.isArray(results)) {
    for (const r of results) {
      const title = (r.title ?? "?").slice(0, 70);
      const id = r.arxiv_id ?? "?";
      const cites = r.citations ?? r.citation_count ?? "?";
      console.log(`  ${id} | ${cites} cites | ${title}`);
    }
  }
}

async function cmdTrending(days: number, limit: number, filter: boolean) {
  const resp = await dxFetch(`${TRENDING_URL}?days=${days}&limit=${limit}`);
  const papers = resp.data?.papers ?? resp.papers ?? resp.results ?? [];

  console.log(`Trending arXiv papers (${days} days, ${papers.length} results):\n`);

  let passed = 0;
  let rateLimited = false;
  for (const p of papers) {
    const id = p.arxiv_id ?? "?";
    const likes = p.stats?.total_likes ?? p.total_likes ?? "?";
    const views = p.stats?.total_views ?? "?";

    // Only fetch brief when filtering (saves API calls when just browsing)
    let title = "?", tldr = "", keywords: string[] = [];
    if (filter && !rateLimited) {
      const brief = await dxFetch(`${BASE_URL}/arxiv/?type=brief&arxiv_id=${id}`);
      if (brief === null) {
        // Rate limited — stop fetching briefs, show remaining with ID only
        rateLimited = true;
        console.log(`  ⚠ Rate limited — showing remaining papers without titles`);
      } else {
        title = brief.title ?? "?";
        tldr = brief.tldr ?? "";
        keywords = brief.keywords ?? [];
      }
    }

    if (filter) {
      if (rateLimited) {
        console.log(`  ? ${id} | ${likes} likes | (rate limited, cannot filter)`);
        continue;
      }
      const rt = rtFilter(title, tldr, keywords);
      if (!rt.pass) {
        console.log(`  ❌ ${id} | ${likes} likes | ${title.slice(0, 60)}`);
        continue;
      }
      console.log(`  ${rt.emoji} ${id} | ${likes} likes | ${title.slice(0, 60)}`);
      console.log(`     match: [${rt.matches.join(", ")}]`);
      passed++;
    } else {
      console.log(`  ${id} | ${likes} likes | ${views} views`);
    }
  }

  if (filter) {
    console.log(`\n${passed}/${papers.length} passed RT relevance filter`);
  }
}

async function cmdRaw(arxivId: string) {
  const data = await dxFetch(`${BASE_URL}/arxiv/?type=raw&arxiv_id=${arxivId}`);
  if (typeof data === "string") console.log(data);
  else if (data.content) console.log(data.content);
  else console.log(JSON.stringify(data));
}

async function cmdHealth() {
  try {
    // Test with free paper (no token needed)
    const data = await dxFetch(`${BASE_URL}/arxiv/?type=brief&arxiv_id=2409.05591`);
    console.log(`DeepXiv API: REACHABLE`);
    console.log(`  Base: ${BASE_URL}`);
    console.log(`  Token: ${DEEPXIV_TOKEN ? "configured" : "not set (using anonymous, 1K/day)"}`);
    console.log(`  Test paper: ${data.title?.slice(0, 50)}`);
  } catch (e: any) {
    console.error(`DeepXiv API: UNREACHABLE — ${e.message}`);
    console.error(`  Fallback: use noria-reader.ts for local access`);
    process.exit(1);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0]?.replace(/^--/, "");

  switch (mode) {
    case "brief":
      if (!argv[1]) { console.error("Usage: --brief <arxiv_id>"); process.exit(1); }
      await cmdBrief(argv[1]);
      break;
    case "head":
      if (!argv[1]) { console.error("Usage: --head <arxiv_id>"); process.exit(1); }
      await cmdHead(argv[1]);
      break;
    case "section":
      if (!argv[1] || !argv[2]) { console.error("Usage: --section <arxiv_id> <name>"); process.exit(1); }
      await cmdSection(argv[1], argv.slice(2).join(" "));
      break;
    case "search": {
      const query = argv[1] ?? "";
      const limitIdx = argv.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) : 10;
      const modeIdx = argv.indexOf("--mode");
      const searchMode = modeIdx >= 0 ? argv[modeIdx + 1] : "hybrid";
      if (!query) { console.error("Usage: --search <query> [--limit N] [--mode hybrid|bm25|vector]"); process.exit(1); }
      await cmdSearch(query, limit, searchMode);
      break;
    }
    case "trending": {
      const daysIdx = argv.indexOf("--days");
      const days = daysIdx >= 0 ? parseInt(argv[daysIdx + 1], 10) : 7;
      const limitIdx = argv.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) : 30;
      const filter = argv.includes("--filter");
      await cmdTrending(days, limit, filter);
      break;
    }
    case "raw":
      if (!argv[1]) { console.error("Usage: --raw <arxiv_id>"); process.exit(1); }
      await cmdRaw(argv[1]);
      break;
    case "health":
      await cmdHealth();
      break;
    default:
      console.error(`DeepXiv Cloud Reader — Progressive reading for arXiv papers

Usage:
  npx tsx tools/deepxiv-reader.ts --health                          Check API connectivity
  npx tsx tools/deepxiv-reader.ts --brief <arxiv_id>                TLDR + keywords (~500 tok)
  npx tsx tools/deepxiv-reader.ts --head <arxiv_id>                 Section structure + token budget
  npx tsx tools/deepxiv-reader.ts --section <arxiv_id> <name>       Read specific section
  npx tsx tools/deepxiv-reader.ts --search "query" [--limit N]      Hybrid BGE-m3 + BM25 search
  npx tsx tools/deepxiv-reader.ts --trending [--days 7] [--filter]  Hot papers + RT filter
  npx tsx tools/deepxiv-reader.ts --raw <arxiv_id>                  Full paper markdown

Environment:
  DEEPXIV_TOKEN   API token (optional, 1K/day without, 10K/day with)

Note: Exit code 2 = rate limited. Caller should fallback to noria-reader.ts.`);
      process.exit(1);
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
