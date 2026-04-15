#!/usr/bin/env npx tsx
/**
 * High-level topic bundle query: "What does the wiki know about X?"
 *
 * Returns a structured summary for external project consumption:
 * - Top concept summary
 * - Supporting source claims with provenance
 * - Related pages
 * - Open questions (if any)
 *
 * Usage:
 *   npx tsx tools/kb-topic-bundle.ts "web agent continual learning"
 *   npx tsx tools/kb-topic-bundle.ts "catastrophic forgetting" --format json
 *   npx tsx tools/kb-topic-bundle.ts "LoRA" --max-sources 5
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const WIKI_DIR = resolve(PROJECT_ROOT, "wiki");
const KB_DIR = resolve(PROJECT_ROOT, ".kb");
export const OUTPUT_DIR = resolve(PROJECT_ROOT, "outputs", "bundles");

// ── Graph features for reranking ──────────────────────────────────────
interface GraphFeature {
  type: string;
  in_degree: number;
  out_degree: number;
  citation_overlap: Record<string, number>;
  bridge_score: number;
  centrality: number;
}

let _graphFeatures: Record<string, GraphFeature> | null = null;
function loadGraphFeatures(): Record<string, GraphFeature> {
  if (_graphFeatures) return _graphFeatures;
  const path = resolve(KB_DIR, "graph-features.json");
  if (!existsSync(path)) return (_graphFeatures = {});
  try {
    _graphFeatures = JSON.parse(readFileSync(path, "utf-8"));
    return _graphFeatures!;
  } catch { return (_graphFeatures = {}); }
}

// ── CLI ────────────────────────────────────────────────────────────────
interface CliArgs { topic: string; format: "text" | "json"; maxSources: number; save: boolean }

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { topic: "", format: "text", maxSources: 10, save: false };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--format") a.format = (argv[++i] ?? "text") as any;
    else if (f === "--max-sources") a.maxSources = parseInt(argv[++i] ?? "10", 10);
    else if (f === "--save") a.save = true;
    else if (!f.startsWith("-")) a.topic = f;
    else { console.error(`Unknown flag: ${f}`); process.exit(1); }
  }
  if (!a.topic) {
    console.error('Usage: npx tsx tools/kb-topic-bundle.ts "topic" [--format json] [--max-sources N] [--save]');
    process.exit(1);
  }
  return a;
}

// ── Page parsing ──────────────────────────────────────────────────────
export interface PageData {
  slug: string;
  dir: string; // sources, concepts, synthesis
  title: string;
  type: string;
  provenance: string;
  sources: string[];
  tags: string[];
  body: string;
  claims: string[]; // extracted [source: ...] citations
  wikilinks: string[];
}

function parsePage(path: string, dir: string): PageData | null {
  const content = readFileSync(path, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm: Record<string, any> = {};
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      fm[key] = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "").trim();
    }
  }

  const body = content.slice(fmMatch[0].length).trim();
  const claims: string[] = [];
  const citeRe = /\[source:\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = citeRe.exec(body)) !== null) claims.push(m[0]);

  const wikilinks: string[] = [];
  const wlRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  while ((m = wlRe.exec(body)) !== null) wikilinks.push(m[1].trim());

  const slug = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    slug, dir,
    title: String(fm.title ?? slug),
    type: String(fm.type ?? "unknown"),
    provenance: String(fm.provenance ?? "unknown"),
    sources: Array.isArray(fm.sources) ? fm.sources : [],
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    body, claims, wikilinks,
  };
}

export function loadAllPages(): PageData[] {
  const pages: PageData[] = [];
  for (const dir of ["sources", "concepts", "synthesis"]) {
    const dirPath = resolve(WIKI_DIR, dir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith(".md")) continue;
      const p = parsePage(resolve(dirPath, f), dir);
      if (p) pages.push(p);
    }
  }
  return pages;
}

// ── Relevance scoring (text + graph rerank) ──────────────────────────
function scoreRelevance(page: PageData, terms: string[], topSlugs?: Set<string>): number {
  // --- Text score (0.55 weight) ---
  let textScore = 0;
  const lower = (s: string) => s.toLowerCase();
  const titleLow = lower(page.title);
  const bodyLow = lower(page.body);
  const tagsLow = page.tags.map(lower);

  for (const term of terms) {
    const t = lower(term);
    if (titleLow.includes(t)) textScore += 10;
    if (tagsLow.some((tag) => tag.includes(t))) textScore += 5;
    const matches = bodyLow.split(t).length - 1;
    textScore += Math.min(matches, 5);
  }
  if (page.type === "concept") textScore += 3;
  if (page.type === "synthesis") textScore += 5;
  if (page.provenance === "user-verified") textScore += 2;

  // --- Graph features (0.45 weight) ---
  const gf = loadGraphFeatures();
  const feat = gf[page.slug];
  if (!feat) return textScore; // no graph features → text-only

  // Citation overlap: boost if this page shares citekeys with already-top-ranked pages
  let overlapScore = 0;
  if (topSlugs && feat.citation_overlap) {
    for (const [peer, jaccard] of Object.entries(feat.citation_overlap)) {
      if (topSlugs.has(peer)) overlapScore += jaccard;
    }
    overlapScore = Math.min(overlapScore, 3.0); // cap
  }

  // Bridge score (0-1)
  const bridgeScore = feat.bridge_score * 2; // scale to comparable range

  // Centrality (0-1, capped contribution)
  const centralityScore = feat.centrality * 1.0;

  // Weighted combination (GPT-5.4 recommended formula, simplified)
  return textScore * 0.55
       + overlapScore * 20 * 0.20   // scale up since overlap is 0-3
       + bridgeScore * 10 * 0.10
       + centralityScore * 10 * 0.03;
}

// ── Bundle generation ─────────────────────────────────────────────────
export interface TopicBundle {
  topic: string;
  timestamp: string;
  concepts: { slug: string; title: string; provenance: string; summary: string; wikilinks: string[] }[];
  sources: { slug: string; title: string; provenance: string; citationCount: number; venue?: string }[];
  claims: string[];
  relatedTopics: string[];
  openQuestions: string[];
  stats: { totalPages: number; conceptCount: number; sourceCount: number; claimCount: number };
}

export function generateBundle(topic: string, pages: PageData[], maxSources: number): TopicBundle {
  const terms = topic.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  // Two-pass scoring: first pass finds top concepts, second pass uses them for citation overlap boost
  const pass1 = pages.map((p) => ({ page: p, score: scoreRelevance(p, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Collect top slugs from pass 1 for citation overlap boosting in pass 2
  const topSlugs = new Set(pass1.slice(0, 20).map(s => s.page.slug));

  const scored = pages.map((p) => ({ page: p, score: scoreRelevance(p, terms, topSlugs) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const concepts = scored.filter((s) => s.page.type === "concept").slice(0, 5);
  const sources = scored.filter((s) => s.page.type === "source").slice(0, maxSources);
  const synthesis = scored.filter((s) => s.page.type === "synthesis").slice(0, 3);

  // Extract first paragraph as summary
  const getSummary = (body: string): string => {
    const lines = body.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
    return lines.slice(0, 3).join(" ").slice(0, 300);
  };

  // Collect all claims from relevant pages
  const allClaims: string[] = [];
  for (const { page } of [...concepts, ...sources, ...synthesis]) {
    allClaims.push(...page.claims);
  }

  // Collect related topics (wikilinks from top concepts)
  const relatedSet = new Set<string>();
  for (const { page } of concepts) {
    for (const link of page.wikilinks) {
      if (!concepts.some((c) => c.page.slug === link)) relatedSet.add(link);
    }
  }

  // Extract open questions from concept pages
  const openQuestions: string[] = [];
  for (const { page } of concepts) {
    const oqMatch = page.body.match(/## Open Questions\n([\s\S]*?)(?=\n##|\Z)/);
    if (oqMatch) {
      const items = oqMatch[1].match(/^- .+$/gm);
      if (items) openQuestions.push(...items.map((l) => `[${page.slug}] ${l.slice(2)}`));
    }
  }

  return {
    topic,
    timestamp: new Date().toISOString(),
    concepts: concepts.map(({ page }) => ({
      slug: page.slug,
      title: page.title,
      provenance: page.provenance,
      summary: getSummary(page.body),
      wikilinks: page.wikilinks,
    })),
    sources: sources.map(({ page }) => ({
      slug: page.slug,
      title: page.title,
      provenance: page.provenance,
      citationCount: page.claims.length,
    })),
    claims: [...new Set(allClaims)].slice(0, 30),
    relatedTopics: [...relatedSet].slice(0, 15),
    openQuestions,
    stats: {
      totalPages: scored.length,
      conceptCount: concepts.length,
      sourceCount: sources.length,
      claimCount: allClaims.length,
    },
  };
}

// ── Output ────────────────────────────────────────────────────────────
function printTextBundle(bundle: TopicBundle) {
  console.log(`\n=== Topic Bundle: "${bundle.topic}" ===\n`);
  console.log(`Found ${bundle.stats.totalPages} relevant pages (${bundle.stats.conceptCount} concepts, ${bundle.stats.sourceCount} sources, ${bundle.stats.claimCount} claims)\n`);

  if (bundle.concepts.length) {
    console.log("## Key Concepts\n");
    for (const c of bundle.concepts) {
      console.log(`  ${c.title} [${c.provenance}]`);
      console.log(`    ${c.summary.slice(0, 200)}...`);
      console.log();
    }
  }

  if (bundle.sources.length) {
    console.log("## Top Sources\n");
    for (const s of bundle.sources) {
      console.log(`  ${s.title} [${s.provenance}] (${s.citationCount} inline citations)`);
    }
    console.log();
  }

  if (bundle.relatedTopics.length) {
    console.log("## Related Topics\n");
    console.log(`  ${bundle.relatedTopics.join(", ")}\n`);
  }

  if (bundle.openQuestions.length) {
    console.log("## Open Questions\n");
    for (const q of bundle.openQuestions) console.log(`  ${q}`);
    console.log();
  }
}

// ── Main (CLI entrypoint only — guarded so imports don't trigger side effects) ──
const _isMain = process.argv[1]?.endsWith("kb-topic-bundle.ts")
  || process.argv[1]?.endsWith("kb-topic-bundle.js");

if (_isMain) {
  const args = parseArgs(process.argv);
  const pages = loadAllPages();
  const bundle = generateBundle(args.topic, pages, args.maxSources);

  if (args.format === "json") {
    const json = JSON.stringify(bundle, null, 2);
    console.log(json);
    if (args.save) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const slug = args.topic.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      const outPath = resolve(OUTPUT_DIR, `${new Date().toISOString().split("T")[0]}-${slug}.json`);
      writeFileSync(outPath, json, "utf-8");
      console.error(`Saved to ${outPath}`);
    }
  } else {
    printTextBundle(bundle);
    if (args.save) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const slug = args.topic.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      const outPath = resolve(OUTPUT_DIR, `${new Date().toISOString().split("T")[0]}-${slug}.json`);
      writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf-8");
      console.error(`Saved to ${outPath}`);
    }
  }
}
