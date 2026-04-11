#!/usr/bin/env npx tsx
/**
 * Sidecar relation graph for wiki pages.
 *
 * Manages typed edges between wiki entities in .kb/relations.jsonl.
 * Does NOT modify wiki pages — relations live alongside, not inside.
 *
 * Usage:
 *   npx tsx tools/kb-relations.ts --scan                  # Scan wiki for implicit relations from wikilinks
 *   npx tsx tools/kb-relations.ts --add source target type [evidence]
 *   npx tsx tools/kb-relations.ts --query page-slug       # Show all relations for a page
 *   npx tsx tools/kb-relations.ts --bridges               # Find cross-domain bridge candidates
 *   npx tsx tools/kb-relations.ts --stats                 # Show relation graph statistics
 *   npx tsx tools/kb-relations.ts --export-dot             # Export as DOT graph for visualization
 *   npx tsx tools/kb-relations.ts --features              # Compute graph features → .kb/graph-features.json
 *   npx tsx tools/kb-relations.ts --communities           # Shared-concept clustering → .kb/communities.json
 */
import { writeFileSync, readFileSync, readdirSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_DIR = resolve(PROJECT_ROOT, "wiki");
const KB_DIR = resolve(PROJECT_ROOT, ".kb");
const RELATIONS_FILE = resolve(KB_DIR, "relations.jsonl");

// ── Types ─────────────────────────────────────────────────────────────
type RelationType = "cites" | "cited-by" | "related" | "bridges" | "contradicts" | "extends" | "supports" | "qualifies" | "uses-method" | "wikilink";

interface Relation {
  source: string;       // kebab-case page slug (without .md)
  target: string;       // kebab-case page slug (without .md)
  type: RelationType;
  evidence?: string;    // Brief justification
  origin: "scan" | "s2" | "manual" | "compile" | "discover";  // How this relation was discovered
  created: string;      // ISO date
}

// ── CLI ────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): { mode: string; args: string[] } {
  if (argv.length < 3) {
    console.error(`Usage:
  npx tsx tools/kb-relations.ts --scan              Scan wiki for wikilink relations
  npx tsx tools/kb-relations.ts --add SRC TGT TYPE [EVIDENCE]
  npx tsx tools/kb-relations.ts --query SLUG        Show relations for a page
  npx tsx tools/kb-relations.ts --bridges           Find cross-domain bridge candidates
  npx tsx tools/kb-relations.ts --stats             Relation graph statistics
  npx tsx tools/kb-relations.ts --export-dot        Export DOT graph`);
    process.exit(1);
  }
  const mode = argv[2].replace(/^--/, "");
  const args = argv.slice(3);
  return { mode, args };
}

// ── Relation store ────────────────────────────────────────────────────
function loadRelations(): Relation[] {
  if (!existsSync(RELATIONS_FILE)) return [];
  const lines = readFileSync(RELATIONS_FILE, "utf-8").split("\n").filter(Boolean);
  return lines.map((l) => {
    try { return JSON.parse(l) as Relation; } catch { return null; }
  }).filter(Boolean) as Relation[];
}

function saveRelations(relations: Relation[]) {
  mkdirSync(KB_DIR, { recursive: true });
  const content = relations.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(RELATIONS_FILE, content, "utf-8");
}

function appendRelation(rel: Relation) {
  mkdirSync(KB_DIR, { recursive: true });
  appendFileSync(RELATIONS_FILE, JSON.stringify(rel) + "\n", "utf-8");
}

function dedupRelations(relations: Relation[]): Relation[] {
  const seen = new Set<string>();
  return relations.filter((r) => {
    const key = `${r.source}|${r.target}|${r.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Wiki scanning ─────────────────────────────────────────────────────
interface PageMeta {
  slug: string;
  type: string;       // source, concept, synthesis
  tags: string[];
  sources: string[];
  wikilinks: string[];
}

function parseFrontmatter(content: string): Record<string, any> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      fm[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "").trim();
    }
  }
  return fm;
}

function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    links.push(m[1].trim());
  }
  return [...new Set(links)];
}

function scanWikiPages(): PageMeta[] {
  const pages: PageMeta[] = [];
  const dirs = ["sources", "concepts", "synthesis"];
  for (const dir of dirs) {
    const dirPath = resolve(WIKI_DIR, dir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith(".md")) continue;
      const content = readFileSync(resolve(dirPath, f), "utf-8");
      const fm = parseFrontmatter(content);
      const slug = f.replace(/\.md$/, "");
      pages.push({
        slug,
        type: fm.type ?? dir.replace(/s$/, ""),
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        sources: Array.isArray(fm.sources) ? fm.sources : [],
        wikilinks: extractWikilinks(content),
      });
    }
  }
  return pages;
}

// ── Commands ──────────────────────────────────────────────────────────
function cmdScan() {
  const pages = scanWikiPages();
  const today = new Date().toISOString().split("T")[0];
  const relations: Relation[] = [];

  for (const page of pages) {
    for (const link of page.wikilinks) {
      relations.push({
        source: page.slug, target: link, type: "wikilink",
        origin: "scan", created: today,
      });
    }
    // Source pages reference concepts they contribute to
    if (page.type === "source") {
      for (const other of pages) {
        if (other.type === "concept" && other.sources.includes(page.slug)) {
          relations.push({
            source: page.slug, target: other.slug, type: "related",
            evidence: `Source contributes to concept`,
            origin: "scan", created: today,
          });
        }
      }
    }
  }

  const deduped = dedupRelations(relations);
  saveRelations(deduped);
  console.log(`Scanned ${pages.length} pages, found ${deduped.length} relations.`);
  const byType = new Map<string, number>();
  for (const r of deduped) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  for (const [type, count] of byType) console.log(`  ${type}: ${count}`);
}

function cmdAdd(args: string[]) {
  if (args.length < 3) { console.error("Usage: --add SOURCE TARGET TYPE [EVIDENCE]"); process.exit(1); }
  const [source, target, type, ...rest] = args;
  const evidence = rest.join(" ") || undefined;
  const validTypes: RelationType[] = ["cites", "cited-by", "related", "bridges", "contradicts", "extends", "supports", "qualifies", "uses-method", "wikilink"];
  if (!validTypes.includes(type as RelationType)) {
    console.error(`Invalid type: ${type}. Valid: ${validTypes.join(", ")}`);
    process.exit(1);
  }
  const rel: Relation = {
    source, target, type: type as RelationType,
    evidence, origin: "manual",
    created: new Date().toISOString().split("T")[0],
  };
  appendRelation(rel);
  console.log(`Added: ${source} --[${type}]--> ${target}`);
}

function cmdQuery(args: string[]) {
  if (!args[0]) { console.error("Usage: --query SLUG"); process.exit(1); }
  const slug = args[0];
  const relations = loadRelations();
  const related = relations.filter((r) => r.source === slug || r.target === slug);
  if (related.length === 0) { console.log(`No relations found for '${slug}'.`); return; }

  console.log(`Relations for '${slug}' (${related.length} total):\n`);
  const outgoing = related.filter((r) => r.source === slug);
  const incoming = related.filter((r) => r.target === slug);
  if (outgoing.length) {
    console.log("  Outgoing:");
    for (const r of outgoing) {
      console.log(`    --[${r.type}]--> ${r.target}${r.evidence ? ` (${r.evidence})` : ""}`);
    }
  }
  if (incoming.length) {
    console.log("  Incoming:");
    for (const r of incoming) {
      console.log(`    <--[${r.type}]-- ${r.source}${r.evidence ? ` (${r.evidence})` : ""}`);
    }
  }
}

function cmdBridges() {
  const pages = scanWikiPages();
  const relations = loadRelations();

  // Classify pages by domain based on tags
  const agentTags = new Set(["web-agent", "browser-automation", "agent-learning", "gui-agent",
    "agent-benchmark", "agent-safety", "self-evolving", "agent-memory", "terminal-agent"]);
  const peftTags = new Set(["peft", "method:lora", "low-rank-decomposition", "fine-tuning",
    "spectral-analysis", "tensor-decomposition", "model-merging"]);

  const domain = new Map<string, "agent" | "peft" | "bridge" | "other">();
  for (const p of pages) {
    const hasAgent = p.tags.some((t) => agentTags.has(t));
    const hasPeft = p.tags.some((t) => peftTags.has(t));
    if (hasAgent && hasPeft) domain.set(p.slug, "bridge");
    else if (hasAgent) domain.set(p.slug, "agent");
    else if (hasPeft) domain.set(p.slug, "peft");
    else domain.set(p.slug, "other");
  }

  // Find bridge candidates: pages that link to both domains
  console.log("=== Cross-Domain Bridge Analysis ===\n");

  console.log("Known bridges (pages tagged in both domains):");
  for (const [slug, d] of domain) {
    if (d === "bridge") console.log(`  ${slug}`);
  }

  console.log("\nBridge candidates (link to both Agent and PEFT pages):");
  for (const p of pages) {
    if (domain.get(p.slug) === "bridge") continue;
    const linkedDomains = new Set(p.wikilinks.map((l) => domain.get(l)).filter(Boolean));
    if (linkedDomains.has("agent") && linkedDomains.has("peft")) {
      const agentLinks = p.wikilinks.filter((l) => domain.get(l) === "agent");
      const peftLinks = p.wikilinks.filter((l) => domain.get(l) === "peft");
      console.log(`  ${p.slug} [${domain.get(p.slug)}]`);
      console.log(`    → Agent: ${agentLinks.join(", ")}`);
      console.log(`    → PEFT: ${peftLinks.join(", ")}`);
    }
  }

  // Check for citation-based bridges
  const citationBridges = relations.filter(
    (r) => (r.type === "cites" || r.type === "cited-by") &&
      domain.get(r.source) !== domain.get(r.target) &&
      domain.get(r.source) !== "other" && domain.get(r.target) !== "other"
  );
  if (citationBridges.length) {
    console.log("\nCitation-based cross-domain connections:");
    for (const r of citationBridges) {
      console.log(`  ${r.source} [${domain.get(r.source)}] --[${r.type}]--> ${r.target} [${domain.get(r.target)}]`);
    }
  }
}

function cmdStats() {
  const relations = loadRelations();
  if (relations.length === 0) { console.log("No relations. Run --scan first."); return; }

  const byType = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  const nodes = new Set<string>();
  for (const r of relations) {
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    byOrigin.set(r.origin, (byOrigin.get(r.origin) ?? 0) + 1);
    nodes.add(r.source);
    nodes.add(r.target);
  }

  console.log(`=== Relation Graph Statistics ===\n`);
  console.log(`Total edges: ${relations.length}`);
  console.log(`Unique nodes: ${nodes.size}\n`);
  console.log("By type:");
  for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
  console.log("\nBy origin:");
  for (const [origin, count] of [...byOrigin].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${origin}: ${count}`);
  }
}

function cmdExportDot() {
  const relations = loadRelations().filter((r) => r.type !== "wikilink"); // skip noise
  if (relations.length === 0) { console.log("No non-wikilink relations. Run --scan first."); return; }

  const lines = ["digraph wiki {", '  rankdir=LR;', '  node [shape=box, style=rounded];'];
  const colors: Record<string, string> = {
    cites: "blue", "cited-by": "green", related: "gray",
    bridges: "red", contradicts: "orange", extends: "purple",
    supports: "darkgreen", qualifies: "darkorange",
    "uses-method": "brown",
  };
  for (const r of relations) {
    const color = colors[r.type] ?? "black";
    lines.push(`  "${r.source}" -> "${r.target}" [label="${r.type}", color=${color}];`);
  }
  lines.push("}");
  const dot = lines.join("\n");
  console.log(dot);

  const outPath = resolve(PROJECT_ROOT, "outputs", "wiki-graph.dot");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, dot, "utf-8");
  console.log(`\nSaved to ${outPath}`);
}

// ── Graph Features (for reranking) ────────────────────────────────────
function cmdFeatures() {
  const pages = scanWikiPages();
  const relations = loadRelations();

  // Build adjacency and page lookup
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const neighbors = new Map<string, Set<string>>();
  const pageTypes = new Map<string, string>();

  for (const p of pages) {
    pageTypes.set(p.slug, p.type);
    inDegree.set(p.slug, 0);
    outDegree.set(p.slug, 0);
    neighbors.set(p.slug, new Set());
  }

  for (const r of relations) {
    inDegree.set(r.target, (inDegree.get(r.target) ?? 0) + 1);
    outDegree.set(r.source, (outDegree.get(r.source) ?? 0) + 1);
    if (!neighbors.has(r.source)) neighbors.set(r.source, new Set());
    if (!neighbors.has(r.target)) neighbors.set(r.target, new Set());
    neighbors.get(r.source)!.add(r.target);
    neighbors.get(r.target)!.add(r.source);
  }

  // Citation overlap: hub-weighted Jaccard on shared citekeys in sources: frontmatter
  // Hub downweighting: citekeys referenced by many pages get lower weight (same as Adamic-Adar logic)
  const citekeyPages = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const src of p.sources) {
      if (!citekeyPages.has(src)) citekeyPages.set(src, new Set());
      citekeyPages.get(src)!.add(p.slug);
    }
  }
  // Weight per citekey: inverse log of how many pages reference it
  const citekeyWeight = new Map<string, number>();
  for (const [ck, pgs] of citekeyPages) {
    citekeyWeight.set(ck, 1 / Math.log2(pgs.size + 1));
  }

  // Compute pairwise hub-weighted citation overlap
  const citationOverlap = new Map<string, Map<string, number>>();
  for (const p of pages) {
    if (p.sources.length === 0) continue;
    const pSrc = new Set(p.sources);
    const coPages = new Set<string>();
    for (const src of p.sources) {
      for (const other of citekeyPages.get(src) ?? []) {
        if (other !== p.slug) coPages.add(other);
      }
    }
    for (const other of coPages) {
      const otherPage = pages.find(pp => pp.slug === other);
      if (!otherPage) continue;
      const oSrc = new Set(otherPage.sources);
      // Weighted intersection / weighted union
      const shared = [...pSrc].filter(s => oSrc.has(s));
      const allCks = new Set([...pSrc, ...oSrc]);
      const wIntersection = shared.reduce((sum, ck) => sum + (citekeyWeight.get(ck) ?? 0), 0);
      const wUnion = [...allCks].reduce((sum, ck) => sum + (citekeyWeight.get(ck) ?? 0), 0);
      const wJaccard = wUnion > 0 ? wIntersection / wUnion : 0;
      if (wJaccard > 0.05) {
        if (!citationOverlap.has(p.slug)) citationOverlap.set(p.slug, new Map());
        citationOverlap.get(p.slug)!.set(other, Math.round(wJaccard * 100) / 100);
      }
    }
  }

  // Bridge score: a page is a bridge if it connects different concept hubs
  // Simple: count unique concepts a source page links to
  const conceptSlugs = new Set(pages.filter(p => p.type === "concept").map(p => p.slug));
  const bridgeScore = new Map<string, number>();
  for (const p of pages) {
    const linkedConcepts = (neighbors.get(p.slug) ?? new Set());
    const conceptCount = [...linkedConcepts].filter(n => conceptSlugs.has(n)).length;
    // Normalize: bridge score = concept connections / max possible (cap at 1.0)
    const maxConcepts = Math.max(1, conceptSlugs.size);
    bridgeScore.set(p.slug, Math.round((Math.min(conceptCount, 10) / 10) * 100) / 100);
  }

  // Centrality: normalized in-degree (capped)
  const maxIn = Math.max(1, ...inDegree.values());
  const centrality = new Map<string, number>();
  for (const [slug, deg] of inDegree) {
    centrality.set(slug, Math.round((deg / maxIn) * 100) / 100);
  }

  // Build output
  const features: Record<string, any> = {};
  for (const p of pages) {
    const overlap = citationOverlap.get(p.slug);
    const overlapObj: Record<string, number> = {};
    if (overlap) {
      // Keep top 10 by overlap score
      const sorted = [...overlap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [k, v] of sorted) overlapObj[k] = v;
    }

    features[p.slug] = {
      type: pageTypes.get(p.slug) ?? "unknown",
      in_degree: inDegree.get(p.slug) ?? 0,
      out_degree: outDegree.get(p.slug) ?? 0,
      citation_overlap: overlapObj,
      bridge_score: bridgeScore.get(p.slug) ?? 0,
      centrality: centrality.get(p.slug) ?? 0,
    };
  }

  const outPath = resolve(KB_DIR, "graph-features.json");
  writeFileSync(outPath, JSON.stringify(features, null, 2), "utf-8");

  // Summary
  const pageCount = Object.keys(features).length;
  const withOverlap = Object.values(features).filter((f: any) => Object.keys(f.citation_overlap).length > 0).length;
  const avgBridge = Object.values(features).reduce((sum: number, f: any) => sum + f.bridge_score, 0) / pageCount;

  console.log(`Graph features computed for ${pageCount} pages → ${outPath}`);
  console.log(`  Pages with citation overlap: ${withOverlap}`);
  console.log(`  Average bridge score: ${avgBridge.toFixed(3)}`);
  console.log(`  Max centrality: ${Math.max(...Object.values(features).map((f: any) => f.centrality)).toFixed(3)}`);
}

// ── Shared-Concept Community Detection ────────────────────────────────
function cmdCommunities() {
  const pages = scanWikiPages();
  const relations = loadRelations();
  // Parse optional --threshold arg
  const threshIdx = process.argv.indexOf("--threshold");
  const threshold = threshIdx >= 0 ? parseFloat(process.argv[threshIdx + 1]) : 0.25;

  // Filter: exclude off-topic and unpromoted social-lead pages from clustering
  const excludeSlugs = new Set<string>();
  for (const p of pages) {
    if (p.type !== "source") continue;
    const filePath = resolve(WIKI_DIR, "sources", `${p.slug}.md`);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf-8");
    const relM = content.match(/^relevance:\s*(\S+)/m);
    const provM = content.match(/^provenance:\s*(\S+)/m);
    if (relM?.[1] === "off-topic" || provM?.[1] === "social-lead") {
      excludeSlugs.add(p.slug);
    }
  }
  if (excludeSlugs.size > 0) {
    console.log(`  Excluded ${excludeSlugs.size} off-topic/social-lead pages from clustering`);
  }

  const sources = pages.filter(p => p.type === "source" && !excludeSlugs.has(p.slug));
  const concepts = pages.filter(p => p.type === "concept");
  const conceptSlugs = new Set(concepts.map(c => c.slug));

  // Step 1: Build source→concept adjacency from relations
  const srcConcepts = new Map<string, Set<string>>();
  for (const s of sources) srcConcepts.set(s.slug, new Set());

  for (const rel of relations) {
    if (srcConcepts.has(rel.source) && conceptSlugs.has(rel.target)) {
      srcConcepts.get(rel.source)!.add(rel.target);
    }
    if (srcConcepts.has(rel.target) && conceptSlugs.has(rel.source)) {
      srcConcepts.get(rel.target)!.add(rel.source);
    }
  }
  // Also add from concept's sources: frontmatter (reverse mapping)
  for (const concept of concepts) {
    for (const citekey of concept.sources) {
      if (srcConcepts.has(citekey)) {
        srcConcepts.get(citekey)!.add(concept.slug);
      }
    }
  }

  // Step 2: Hub downweighting — inverse log of concept degree
  const conceptDegree = new Map<string, number>();
  for (const c of conceptSlugs) conceptDegree.set(c, 0);
  for (const [, cSet] of srcConcepts) {
    for (const c of cSet) conceptDegree.set(c, (conceptDegree.get(c) ?? 0) + 1);
  }
  const conceptWeight = new Map<string, number>();
  for (const [c, deg] of conceptDegree) {
    conceptWeight.set(c, deg > 0 ? 1 / Math.log2(deg + 1) : 0);
  }

  // Step 3: Weighted cosine similarity between source pairs
  // Build feature vectors (sparse: only store non-zero concepts)
  const sourceList = sources.filter(s => (srcConcepts.get(s.slug)?.size ?? 0) > 0);
  const slugIndex = new Map(sourceList.map((s, i) => [s.slug, i]));
  const n = sourceList.length;

  // Precompute weighted norms
  const norms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sumSq = 0;
    for (const c of srcConcepts.get(sourceList[i].slug)!) {
      const w = conceptWeight.get(c) ?? 0;
      sumSq += w * w;
    }
    norms[i] = Math.sqrt(sumSq);
  }

  // Build concept→sources inverted index for efficient pairwise computation
  const conceptToSources = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const c of srcConcepts.get(sourceList[i].slug)!) {
      if (!conceptToSources.has(c)) conceptToSources.set(c, []);
      conceptToSources.get(c)!.push(i);
    }
  }

  // Compute similarity only for pairs sharing ≥1 concept
  const simPairs = new Map<string, number>(); // "i,j" → similarity
  for (const [concept, members] of conceptToSources) {
    const w = conceptWeight.get(concept) ?? 0;
    if (w === 0) continue;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const i = members[a], j = members[b];
        const key = `${Math.min(i,j)},${Math.max(i,j)}`;
        simPairs.set(key, (simPairs.get(key) ?? 0) + w * w);
      }
    }
  }
  // Normalize by norms → cosine
  for (const [key, dot] of simPairs) {
    const [i, j] = key.split(",").map(Number);
    const denom = norms[i] * norms[j];
    simPairs.set(key, denom > 0 ? dot / denom : 0);
  }

  // Step 4: Agglomerative clustering (average linkage)
  // Initialize: each source is its own cluster
  const clusterOf = new Int32Array(n);
  for (let i = 0; i < n; i++) clusterOf[i] = i;
  const clusterMembers = new Map<number, number[]>();
  for (let i = 0; i < n; i++) clusterMembers.set(i, [i]);

  // Build cluster-pair average similarity
  // For efficiency, maintain a priority list of mergeable pairs
  let nextClusterId = n;
  let mergeCount = 0;

  while (true) {
    // Find best merge (highest average similarity between any two active clusters)
    let bestSim = -1, bestA = -1, bestB = -1;
    const activeClusters = [...clusterMembers.keys()];

    for (let ai = 0; ai < activeClusters.length; ai++) {
      for (let bi = ai + 1; bi < activeClusters.length; bi++) {
        const ca = activeClusters[ai], cb = activeClusters[bi];
        const membersA = clusterMembers.get(ca)!, membersB = clusterMembers.get(cb)!;

        // Average similarity between all pairs across the two clusters
        let totalSim = 0, pairCount = 0;
        for (const a of membersA) {
          for (const b of membersB) {
            const key = `${Math.min(a,b)},${Math.max(a,b)}`;
            totalSim += simPairs.get(key) ?? 0;
            pairCount++;
          }
        }
        const avgSim = pairCount > 0 ? totalSim / pairCount : 0;

        if (avgSim > bestSim) {
          bestSim = avgSim;
          bestA = ca;
          bestB = cb;
        }
      }
    }

    if (bestSim < threshold || bestA < 0) break;

    // Merge bestA and bestB into new cluster
    const merged = [...clusterMembers.get(bestA)!, ...clusterMembers.get(bestB)!];
    clusterMembers.delete(bestA);
    clusterMembers.delete(bestB);
    clusterMembers.set(nextClusterId, merged);
    for (const m of merged) clusterOf[m] = nextClusterId;
    nextClusterId++;
    mergeCount++;
  }

  // Step 5: Build output — assign community IDs and labels
  const communities: { id: number; label: string; members: string[]; concepts: string[]; size: number }[] = [];
  const pageCommunity: Record<string, number> = {};
  let commId = 0;

  for (const [, members] of clusterMembers) {
    // Community label: top-3 weighted concepts shared by members
    const conceptCounts = new Map<string, number>();
    for (const idx of members) {
      for (const c of srcConcepts.get(sourceList[idx].slug)!) {
        const w = conceptWeight.get(c) ?? 0;
        conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + w);
      }
    }
    const topConcepts = [...conceptCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c]) => c);

    const memberSlugs = members.map(i => sourceList[i].slug);

    // Get display names for label
    const conceptTitles = topConcepts.map(c => {
      const page = concepts.find(p => p.slug === c);
      return page ? (page.slug.split("-").map(w => w[0]?.toUpperCase() + w.slice(1)).join(" ")) : c;
    });
    const label = conceptTitles.join(" × ");

    communities.push({ id: commId, label, members: memberSlugs, concepts: topConcepts, size: memberSlugs.length });
    for (const slug of memberSlugs) pageCommunity[slug] = commId;
    commId++;
  }

  // Sort communities by size descending
  communities.sort((a, b) => b.size - a.size);
  // Reassign IDs after sort
  for (let i = 0; i < communities.length; i++) {
    const old = communities[i].id;
    communities[i].id = i;
    for (const slug of communities[i].members) pageCommunity[slug] = i;
  }

  // Step 6: Assign concepts and synthesis to communities
  for (const concept of concepts) {
    // Concept belongs to community with most of its source members
    const commCounts = new Map<number, number>();
    for (const rel of relations) {
      const srcSlug = rel.source === concept.slug ? rel.target : (rel.target === concept.slug ? rel.source : null);
      if (srcSlug && pageCommunity[srcSlug] !== undefined) {
        const cid = pageCommunity[srcSlug];
        commCounts.set(cid, (commCounts.get(cid) ?? 0) + 1);
      }
    }
    if (commCounts.size > 0) {
      const bestComm = [...commCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      pageCommunity[concept.slug] = bestComm;
    }
  }
  for (const synth of pages.filter(p => p.type === "synthesis")) {
    const commCounts = new Map<number, number>();
    for (const rel of relations) {
      const linked = rel.source === synth.slug ? rel.target : (rel.target === synth.slug ? rel.source : null);
      if (linked && pageCommunity[linked] !== undefined) {
        const cid = pageCommunity[linked];
        commCounts.set(cid, (commCounts.get(cid) ?? 0) + 1);
      }
    }
    if (commCounts.size > 0) {
      const bestComm = [...commCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      pageCommunity[synth.slug] = bestComm;
    }
  }

  // Write output
  const output = {
    algorithm: "shared-concept-clustering",
    threshold,
    computed: new Date().toISOString().split("T")[0],
    communities,
    page_community: pageCommunity,
  };

  const outPath = resolve(KB_DIR, "communities.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  // Summary
  console.log(`Shared-concept clustering: ${n} sources → ${communities.length} communities`);
  console.log(`  Threshold: ${threshold}, Merges: ${mergeCount}`);
  console.log(`  Total pages assigned: ${Object.keys(pageCommunity).length}`);
  console.log(`\nCommunities (top 10):`);
  for (const c of communities.slice(0, 10)) {
    console.log(`  [${c.id}] ${c.label} (${c.size} sources)`);
  }
  console.log(`\nSaved: ${outPath}`);
}

// ── Main ──────────────────────────────────────────────────────────────
const { mode, args } = parseArgs(process.argv);
switch (mode) {
  case "scan": cmdScan(); break;
  case "add": cmdAdd(args); break;
  case "query": cmdQuery(args); break;
  case "bridges": cmdBridges(); break;
  case "stats": cmdStats(); break;
  case "export-dot": cmdExportDot(); break;
  case "features": cmdFeatures(); break;
  case "communities": cmdCommunities(); break;
  default: console.error(`Unknown mode: ${mode}`); process.exit(1);
}
