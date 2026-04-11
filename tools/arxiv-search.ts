#!/usr/bin/env npx tsx
/**
 * arXiv -> raw/arxiv/ search & import tool.
 *
 * Usage:
 *   npx tsx tools/arxiv-search.ts --query "web agent continual learning" --limit 10
 *   npx tsx tools/arxiv-search.ts --query "LLM agent benchmark" --limit 5 --category cs.AI
 *   npx tsx tools/arxiv-search.ts --query "UI drift agent" --since 2025-01-01
 *   npx tsx tools/arxiv-search.ts --dry-run --query "self-evolving agent"
 *   npx tsx tools/arxiv-search.ts --query "concept drift" --no-filter  # skip relevance filter
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_ARXIV = resolve(PROJECT_ROOT, "raw", "arxiv");
const RAW_ZOTERO = resolve(PROJECT_ROOT, "raw", "zotero", "papers");

// ── CLI ────────────────────────────────────────────────────────────────
interface CliArgs { query: string; limit: number; category: string | null; since: string | null; dryRun: boolean; noFilter: boolean }

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { query: "", limit: 10, category: null, since: null, dryRun: false, noFilter: false };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--query" || f === "-q") a.query = argv[++i] ?? "";
    else if (f === "--limit" || f === "-n") a.limit = parseInt(argv[++i] ?? "10", 10);
    else if (f === "--category" || f === "-c") a.category = argv[++i] ?? null;
    else if (f === "--since") a.since = argv[++i] ?? null;
    else if (f === "--dry-run") a.dryRun = true;
    else if (f === "--no-filter") a.noFilter = true;
    else { console.error(`Unknown flag: ${f}`); process.exit(1); }
  }
  if (!a.query) {
    console.error('Usage: npx tsx tools/arxiv-search.ts --query "terms" [--limit N] [--category cs.AI] [--since YYYY-MM-DD] [--dry-run]');
    process.exit(1);
  }
  return a;
}

// ── arXiv API ──────────────────────────────────────────────────────────
interface ArxivEntry {
  arxivId: string; title: string; authors: string[];
  abstract: string; categories: string[]; published: string; pdfUrl: string;
}

function buildSearchQuery(args: CliArgs): string {
  const terms = args.query.split(/\s+/).filter(Boolean);
  const q = terms.map((t) => `all:${t}`).join("+AND+");
  return args.category ? `${q}+AND+cat:${args.category}` : q;
}

async function searchArxiv(args: CliArgs): Promise<ArxivEntry[]> {
  const sq = buildSearchQuery(args);
  const url = `https://export.arxiv.org/api/query?search_query=${sq}&max_results=${args.limit}&sortBy=submittedDate&sortOrder=descending`;
  console.log(`Querying: ${url}\n`);

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(url);
    if (resp.ok) return parseAtomEntries(await resp.text());
    if (resp.status >= 500 && attempt < MAX_RETRIES) {
      const wait = attempt * 3;
      console.log(`  arXiv returned ${resp.status}, retrying in ${wait}s (${attempt}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`arXiv API error: ${resp.status} ${resp.statusText}`);
  }
  throw new Error("unreachable");
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function parseAtomEntries(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const b = m[1];
    const id = extractTag(b, "id") ?? "";
    const arxivId = id.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    const title = (extractTag(b, "title") ?? "Untitled").replace(/\s+/g, " ").trim();
    const abstract = (extractTag(b, "summary") ?? "").replace(/\s+/g, " ").trim();
    const published = extractTag(b, "published") ?? "";
    // Authors
    const authors: string[] = [];
    const aRe = /<author>\s*<name>([^<]+)<\/name>/g;
    let am: RegExpExecArray | null;
    while ((am = aRe.exec(b)) !== null) authors.push(am[1].trim());
    // Categories
    const categories: string[] = [];
    const cRe = /<category[^>]*term="([^"]+)"/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(b)) !== null) categories.push(cm[1]);
    // PDF link
    const pdfM = b.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    const pdfUrl = pdfM ? pdfM[1] : `https://arxiv.org/pdf/${arxivId}`;
    entries.push({ arxivId, title, authors, abstract, categories, published, pdfUrl });
  }
  return entries;
}

// ── Citekey & slug ─────────────────────────────────────────────────────
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-").slice(0, 80).replace(/-$/, "");
}

function makeCitekey(e: ArxivEntry): string {
  const first = e.authors[0] ?? "";
  const last = first.includes(" ") ? first.split(" ").pop()!.toLowerCase() : first.toLowerCase();
  const year = e.published.match(/(\d{4})/)?.[1] ?? "";
  const kw = slugify(e.title.split(":")[0]).slice(0, 20).replace(/-$/, "");
  return (last || year) ? `${last}${year}-${kw}` : slugify(e.title).slice(0, 40);
}

// ── Dedup ──────────────────────────────────────────────────────────────
function buildDedupIndex(): { citekeys: Set<string>; arxivIds: Set<string> } {
  const citekeys = new Set<string>();
  const arxivIds = new Set<string>();
  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      citekeys.add(f.replace(/\.md$/, ""));
      try {
        const txt = readFileSync(resolve(dir, f), "utf-8");
        const fm = txt.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (!fm) continue;
        const aid = fm.match(/arxiv_id:\s*"?([^"\n]+)"?/)?.[1]?.trim();
        if (aid) arxivIds.add(aid);
        const urlId = fm.match(/url:\s*"?https?:\/\/arxiv\.org\/abs\/([^"\n]+)"?/)?.[1]?.trim().replace(/v\d+$/, "");
        if (urlId) arxivIds.add(urlId);
      } catch { /* skip */ }
    }
  };
  scan(RAW_ARXIV);
  scan(RAW_ZOTERO);
  return { citekeys, arxivIds };
}

// ── Markdown output ────────────────────────────────────────────────────
function entryToMarkdown(e: ArxivEntry, citekey: string): string {
  const today = new Date().toISOString().split("T")[0];
  const year = e.published.match(/(\d{4})/)?.[1] ?? "";
  const lines = [
    "---",
    `citekey: "${citekey}"`,
    `title: "${e.title.replace(/"/g, '\\"')}"`,
    `authors: [${e.authors.join(", ")}]`,
  ];
  if (year) lines.push(`year: ${year}`);
  lines.push(
    `arxiv_id: "${e.arxivId}"`,
    `categories: [${e.categories.join(", ")}]`,
    `url: "https://arxiv.org/abs/${e.arxivId}"`,
    `pdf_url: "${e.pdfUrl}"`,
    `source_type: arxiv`,
    `date_synced: ${today}`,
    "---", "", "## Abstract", "", e.abstract, "",
  );
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  let entries = await searchArxiv(args);
  if (entries.length === 0) { console.log("No results found."); process.exit(0); }

  // Date filter
  if (args.since) {
    const d = new Date(args.since);
    entries = entries.filter((e) => new Date(e.published) >= d);
  }

  console.log(`Found ${entries.length} papers${args.since ? ` (since ${args.since})` : ""}:\n`);
  for (const e of entries) {
    const ck = makeCitekey(e);
    const date = e.published.split("T")[0];
    console.log(`  ${ck}`);
    console.log(`    ${e.title}`);
    console.log(`    ${e.authors.slice(0, 3).join(", ")}${e.authors.length > 3 ? " et al." : ""}`);
    console.log(`    ${date}  [${e.categories[0] ?? ""}]  https://arxiv.org/abs/${e.arxivId}\n`);
  }

  if (args.dryRun) { console.log(`[dry-run] Would save ${entries.length} papers. Exiting.`); process.exit(0); }

  // Relevance filter (unless --no-filter)
  let assessRelevance: typeof import("./relevance-filter.js").assessRelevance | null = null;
  if (!args.noFilter) {
    try {
      const mod = await import("./relevance-filter.js");
      assessRelevance = mod.assessRelevance;
    } catch {
      console.log("  [filter] relevance-filter not available, saving all results.");
    }
  }

  const dedup = buildDedupIndex();
  mkdirSync(RAW_ARXIV, { recursive: true });
  let saved = 0, skipped = 0, filtered = 0;

  for (const entry of entries) {
    const citekey = makeCitekey(entry);
    const filename = `${slugify(citekey)}.md`;
    if (dedup.citekeys.has(slugify(citekey))) { console.log(`  skip (dup citekey): ${filename}`); skipped++; continue; }
    if (dedup.arxivIds.has(entry.arxivId)) { console.log(`  skip (dup arxiv_id ${entry.arxivId}): ${filename}`); skipped++; continue; }

    // Relevance check (OR-gate, Layer 1+3)
    if (assessRelevance) {
      const rel = await assessRelevance(entry.title, entry.abstract, {
        categories: entry.categories,
        arxivId: entry.arxivId,
      }, { skipSpecter: true }); // Skip SPECTER2 for speed; use keyword heuristic
      if (!rel.pass) {
        console.log(`  skip (${rel.reasons[0] ?? "off-topic"}): ${entry.title.slice(0, 60)}...`);
        filtered++;
        continue;
      }
    }

    writeFileSync(resolve(RAW_ARXIV, filename), entryToMarkdown(entry, citekey), "utf-8");
    console.log(`  + ${filename}`);
    dedup.citekeys.add(slugify(citekey));
    dedup.arxivIds.add(entry.arxivId);
    saved++;
  }
  console.log(`\nFound ${entries.length} papers, saved ${saved} new, skipped ${skipped} duplicates${filtered ? `, filtered ${filtered} off-topic` : ""}.`);
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
