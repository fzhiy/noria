#!/usr/bin/env npx tsx
/**
 * Semantic Scholar -> raw/semantic-scholar/ search & import tool.
 *
 * Searches published venue papers (IEEE, ACM, Springer, etc.) via S2 Graph API.
 * Complements arxiv-search.ts (preprints) with citation counts, venue metadata, TLDR.
 *
 * Usage:
 *   npx tsx tools/semantic-scholar-search.ts --query "web agent continual learning" --limit 10
 *   npx tsx tools/semantic-scholar-search.ts --query "LLM agent benchmark" --year 2024-
 *   npx tsx tools/semantic-scholar-search.ts --query "example query" --min-citations 10
 *   npx tsx tools/semantic-scholar-search.ts --query "continual GUI learning" --type conference
 *   npx tsx tools/semantic-scholar-search.ts --paper "DOI:10.1109/..."
 *   npx tsx tools/semantic-scholar-search.ts --paper "ARXIV:2401.12345"
 *   npx tsx tools/semantic-scholar-search.ts --related "ARXIV:2401.12345" --limit 5
 *   npx tsx tools/semantic-scholar-search.ts --citations "ARXIV:2401.12345" --limit 10
 *   npx tsx tools/semantic-scholar-search.ts --dry-run --query "self-evolving agent"
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env from project root if present
const envPath = resolve(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const RAW_S2 = resolve(PROJECT_ROOT, "raw", "semantic-scholar");
const RAW_ARXIV = resolve(PROJECT_ROOT, "raw", "arxiv");
const RAW_ZOTERO = resolve(PROJECT_ROOT, "raw", "zotero", "papers");

const S2_API = "https://api.semanticscholar.org/graph/v1";
const S2_FIELDS = "paperId,externalIds,title,abstract,venue,publicationVenue,year,citationCount,influentialCitationCount,fieldsOfStudy,publicationTypes,authors,openAccessPdf,tldr";
const S2_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY ?? "";

// ── CLI ────────────────────────────────────────────────────────────────
interface CliArgs {
  mode: "search" | "paper" | "related" | "citations" | "author" | "lab";
  query: string;
  limit: number;
  year: string | null;
  minCitations: number | null;
  pubTypes: string | null;   // "JournalArticle,Conference"
  fieldsOfStudy: string;     // default "Computer Science"
  dryRun: boolean;
  noFilter: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    mode: "search", query: "", limit: 10, year: null, minCitations: null,
    pubTypes: "JournalArticle,Conference", fieldsOfStudy: "Computer Science",
    dryRun: false, noFilter: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--query" || f === "-q") { a.mode = "search"; a.query = argv[++i] ?? ""; }
    else if (f === "--paper") { a.mode = "paper"; a.query = argv[++i] ?? ""; }
    else if (f === "--related") { a.mode = "related"; a.query = argv[++i] ?? ""; }
    else if (f === "--citations") { a.mode = "citations"; a.query = argv[++i] ?? ""; }
    else if (f === "--author") { a.mode = "author"; a.query = argv[++i] ?? ""; }
    else if (f === "--lab") { a.mode = "lab"; a.query = argv[++i] ?? ""; }
    else if (f === "--limit" || f === "-n") a.limit = parseInt(argv[++i] ?? "10", 10);
    else if (f === "--year") a.year = argv[++i] ?? null;
    else if (f === "--min-citations") a.minCitations = parseInt(argv[++i] ?? "0", 10);
    else if (f === "--type") a.pubTypes = argv[++i] ?? null;
    else if (f === "--fields") a.fieldsOfStudy = argv[++i] ?? "Computer Science";
    else if (f === "--dry-run") a.dryRun = true;
    else if (f === "--no-filter") a.noFilter = true;
    else { console.error(`Unknown flag: ${f}`); process.exit(1); }
  }
  if (!a.query) {
    console.error(`Usage: npx tsx tools/semantic-scholar-search.ts --query "terms" [options]
  --limit N          Max results (default 10)
  --year RANGE       Year filter (e.g. "2024-", "2020-2024")
  --min-citations N  Minimum citation count
  --type TYPE        Publication type: JournalArticle,Conference,Review,all
  --fields FIELDS    Fields of study (default "Computer Science", use "all" to remove)
  --dry-run          Preview without saving
  --paper ID         Fetch single paper by DOI/ArXiv/S2 ID
  --related ID       Find related papers
  --citations ID     Find papers citing this one
  --author S2_ID     Fetch recent papers by author (S2 author ID)
  --lab LAB_NAME     Fetch papers from all tracked researchers in a lab (from tracked-labs.json)`);
    process.exit(1);
  }
  if (a.fieldsOfStudy === "all") a.fieldsOfStudy = "";
  if (a.pubTypes === "all") a.pubTypes = null;
  return a;
}

// ── S2 API types ─────────────────────────────────────────────────────
interface S2Paper {
  paperId: string;
  externalIds?: { DOI?: string; ArXiv?: string; CorpusId?: number };
  title: string;
  abstract?: string;
  venue?: string;
  publicationVenue?: { name?: string; type?: string };
  year?: number;
  citationCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  publicationTypes?: string[];
  authors?: { name: string }[];
  openAccessPdf?: { url?: string };
  tldr?: { text?: string };
}

// ── S2 API calls ─────────────────────────────────────────────────────
function s2Headers(): Record<string, string> {
  const h: Record<string, string> = { "Accept": "application/json" };
  if (S2_API_KEY) h["x-api-key"] = S2_API_KEY;
  return h;
}

async function s2Fetch(url: string): Promise<any> {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(url, { headers: s2Headers() });
    if (resp.ok) return resp.json();
    if (resp.status === 429 && attempt < MAX_RETRIES) {
      const wait = attempt * 5;
      console.log(`  S2 rate limited (429), retrying in ${wait}s (${attempt}/${MAX_RETRIES})...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (resp.status >= 500 && attempt < MAX_RETRIES) {
      const wait = attempt * 3;
      console.log(`  S2 server error (${resp.status}), retrying in ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`S2 API error: ${resp.status} ${resp.statusText} — ${await resp.text().catch(() => "")}`);
  }
  throw new Error("unreachable");
}

async function searchPapers(args: CliArgs): Promise<S2Paper[]> {
  const params = new URLSearchParams({
    query: args.query,
    limit: String(args.limit),
    fields: S2_FIELDS,
  });
  if (args.year) params.set("year", args.year);
  if (args.minCitations) params.set("minCitationCount", String(args.minCitations));
  if (args.pubTypes) params.set("publicationTypes", args.pubTypes);
  if (args.fieldsOfStudy) params.set("fieldsOfStudy", args.fieldsOfStudy);

  const url = `${S2_API}/paper/search?${params}`;
  console.log(`Querying: ${url}\n`);
  const json = await s2Fetch(url);
  return json.data ?? [];
}

async function fetchPaper(id: string): Promise<S2Paper> {
  const url = `${S2_API}/paper/${encodeURIComponent(id)}?fields=${S2_FIELDS}`;
  console.log(`Fetching paper: ${url}\n`);
  return s2Fetch(url);
}

async function fetchRelated(id: string, limit: number): Promise<S2Paper[]> {
  // S2 recommendations API
  const url = `${S2_API}/paper/${encodeURIComponent(id)}/recommendations?fields=${S2_FIELDS}&limit=${limit}`;
  console.log(`Fetching related papers: ${url}\n`);
  const json = await s2Fetch(url);
  return json.recommendedPapers ?? [];
}

async function fetchCitations(id: string, limit: number): Promise<S2Paper[]> {
  const url = `${S2_API}/paper/${encodeURIComponent(id)}/citations?fields=${S2_FIELDS}&limit=${limit}`;
  console.log(`Fetching citations: ${url}\n`);
  const json = await s2Fetch(url);
  return (json.data ?? []).map((d: any) => d.citingPaper).filter(Boolean);
}

// ── Citekey & slug ─────────────────────────────────────────────────────
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-").slice(0, 80).replace(/-$/, "");
}

function makeCitekey(p: S2Paper): string {
  const firstAuthor = p.authors?.[0]?.name ?? "";
  const last = firstAuthor.includes(" ") ? firstAuthor.split(" ").pop()!.toLowerCase() : firstAuthor.toLowerCase();
  const year = p.year ? String(p.year) : "";
  const kw = slugify((p.title ?? "").split(":")[0]).slice(0, 20).replace(/-$/, "");
  return (last || year) ? `${last}${year}-${kw}` : slugify(p.title ?? "untitled").slice(0, 40);
}

// ── Dedup ──────────────────────────────────────────────────────────────
function buildDedupIndex(): { citekeys: Set<string>; arxivIds: Set<string>; dois: Set<string>; s2Ids: Set<string> } {
  const citekeys = new Set<string>();
  const arxivIds = new Set<string>();
  const dois = new Set<string>();
  const s2Ids = new Set<string>();

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
        const doi = fm.match(/doi:\s*"?([^"\n]+)"?/)?.[1]?.trim();
        if (doi) dois.add(doi.toLowerCase());
        const s2id = fm.match(/s2_paper_id:\s*"?([^"\n]+)"?/)?.[1]?.trim();
        if (s2id) s2Ids.add(s2id);
        // Also check URL-embedded arxiv IDs
        const urlId = fm.match(/url:\s*"?https?:\/\/arxiv\.org\/abs\/([^"\n]+)"?/)?.[1]?.trim().replace(/v\d+$/, "");
        if (urlId) arxivIds.add(urlId);
      } catch { /* skip */ }
    }
  };
  scan(RAW_S2);
  scan(RAW_ARXIV);
  scan(RAW_ZOTERO);
  return { citekeys, arxivIds, dois, s2Ids };
}

function isDuplicate(p: S2Paper, dedup: ReturnType<typeof buildDedupIndex>, citekey: string): string | null {
  if (dedup.citekeys.has(slugify(citekey))) return `dup citekey: ${citekey}`;
  if (dedup.s2Ids.has(p.paperId)) return `dup s2_id: ${p.paperId}`;
  const doi = p.externalIds?.DOI?.toLowerCase();
  if (doi && dedup.dois.has(doi)) return `dup doi: ${doi}`;
  const arxiv = p.externalIds?.ArXiv;
  if (arxiv && dedup.arxivIds.has(arxiv)) return `dup arxiv: ${arxiv}`;
  return null;
}

// ── Markdown output ────────────────────────────────────────────────────
function paperToMarkdown(p: S2Paper, citekey: string): string {
  const today = new Date().toISOString().split("T")[0];
  const authors = (p.authors ?? []).map((a) => a.name);
  const lines = [
    "---",
    `citekey: "${citekey}"`,
    `title: "${(p.title ?? "").replace(/"/g, '\\"')}"`,
    `authors: [${authors.join(", ")}]`,
  ];
  if (p.year) lines.push(`year: ${p.year}`);
  if (p.venue) lines.push(`venue: "${p.venue}"`);
  if (p.publicationVenue?.name) lines.push(`venue_name: "${p.publicationVenue.name}"`);
  if (p.publicationVenue?.type) lines.push(`venue_type: "${p.publicationVenue.type}"`);
  if (p.citationCount != null) lines.push(`citation_count: ${p.citationCount}`);
  if (p.influentialCitationCount != null) lines.push(`influential_citation_count: ${p.influentialCitationCount}`);
  if (p.externalIds?.DOI) lines.push(`doi: "${p.externalIds.DOI}"`);
  if (p.externalIds?.ArXiv) lines.push(`arxiv_id: "${p.externalIds.ArXiv}"`);
  lines.push(`s2_paper_id: "${p.paperId}"`);
  if (p.fieldsOfStudy?.length) lines.push(`fields_of_study: [${p.fieldsOfStudy.join(", ")}]`);
  if (p.publicationTypes?.length) lines.push(`publication_types: [${p.publicationTypes.join(", ")}]`);
  if (p.openAccessPdf?.url) lines.push(`pdf_url: "${p.openAccessPdf.url}"`);
  lines.push(`source_type: semantic-scholar`);
  lines.push(`date_synced: ${today}`);
  lines.push("---", "");

  if (p.tldr?.text) {
    lines.push("## TLDR", "", p.tldr.text, "");
  }
  lines.push("## Abstract", "", p.abstract ?? "(No abstract available)", "");

  return lines.join("\n");
}

// ── Display ───────────────────────────────────────────────────────────
function displayPaper(p: S2Paper, idx: number) {
  const ck = makeCitekey(p);
  const authors = (p.authors ?? []).slice(0, 3).map((a) => a.name);
  const authorStr = authors.join(", ") + ((p.authors?.length ?? 0) > 3 ? " et al." : "");
  const venue = p.venue || p.publicationVenue?.name || "Unknown venue";
  const types = p.publicationTypes?.join(", ") || "Unknown";
  const arxivNote = p.externalIds?.ArXiv ? ` [also arXiv:${p.externalIds.ArXiv}]` : "";

  console.log(`  ${idx}. ${ck}`);
  console.log(`     ${p.title}`);
  console.log(`     ${authorStr}`);
  console.log(`     ${venue} (${p.year ?? "?"}) | Citations: ${p.citationCount ?? 0} | Type: ${types}${arxivNote}`);
  if (p.tldr?.text) console.log(`     TLDR: ${p.tldr.text.slice(0, 120)}...`);
  if (p.externalIds?.DOI) console.log(`     DOI: https://doi.org/${p.externalIds.DOI}`);
  console.log();
}

// ── Main ───────────────────────────────────────────────────────────────
// ── Author / Lab tracking ─────────────────────────────────────────────
async function fetchAuthorPapers(authorId: string, limit: number, year?: string | null): Promise<S2Paper[]> {
  // Author papers endpoint does not support tldr field
  const authorFields = "paperId,externalIds,title,abstract,venue,publicationVenue,year,citationCount,influentialCitationCount,fieldsOfStudy,publicationTypes,authors,openAccessPdf";
  const url = `${S2_API}/author/${authorId}/papers?fields=${authorFields}&limit=${Math.min(limit * 3, 100)}`;
  const res = await fetch(url, { headers: s2Headers() });
  if (!res.ok) throw new Error(`S2 author API ${res.status}: ${res.statusText}`);
  const data = await res.json() as any;
  let papers = (data.data ?? []).map((d: any) => d as S2Paper);
  // Client-side year filtering (S2 author endpoint doesn't support year param)
  if (year) {
    const [from, to] = year.split("-").map(s => s ? parseInt(s, 10) : null);
    papers = papers.filter((p: S2Paper) => {
      if (!p.year) return false;
      if (from && p.year < from) return false;
      if (to && p.year > to) return false;
      return true;
    });
  }
  return papers.slice(0, limit);
}

interface TrackedLab {
  name: string;
  focus: string;
  researchers: { name: string; s2_id: string; topics: string[] }[];
  resources: string[];
}

function loadTrackedLabs(): TrackedLab[] {
  const labsPath = resolve(PROJECT_ROOT, "tools", "tracked-labs.json");
  if (!existsSync(labsPath)) { console.error("tracked-labs.json not found"); process.exit(1); }
  const data = JSON.parse(readFileSync(labsPath, "utf-8"));
  return data.labs ?? [];
}

async function fetchLabPapers(labName: string, limit: number, year?: string | null): Promise<S2Paper[]> {
  const labs = loadTrackedLabs();
  const lab = labs.find(l => l.name.toLowerCase().includes(labName.toLowerCase()));
  if (!lab) {
    console.error(`Lab "${labName}" not found. Available: ${labs.map(l => l.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`Lab: ${lab.name} (${lab.focus})`);
  console.log(`Researchers: ${lab.researchers.map(r => r.name).join(", ")}\n`);

  const allPapers: S2Paper[] = [];
  const seen = new Set<string>();
  for (const researcher of lab.researchers) {
    if (!researcher.s2_id) continue;
    console.log(`  Fetching papers by ${researcher.name} (S2: ${researcher.s2_id})...`);
    try {
      const papers = await fetchAuthorPapers(researcher.s2_id, limit, year);
      for (const p of papers) {
        if (!seen.has(p.paperId)) { seen.add(p.paperId); allPapers.push(p); }
      }
      console.log(`    Found ${papers.length} papers`);
    } catch (e: any) {
      console.log(`    Error: ${e.message}`);
    }
    // Rate limit between researchers
    await new Promise(r => setTimeout(r, 1000));
  }
  return allPapers;
}

async function main() {
  const args = parseArgs(process.argv);

  let papers: S2Paper[];
  if (args.mode === "paper") {
    const p = await fetchPaper(args.query);
    papers = [p];
  } else if (args.mode === "related") {
    papers = await fetchRelated(args.query, args.limit);
  } else if (args.mode === "citations") {
    papers = await fetchCitations(args.query, args.limit);
  } else if (args.mode === "author") {
    console.log(`Fetching papers by author S2 ID: ${args.query}\n`);
    papers = await fetchAuthorPapers(args.query, args.limit, args.year);
  } else if (args.mode === "lab") {
    papers = await fetchLabPapers(args.query, args.limit, args.year);
  } else {
    papers = await searchPapers(args);
  }

  if (papers.length === 0) { console.log("No results found."); process.exit(0); }

  console.log(`Found ${papers.length} papers:\n`);
  papers.forEach((p, i) => displayPaper(p, i + 1));

  if (args.dryRun) {
    console.log(`[dry-run] Would save ${papers.length} papers. Exiting.`);
    process.exit(0);
  }

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
  mkdirSync(RAW_S2, { recursive: true });
  let saved = 0, skipped = 0, filtered = 0;

  for (const paper of papers) {
    const citekey = makeCitekey(paper);
    const filename = `${slugify(citekey)}.md`;
    const dupReason = isDuplicate(paper, dedup, citekey);
    if (dupReason) {
      console.log(`  skip (${dupReason}): ${filename}`);
      skipped++;
      continue;
    }

    // Relevance check
    if (assessRelevance) {
      const rel = await assessRelevance(paper.title, paper.abstract ?? "", {
        s2PaperId: paper.paperId,
        arxivId: paper.externalIds?.ArXiv,
        citationCount: paper.citationCount,
      }, { skipSpecter: true });
      if (!rel.pass) {
        console.log(`  skip (${rel.reasons[0] ?? "off-topic"}): ${(paper.title ?? "").slice(0, 60)}...`);
        filtered++;
        continue;
      }
    }

    writeFileSync(resolve(RAW_S2, filename), paperToMarkdown(paper, citekey), "utf-8");
    console.log(`  + ${filename}`);
    dedup.citekeys.add(slugify(citekey));
    dedup.s2Ids.add(paper.paperId);
    if (paper.externalIds?.DOI) dedup.dois.add(paper.externalIds.DOI.toLowerCase());
    if (paper.externalIds?.ArXiv) dedup.arxivIds.add(paper.externalIds.ArXiv);
    saved++;
  }
  console.log(`\nFound ${papers.length} papers, saved ${saved} new, skipped ${skipped} duplicates${filtered ? `, filtered ${filtered} off-topic` : ""}.`);
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
