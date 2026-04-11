#!/usr/bin/env npx tsx
/**
 * Cross-paper insight discovery — zero LLM cost.
 *
 * Three analysis modes:
 *   1. --claims    Extract multi-paper claim relationships (contradicts/extends/supports/qualifies)
 *   2. --questions Cluster Open Questions across concept pages by Jaccard similarity
 *   3. --distances Find concept-graph bridge candidates via BFS shortest paths
 *
 * Usage:
 *   npx tsx tools/kb-discover.ts --claims              # Extract claim relations
 *   npx tsx tools/kb-discover.ts --questions            # Cluster open questions
 *   npx tsx tools/kb-discover.ts --distances            # Find bridge candidates
 *   npx tsx tools/kb-discover.ts --json                 # Machine-readable output (combine with any mode)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const KB = resolve(ROOT, ".kb");
const RELATIONS = resolve(KB, "relations.jsonl");
const OUTPUTS = resolve(ROOT, "outputs", "reviews");

// ── Data loaders (self-contained, following kb-gap-scan pattern) ─────
function parseFm(text: string): Record<string, any> | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      fm[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "").trim();
    }
  }
  return Object.keys(fm).length > 0 ? fm : null;
}

interface PageInfo {
  slug: string;
  dir: string;
  title: string;
  sources: string[];
  content: string;
}

function loadPages(): PageInfo[] {
  const pages: PageInfo[] = [];
  for (const dir of ["sources", "concepts", "synthesis"]) {
    const dirPath = resolve(WIKI, dir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(resolve(dirPath, f), "utf-8");
      const fm = parseFm(content);
      if (!fm) continue;
      pages.push({
        slug: f.replace(/\.md$/, ""),
        dir,
        title: String(fm.title ?? f.replace(/\.md$/, "")),
        sources: Array.isArray(fm.sources) ? fm.sources : [],
        content,
      });
    }
  }
  return pages;
}

interface Relation { source: string; target: string; type: string }

function loadRelations(): Relation[] {
  if (!existsSync(RELATIONS)) return [];
  return readFileSync(RELATIONS, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ── Claims: multi-paper relationship extraction ─────────────────────
interface Claim {
  page: string;
  claim_text: string;
  citekeys: string[];
  relation_type: string;
}

const SIGNAL_WORDS: [RegExp, string][] = [
  [/\b(contradicts?|unlike|differs?\s+from|in\s+contrast|whereas)\b/i, "contradicts"],
  [/\b(extends?|builds?\s+on|improves?\s+(upon|over)|advances?|augments?)\b/i, "extends"],
  [/\b(supports?|confirms?|consistent\s+with|corroborates?|aligns?\s+with|validates?)\b/i, "supports"],
  [/\b(qualifies?|partially|limited\s+to|except|however|caveat|although|only\s+when)\b/i, "qualifies"],
];

function classifyRelation(text: string): string {
  for (const [pattern, label] of SIGNAL_WORDS) {
    if (pattern.test(text)) return label;
  }
  return "related";
}

function discoverClaims(pages: PageInfo[]): Claim[] {
  const claims: Claim[] = [];
  const citeRe = /\[source:\s*([a-zA-Z0-9_-]+)/g;

  for (const page of pages) {
    if (page.dir !== "sources" && page.dir !== "synthesis") continue;
    // Strip frontmatter
    const body = page.content.replace(/^---\n[\s\S]*?\n---\n?/, "");
    // Split into sentences/bullets
    const segments = body.split(/(?:\n[-*]\s|\n\n|(?<=[.!?])\s+)/).filter(s => s.length > 20);

    for (const seg of segments) {
      const citekeys: string[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(citeRe.source, citeRe.flags);
      while ((m = re.exec(seg)) !== null) citekeys.push(m[1]);
      const unique = [...new Set(citekeys)];
      if (unique.length >= 2) {
        claims.push({
          page: `${page.dir}/${page.slug}`,
          claim_text: seg.trim().slice(0, 200),
          citekeys: unique,
          relation_type: classifyRelation(seg),
        });
      }
    }
  }
  return claims;
}

// ── Questions: cluster Open Questions across concept pages ──────────
interface QuestionItem {
  concept: string;
  text: string;
  tokens: Set<string>;
}

interface QuestionCluster {
  id: number;
  questions: { concept: string; text: string }[];
}

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","in","on","of","for","to","and","or",
  "with","that","this","from","by","at","as","it","be","has","have","had","not",
  "but","what","how","does","do","can","could","would","should","will","which",
  "who","when","where","why","about","into","through","between","each","all",
  "both","any","some","more","most","other","such","than","also","its","their",
  "these","those","been","being","there","they","them","then","so","if","no",
  "up","out","over","may","much","many","very","just","like","well","still",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function clusterQuestions(pages: PageInfo[]): QuestionCluster[] {
  const items: QuestionItem[] = [];

  for (const page of pages) {
    if (page.dir !== "concepts") continue;
    const oqMatch = page.content.match(/## Open Questions\s*\n([\s\S]*?)(?=\n## |\Z)/);
    if (!oqMatch) continue;
    const bullets = oqMatch[1].split("\n").filter(l => /^[-*]\s/.test(l)).map(l => l.replace(/^[-*]\s+/, "").trim());
    for (const b of bullets) {
      if (b.length < 10) continue;
      items.push({ concept: page.slug, text: b, tokens: tokenize(b) });
    }
  }

  if (items.length === 0) return [];

  // Compute pairwise similarity with concept-sharing bonus
  const THRESHOLD = 0.25;
  const n = items.length;
  const cluster = new Int32Array(n);
  for (let i = 0; i < n; i++) cluster[i] = i;

  function find(x: number): number {
    while (cluster[x] !== x) { cluster[x] = cluster[cluster[x]]; x = cluster[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) cluster[ra] = rb;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sim = jaccard(items[i].tokens, items[j].tokens);
      // Bonus if questions come from pages sharing source citekeys
      const conceptI = pages.find(p => p.slug === items[i].concept);
      const conceptJ = pages.find(p => p.slug === items[j].concept);
      if (conceptI && conceptJ) {
        const shared = conceptI.sources.filter(s => conceptJ.sources.includes(s)).length;
        if (shared > 0) sim += 0.05 * shared;
      }
      if (sim >= THRESHOLD) union(i, j);
    }
  }

  // Group by cluster root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  // Only return multi-member clusters
  const clusters: QuestionCluster[] = [];
  let id = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    clusters.push({
      id: id++,
      questions: members.map(i => ({ concept: items[i].concept, text: items[i].text })),
    });
  }
  return clusters.sort((a, b) => b.questions.length - a.questions.length);
}

// ── Distances: BFS bridge candidates between concepts ───────────────
interface BridgeCandidate {
  concept_a: string;
  concept_b: string;
  distance: number;
  shared_sources: number;
  novelty_score: number;
}

function discoverDistances(pages: PageInfo[], relations: Relation[]): BridgeCandidate[] {
  const concepts = pages.filter(p => p.dir === "concepts");
  const conceptSlugs = new Set(concepts.map(c => c.slug));

  // Build undirected adjacency for concepts only (via relations)
  const adj = new Map<string, Set<string>>();
  for (const c of conceptSlugs) adj.set(c, new Set());

  for (const rel of relations) {
    // Direct concept-concept edges
    if (conceptSlugs.has(rel.source) && conceptSlugs.has(rel.target)) {
      adj.get(rel.source)!.add(rel.target);
      adj.get(rel.target)!.add(rel.source);
    }
  }

  // Also connect concepts that share sources (indirect edges via source pages)
  const conceptSourceMap = new Map<string, Set<string>>();
  for (const c of concepts) conceptSourceMap.set(c.slug, new Set(c.sources));
  // Add sources from relations (source pages linked to concepts)
  for (const rel of relations) {
    if (conceptSlugs.has(rel.target) && !conceptSlugs.has(rel.source)) {
      conceptSourceMap.get(rel.target)?.add(rel.source);
    }
    if (conceptSlugs.has(rel.source) && !conceptSlugs.has(rel.target)) {
      conceptSourceMap.get(rel.source)?.add(rel.target);
    }
  }

  // BFS from each concept
  function bfs(start: string): Map<string, number> {
    const dist = new Map<string, number>();
    dist.set(start, 0);
    const queue = [start];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const d = dist.get(curr)!;
      for (const nb of adj.get(curr) ?? []) {
        if (!dist.has(nb)) {
          dist.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }
    return dist;
  }

  const conceptList = [...conceptSlugs];
  const candidates: BridgeCandidate[] = [];

  for (let i = 0; i < conceptList.length; i++) {
    const dists = bfs(conceptList[i]);
    for (let j = i + 1; j < conceptList.length; j++) {
      const dist = dists.get(conceptList[j]);
      if (dist === undefined || dist <= 1) continue; // skip directly connected or unreachable

      const srcA = conceptSourceMap.get(conceptList[i]) ?? new Set();
      const srcB = conceptSourceMap.get(conceptList[j]) ?? new Set();
      const shared = [...srcA].filter(s => srcB.has(s)).length;

      if (shared === 0) continue; // no shared sources = no latent connection

      candidates.push({
        concept_a: conceptList[i],
        concept_b: conceptList[j],
        distance: dist,
        shared_sources: shared,
        novelty_score: dist * shared,
      });
    }
  }

  return candidates.sort((a, b) => b.novelty_score - a.novelty_score).slice(0, 20);
}

// ── Main ─────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  let mode: "claims" | "questions" | "distances" | undefined;
  let jsonMode = false;

  for (const arg of argv) {
    if (arg === "--claims") mode = "claims";
    else if (arg === "--questions") mode = "questions";
    else if (arg === "--distances") mode = "distances";
    else if (arg === "--json") jsonMode = true;
    else { console.error(`Unknown flag: ${arg}`); process.exit(1); }
  }

  if (!mode) {
    console.error("Usage: npx tsx tools/kb-discover.ts --claims|--questions|--distances [--json]");
    process.exit(1);
  }

  const pages = loadPages();
  const relations = loadRelations();
  const date = new Date().toISOString().split("T")[0];
  const reportLines: string[] = [`# Discovery Report — ${date}\n`];

  if (mode === "claims") {
    const claims = discoverClaims(pages);
    if (jsonMode) { console.log(JSON.stringify(claims, null, 2)); return; }

    console.log(`# Claim Discovery — ${date}\n`);
    console.log(`Found ${claims.length} multi-paper claims\n`);
    reportLines.push(`## Claims (${claims.length})\n`);

    const byType = new Map<string, Claim[]>();
    for (const c of claims) {
      if (!byType.has(c.relation_type)) byType.set(c.relation_type, []);
      byType.get(c.relation_type)!.push(c);
    }
    for (const [type, cs] of byType) {
      console.log(`### ${type} (${cs.length})\n`);
      reportLines.push(`### ${type} (${cs.length})\n`);
      for (const c of cs) {
        const line = `- [${c.page}] ${c.claim_text}`;
        const keys = `  Citekeys: ${c.citekeys.join(", ")}`;
        console.log(line); console.log(keys + "\n");
        reportLines.push(line, keys, "");
      }
    }
  }

  if (mode === "questions") {
    const clusters = clusterQuestions(pages);
    if (jsonMode) { console.log(JSON.stringify(clusters, null, 2)); return; }

    console.log(`# Question Clusters — ${date}\n`);
    console.log(`Found ${clusters.length} clusters from Open Questions\n`);
    reportLines.push(`## Question Clusters (${clusters.length})\n`);

    for (const cl of clusters) {
      const header = `### Cluster ${cl.id} (${cl.questions.length} questions)`;
      console.log(header);
      reportLines.push(header);
      for (const q of cl.questions) {
        const line = `- [${q.concept}] ${q.text}`;
        console.log(line);
        reportLines.push(line);
      }
      console.log(""); reportLines.push("");
    }
  }

  if (mode === "distances") {
    const bridges = discoverDistances(pages, relations);
    if (jsonMode) { console.log(JSON.stringify(bridges, null, 2)); return; }

    console.log(`# Bridge Candidates — ${date}\n`);
    console.log(`Top ${bridges.length} bridge candidates (distance × shared sources)\n`);
    reportLines.push(`## Bridge Candidates (${bridges.length})\n`);

    console.log("| Concept A | Concept B | Dist | Shared | Score |");
    console.log("|-----------|-----------|------|--------|-------|");
    reportLines.push("| Concept A | Concept B | Dist | Shared | Score |");
    reportLines.push("|-----------|-----------|------|--------|-------|");
    for (const b of bridges) {
      const line = `| ${b.concept_a} | ${b.concept_b} | ${b.distance} | ${b.shared_sources} | ${b.novelty_score} |`;
      console.log(line);
      reportLines.push(line);
    }
  }

  // Save report
  mkdirSync(OUTPUTS, { recursive: true });
  const reportPath = resolve(OUTPUTS, `${date}-discover-${mode}.md`);
  writeFileSync(reportPath, reportLines.join("\n"), "utf-8");
  console.log(`\nReport saved: ${reportPath}`);
}

main();
