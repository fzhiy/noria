#!/usr/bin/env npx tsx
/**
 * NORIA Local Progressive Reader — Agent-First paper access layer.
 *
 * Provides token-efficient access to local papers (raw/, wiki/, Zotero PDFs).
 * Designed to minimize Claude context window consumption:
 *   brief  (~200 tok)  — decide if a paper is worth reading
 *   head   (~800 tok)  — decide WHICH sections to read
 *   section (~1-5K)    — read exactly what's needed
 *   triage (~100/paper) — batch relevance screening
 *   search (~500 tok)  — find papers without reading them
 *
 * Usage:
 *   npx tsx tools/noria-reader.ts --brief <citekey>
 *   npx tsx tools/noria-reader.ts --head <citekey>
 *   npx tsx tools/noria-reader.ts --section <citekey> <section-name>
 *   npx tsx tools/noria-reader.ts --triage [citekey1 citekey2 ...]
 *   npx tsx tools/noria-reader.ts --triage --all
 *   npx tsx tools/noria-reader.ts --search <query> [--limit N]
 *   npx tsx tools/noria-reader.ts --budget <citekey>
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_SRC = resolve(ROOT, "wiki", "sources");
const RAW_DIRS = ["raw/zotero/papers", "raw/arxiv", "raw/semantic-scholar", "raw/wechat", "raw/github"].map(d => resolve(ROOT, d));
const CONFIG_PATH = resolve(ROOT, "tools", "research-topic-config.json");

// ── Config ─────────────────────────────────────────────────────────────
interface TopicConfig {
  must_match_keywords: string[];
  boost_keywords: string[];
  exclude_domains: string[];
}

function loadConfig(): TopicConfig {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  return {
    must_match_keywords: raw.must_match_keywords ?? [],
    boost_keywords: raw.boost_keywords ?? [],
    exclude_domains: raw.exclude_domains ?? [],
  };
}

// ── Frontmatter parser (reused pattern from kb-topic-bundle.ts) ──────
function parseFm(text: string): Record<string, any> | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      fm[key] = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "").trim();
    }
  }
  return Object.keys(fm).length > 0 ? fm : null;
}

function bodyAfterFm(text: string): string {
  const m = text.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? text.slice(m[0].length).trim() : text;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Find files for a citekey ──────────────────────────────────────────
function findWikiPage(citekey: string): string | null {
  const p = resolve(WIKI_SRC, `${citekey}.md`);
  return existsSync(p) ? p : null;
}

function findRawFile(citekey: string): string | null {
  for (const dir of RAW_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.replace(/\.md$/, "") === citekey) return resolve(dir, f);
    }
  }
  return null;
}

function findPdfPath(citekey: string): string | null {
  try {
    const out = execSync(`python3 tools/zotero_sync.py --pdf-paths 2>/dev/null`, { cwd: ROOT, timeout: 15000 });
    const text = out.toString();
    // Find the line with our citekey
    const re = new RegExp(`"${citekey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}":\\s*"([^"]+)"`);
    const m = text.match(re);
    return m ? m[1] : null;
  } catch { return null; }
}

// ── RT Relevance (zero-LLM keyword matching) ─────────────────────────
type RTLevel = "core" | "peripheral" | "off-topic";

interface RTResult {
  level: RTLevel;
  emoji: string;
  must_hits: string[];
  boost_hits: string[];
  exclude_hits: string[];
}

function matchKeyword(text: string, kw: string): boolean {
  // Word-boundary matching to avoid substring false positives (e.g., "ELL" in "Emanuele Della")
  // For short keywords (≤4 chars), require word boundaries; for longer ones, includes() is safe
  if (kw.length <= 4) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
    return re.test(text);
  }
  return text.toLowerCase().includes(kw.toLowerCase());
}

function assessRT(text: string, config: TopicConfig): RTResult {
  const must_hits = config.must_match_keywords.filter(kw => matchKeyword(text, kw));
  const boost_hits = config.boost_keywords.filter(kw => matchKeyword(text, kw));
  const exclude_hits = config.exclude_domains.filter(kw => matchKeyword(text, kw));

  let level: RTLevel;
  if (exclude_hits.length > 0 && must_hits.length === 0) {
    level = "off-topic";
  } else if (must_hits.length >= 2 || boost_hits.length >= 1) {
    level = "core";
  } else if (must_hits.length === 1) {
    level = "peripheral";
  } else {
    level = "off-topic";
  }

  const emoji = level === "core" ? "✅" : level === "peripheral" ? "🔶" : "❌";
  return { level, emoji, must_hits, boost_hits, exclude_hits };
}

// ── Depth detection ──────────────────────────────────────────────────
function detectDepth(wikiBody: string): "abstract-only" | "deepened" | "none" {
  if (!wikiBody) return "none";
  if (/\[source:.*sec\.\d/.test(wikiBody)) return "deepened";
  return "abstract-only";
}

// ── brief() ──────────────────────────────────────────────────────────
function cmdBrief(citekey: string) {
  const config = loadConfig();
  const wikiPath = findWikiPage(citekey);
  const rawPath = findRawFile(citekey);

  if (!wikiPath && !rawPath) {
    console.error(`Not found: ${citekey}`);
    process.exit(1);
  }

  // Gather metadata from raw + wiki
  const rawFm = rawPath ? parseFm(readFileSync(rawPath, "utf-8")) : null;
  const wikiContent = wikiPath ? readFileSync(wikiPath, "utf-8") : "";
  const wikiFm = wikiPath ? parseFm(wikiContent) : null;
  const wikiBody = bodyAfterFm(wikiContent);
  const fm = { ...rawFm, ...wikiFm }; // wiki overrides raw

  // Extract TLDR from first sentence of Summary
  const summaryMatch = wikiBody.match(/## Summary\n\n([^\n]+)/);
  const tldr = summaryMatch ? summaryMatch[1].replace(/\[source:.*?\]/g, "").trim().slice(0, 150) : (rawFm?.abstract ?? "").slice(0, 150);

  // RT relevance — use FULL abstract + title + tags + wiki summary for accurate classification
  const rawBody = rawPath ? bodyAfterFm(readFileSync(rawPath, "utf-8")) : "";
  const searchText = `${fm.title ?? ""} ${rawBody.slice(0, 1000)} ${wikiBody.slice(0, 500)} ${(fm.tags ?? []).join(" ")}`;
  const rt = assessRT(searchText, config);

  // Depth
  const depth = detectDepth(wikiBody);
  const hasPdf = !!findPdfPath(citekey);
  const tokenEst = wikiContent ? estimateTokens(wikiContent) : (rawPath ? estimateTokens(readFileSync(rawPath, "utf-8")) : 0);

  // Determine action
  let action = "needs deepen";
  if (depth === "deepened") action = "already deep";
  else if (rt.level === "off-topic") action = "skip";
  else if (rt.level === "peripheral") action = "intro+conc only";
  else action = "full deepen";

  console.log(`title: ${fm.title ?? citekey}`);
  console.log(`authors: ${(fm.authors ?? []).slice(0, 3).join(", ")}${(fm.authors?.length ?? 0) > 3 ? " et al." : ""}`);
  console.log(`year: ${fm.year ?? "?"} | venue: ${fm.venue ?? "?"} | tier: ${fm.venue_tier ?? "?"}`);
  console.log(`citations: ${fm.citation_count ?? fm.citations ?? "?"} | provenance: ${fm.provenance ?? "?"}`);
  console.log(`depth: ${depth} | has_pdf: ${hasPdf} | arxiv: ${fm.arxiv_id ?? fm.doi ?? "none"}`);
  console.log(`tokens: ~${tokenEst}`);
  console.log(`rt: ${rt.emoji} ${rt.level} | match: [${rt.must_hits.concat(rt.boost_hits).join(", ")}]`);
  console.log(`action: ${action}`);
}

// ── head() ───────────────────────────────────────────────────────────
function cmdHead(citekey: string) {
  const wikiPath = findWikiPage(citekey);

  if (!wikiPath) {
    console.log(`No wiki page for ${citekey}. Only raw/ metadata available.`);
    cmdBrief(citekey);
    return;
  }

  const content = readFileSync(wikiPath, "utf-8");
  const body = bodyAfterFm(content);
  const totalTokens = estimateTokens(content);

  // Extract sections
  const sectionRe = /^## (.+)$/gm;
  const sections: { name: string; tokens: number; hasCitations: boolean }[] = [];
  let lastIdx = 0;
  let lastName = "(preamble)";
  let m: RegExpExecArray | null;

  const matches: { name: string; idx: number }[] = [];
  while ((m = sectionRe.exec(body)) !== null) {
    matches.push({ name: m[1], idx: m.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : body.length;
    const sectionText = body.slice(start, end);
    sections.push({
      name: matches[i].name,
      tokens: estimateTokens(sectionText),
      hasCitations: /\[source:/.test(sectionText),
    });
  }

  console.log(`=== ${citekey} ===`);
  console.log(`total_tokens: ${totalTokens}\n`);
  console.log(`${"section".padEnd(30)} ${"tokens".padStart(6)}  citations`);
  console.log("-".repeat(50));
  for (const s of sections) {
    const bar = "█".repeat(Math.min(20, Math.round(s.tokens / totalTokens * 40)));
    console.log(`${s.name.padEnd(30)} ${String(s.tokens).padStart(6)}  ${s.hasCitations ? "yes" : "no "}  ${bar}`);
  }

  // Check PDF availability for unmatched sections
  const hasPdf = !!findPdfPath(citekey);
  if (hasPdf && sections.length <= 2) {
    console.log(`\npdf_available: true (sections above are wiki-level; full paper in PDF)`);
  }
}

// ── section() ────────────────────────────────────────────────────────
function cmdSection(citekey: string, sectionName: string) {
  const wikiPath = findWikiPage(citekey);
  if (!wikiPath) {
    console.error(`No wiki page for ${citekey}. Use deepxiv-reader or /kb-deepen first.`);
    process.exit(1);
  }

  const body = bodyAfterFm(readFileSync(wikiPath, "utf-8"));
  const sectionRe = new RegExp(`^## ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "im");
  const start = body.search(sectionRe);
  if (start === -1) {
    console.error(`Section "${sectionName}" not found in ${citekey}. Available:`);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    headings.forEach(h => console.log(`  - ${h}`));
    process.exit(1);
  }

  // Find end of section (next ## or EOF)
  const afterStart = body.slice(start);
  const nextSection = afterStart.search(/\n## /);
  const sectionText = nextSection > 0 ? afterStart.slice(0, nextSection) : afterStart;

  console.log(sectionText.trim());
  console.log(`\n--- tokens: ~${estimateTokens(sectionText)} ---`);
}

// ── triage() ─────────────────────────────────────────────────────────
function cmdTriage(citekeys: string[]) {
  const config = loadConfig();

  // If --all, gather all wiki source citekeys
  if (citekeys.length === 0 || citekeys[0] === "--all") {
    if (existsSync(WIKI_SRC)) {
      citekeys = readdirSync(WIKI_SRC).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, ""));
    }
  }

  // Table header
  const cols = [
    ["citekey", 40],
    ["venue", 12],
    ["tier", 12],
    ["cite", 5],
    ["depth", 13],
    ["RT", 3],
    ["action", 20],
  ] as const;
  console.log(cols.map(([n, w]) => String(n).padEnd(w)).join(" | "));
  console.log(cols.map(([, w]) => "-".repeat(w)).join("-+-"));

  let coreCount = 0, partialCount = 0, offCount = 0;

  for (const ck of citekeys) {
    const rawPath = findRawFile(ck);
    const wikiPath = findWikiPage(ck);
    const rawFm = rawPath ? parseFm(readFileSync(rawPath, "utf-8")) : null;
    const wikiFm = wikiPath ? parseFm(readFileSync(wikiPath, "utf-8")) : null;
    const fm = { ...rawFm, ...wikiFm };
    const wikiBody = wikiPath ? bodyAfterFm(readFileSync(wikiPath, "utf-8")) : "";

    const rawBody = rawPath ? bodyAfterFm(readFileSync(rawPath, "utf-8")) : "";
    const searchText = `${fm.title ?? ""} ${rawBody.slice(0, 1000)} ${wikiBody.slice(0, 500)} ${(fm.tags ?? []).join(" ")}`;
    const rt = assessRT(searchText, config);
    const depth = detectDepth(wikiBody);

    let action: string;
    if (depth === "deepened") action = "already deep";
    else if (rt.level === "off-topic") { action = "skip"; offCount++; }
    else if (rt.level === "peripheral") { action = "intro+conc only"; partialCount++; }
    else { action = "full deepen"; coreCount++; }

    const venue = String(fm.venue ?? "?").slice(0, 12);
    const tier = String(fm.venue_tier ?? "?").slice(0, 12);
    const cite = String(fm.citation_count ?? fm.citations ?? "?").slice(0, 5);

    console.log([
      ck.slice(0, 40).padEnd(40),
      venue.padEnd(12),
      tier.padEnd(12),
      cite.padStart(5),
      depth.padEnd(13),
      rt.emoji.padEnd(3),
      action.padEnd(20),
    ].join(" | "));
  }

  console.log(`\n--- Summary: ${coreCount} CORE, ${partialCount} PARTIAL, ${offCount} OFF-TOPIC, ${citekeys.length - coreCount - partialCount - offCount} already deep ---`);
  const estTokens = coreCount * 12000 + partialCount * 4000;
  console.log(`--- Estimated deepen cost: ~${Math.round(estTokens / 1000)}K Claude tokens (vs ${Math.round(citekeys.length * 12000 / 1000)}K if all full-read) ---`);
}

// ── search() — lightweight fallback (prefer QMD wiki-search MCP for better ranking) ──
function cmdSearch(query: string, limit: number) {
  // NOTE: This is a simple keyword search. For semantic/hybrid search, use QMD MCP:
  //   mcp__wiki-search__query with type:'vec' or type:'lex'
  // This function exists as a zero-dependency fallback when QMD is not running.
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: { slug: string; title: string; score: number; depth: string; rt: string }[] = [];

  if (!existsSync(WIKI_SRC)) { console.log("No wiki sources found."); return; }

  for (const f of readdirSync(WIKI_SRC).filter(f => f.endsWith(".md"))) {
    const path = resolve(WIKI_SRC, f);
    const content = readFileSync(path, "utf-8").toLowerCase();
    const fm = parseFm(readFileSync(path, "utf-8"));
    let score = 0;
    for (const t of terms) {
      if (content.includes(t)) score++;
    }
    if (score > 0) {
      const slug = f.replace(/\.md$/, "");
      const depth = detectDepth(bodyAfterFm(readFileSync(path, "utf-8")));
      results.push({ slug, title: String(fm?.title ?? slug).slice(0, 60), score, depth, rt: "" });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, limit);

  console.log(`Search: "${query}" (${results.length} matches, showing top ${top.length})\n`);
  for (const r of top) {
    console.log(`  ${r.slug}`);
    console.log(`    ${r.title} | depth: ${r.depth} | match: ${r.score}/${terms.length}`);
  }
}

// ── budget() ─────────────────────────────────────────────────────────
function cmdBudget(citekey: string) {
  const wikiPath = findWikiPage(citekey);
  if (!wikiPath) { console.error(`No wiki page for ${citekey}`); process.exit(1); }

  const content = readFileSync(wikiPath, "utf-8");
  const fm = parseFm(content);
  const body = bodyAfterFm(content);
  const totalTokens = estimateTokens(content);

  console.log(`Paper: ${citekey} (total: ${totalTokens} tokens)\n`);

  const headings = [...body.matchAll(/^## (.+)$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index!;
    const end = i + 1 < headings.length ? headings[i + 1].index! : body.length;
    const sectionTokens = estimateTokens(body.slice(start, end));
    const pct = (sectionTokens / totalTokens * 100).toFixed(1);
    const barLen = Math.round(sectionTokens / totalTokens * 30);
    const bar = "█".repeat(Math.min(barLen, 30)) + "░".repeat(Math.max(0, 30 - barLen));
    console.log(`  ${headings[i][1].padEnd(25)} ${String(sectionTokens).padStart(6)} tok  ${bar}  ${pct}%`);
  }
}

// ── exists() — dedup check before saving ─────────────────────────────
function cmdExists(identifier: string) {
  // Check by citekey
  if (findWikiPage(identifier)) {
    console.log(`EXISTS wiki/sources/${identifier}.md`);
    process.exit(0);
  }
  if (findRawFile(identifier)) {
    console.log(`EXISTS raw/${identifier}`);
    process.exit(0);
  }

  // Check by arxiv_id or DOI — precise frontmatter field matching, not substring
  const allDirs = [...RAW_DIRS, WIKI_SRC];
  const isArxivId = /^\d{4}\.\d{4,5}(v\d+)?$/.test(identifier);
  const isDoi = identifier.startsWith("10.");

  for (const dir of allDirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(resolve(dir, f), "utf-8");
      const fm = parseFm(content);
      if (!fm) continue;

      // Precise matching: check specific fields, not arbitrary content
      const matched =
        (isArxivId && (fm.arxiv_id === identifier || fm.doi?.includes(identifier) || content.match(new RegExp(`arxiv[_:]\\s*["']?${identifier.replace(/\./g, '\\.')}`)))) ||
        (isDoi && fm.doi?.includes(identifier)) ||
        (!isArxivId && !isDoi && (fm.title?.toLowerCase().includes(identifier.toLowerCase())));

      if (matched) {
        const slug = f.replace(/\.md$/, "");
        const where = dir.includes("wiki") ? "wiki/sources" : dir.replace(ROOT + "/", "");
        console.log(`EXISTS ${where}/${f} (matched: ${fm?.title?.slice(0, 60) ?? slug})`);
        process.exit(0);
      }
    }
  }

  console.log(`NOT_FOUND ${identifier}`);
  process.exit(1);
}

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv[0]?.replace(/^--/, "");

switch (mode) {
  case "brief":
    if (!argv[1]) { console.error("Usage: --brief <citekey>"); process.exit(1); }
    cmdBrief(argv[1]);
    break;
  case "head":
    if (!argv[1]) { console.error("Usage: --head <citekey>"); process.exit(1); }
    cmdHead(argv[1]);
    break;
  case "section":
    if (!argv[1] || !argv[2]) { console.error("Usage: --section <citekey> <section-name>"); process.exit(1); }
    cmdSection(argv[1], argv[2]);
    break;
  case "triage": {
    const keys = argv.slice(1);
    cmdTriage(keys);
    break;
  }
  case "search": {
    const query = argv[1] ?? "";
    const limitIdx = argv.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) : 10;
    if (!query) { console.error("Usage: --search <query> [--limit N]"); process.exit(1); }
    cmdSearch(query, limit);
    break;
  }
  case "budget":
    if (!argv[1]) { console.error("Usage: --budget <citekey>"); process.exit(1); }
    cmdBudget(argv[1]);
    break;
  case "exists":
    if (!argv[1]) { console.error("Usage: --exists <citekey|arxiv_id>"); process.exit(1); }
    cmdExists(argv[1]);
    break;
  default:
    console.error(`NORIA Local Progressive Reader — Agent-First paper access

Usage:
  npx tsx tools/noria-reader.ts --brief <citekey>              Quick summary + RT relevance (~200 tok)
  npx tsx tools/noria-reader.ts --head <citekey>               Section structure + token budget (~800 tok)
  npx tsx tools/noria-reader.ts --section <citekey> <name>     Read specific section (~1-5K tok)
  npx tsx tools/noria-reader.ts --triage [citekeys... | --all] Batch RT screening (~100 tok/paper)
  npx tsx tools/noria-reader.ts --search <query> [--limit N]   Local keyword search (~500 tok)
  npx tsx tools/noria-reader.ts --budget <citekey>             Visual token budget breakdown
  npx tsx tools/noria-reader.ts --exists <citekey|arxiv_id>   Dedup check (exit 0=exists, 1=new)`);
    process.exit(1);
}
