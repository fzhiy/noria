#!/usr/bin/env npx tsx
/**
 * NORIA Canvas Generator v3 — Community-clustered, readable Obsidian Canvas maps.
 *
 * Key changes from v2:
 *   - Community-based grouping from .kb/communities.json (replaces domain grid)
 *   - Vertical column layout ~2000x3000px (replaces 6180x740 horizontal)
 *   - Edge filtering: default shows extends/supports/contradicts/related only
 *   - Node size encoding by page type and importance metrics
 *   - Color by provenance (replaces color by domain/type)
 *
 * Usage:
 *   npx tsx tools/kb-canvas.ts                                    # Overview (concepts+synthesis)
 *   npx tsx tools/kb-canvas.ts --full                             # Full map (all pages, file nodes)
 *   npx tsx tools/kb-canvas.ts --domain agent                     # Domain-scoped
 *   npx tsx tools/kb-canvas.ts --scoped self-evolving-agent       # Concept-centered sub-graph
 *   npx tsx tools/kb-canvas.ts --scoped self-evolving-agent --depth 3
 *   npx tsx tools/kb-canvas.ts --output wiki/my-map.canvas
 *   npx tsx tools/kb-canvas.ts --all                              # Regenerate overview + domain canvases
 *   npx tsx tools/kb-canvas.ts --all-edges                        # Include wikilink+related edges
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const RELATIONS = resolve(ROOT, ".kb", "relations.jsonl");
const COMMUNITIES = resolve(ROOT, ".kb", "communities.json");

// ── Types ─────────────────────────────────────────────────────────────
interface CanvasNode {
  id: string;
  type: "text" | "file" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  label?: string;
  color?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
  color?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface PageInfo {
  slug: string;
  dir: string;
  title: string;
  type: string;
  provenance: string;
  domain: string;
  venueTier: string;
  citations: number;
  tags: string[];
  sourceCount: number;
}

interface Relation {
  source: string;
  target: string;
  type: string;
  evidence?: string;
}

interface Community {
  id: number;
  label: string;
  members: string[];
  concepts?: string[];
  size: number;
}

interface CommunitiesData {
  communities: Community[];
  page_community: Record<string, number>;
}

// ── Frontmatter parser ────────────────────────────────────────────────
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

// ── Load data ─────────────────────────────────────────────────────────
function loadPages(domainFilter?: string): PageInfo[] {
  const pages: PageInfo[] = [];
  for (const dir of ["sources", "concepts", "synthesis"]) {
    const dirPath = resolve(WIKI, dir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(resolve(dirPath, f), "utf-8");
      const fm = parseFm(content);
      if (!fm) continue;
      const slug = f.replace(/\.md$/, "");
      const domain = String(fm.domain ?? inferDomain(fm.tags ?? [], dir));
      if (domainFilter && domain !== domainFilter) continue;

      pages.push({
        slug,
        dir,
        title: String(fm.title ?? slug).slice(0, 80),
        type: String(fm.type ?? dir.replace(/s$/, "")),
        provenance: String(fm.provenance ?? "unknown"),
        domain,
        venueTier: String(fm.venue_tier ?? ""),
        citations: parseInt(String(fm.citation_count ?? fm.citations ?? "0"), 10) || 0,
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        sourceCount: Array.isArray(fm.sources) ? fm.sources.length : 0,
      });
    }
  }
  return pages;
}

function inferDomain(tags: string[], dir: string): string {
  const t = tags.join(" ").toLowerCase();
  if (t.includes("web-agent") || t.includes("gui-agent") || t.includes("browser") || t.includes("agent-safety") || t.includes("self-evolving") || t.includes("terminal-agent")) return "agent";
  if (t.includes("peft") || t.includes("lora") || t.includes("model-merging") || t.includes("tensor") || t.includes("spectral")) return "peft";
  if (t.includes("drift") || t.includes("non-stationary")) return "drift";
  if (t.includes("benchmark") || t.includes("evaluation")) return "benchmark";
  if (t.includes("continual-learning") || t.includes("catastrophic-forgetting")) return "foundational";
  return "other";
}

function loadRelations(): Relation[] {
  if (!existsSync(RELATIONS)) return [];
  return readFileSync(RELATIONS, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l) as Relation; } catch { return null; }
  }).filter(Boolean) as Relation[];
}

function loadCommunities(): CommunitiesData | null {
  if (!existsSync(COMMUNITIES)) return null;
  try {
    return JSON.parse(readFileSync(COMMUNITIES, "utf-8")) as CommunitiesData;
  } catch {
    return null;
  }
}

// ── Color by provenance ─────────────────────────────────────────────
const PROVENANCE_COLORS: Record<string, string> = {
  "source-derived": "4",  // blue
  "llm-derived": "3",     // green
  "social-lead": "2",     // orange
  "user-verified": "6",   // purple
};

const EDGE_COLORS: Record<string, string> = {
  related: "5",      // cyan
  extends: "6",      // purple
  contradicts: "1",  // red
  supports: "3",     // green
  wikilink: "0",     // default (grey)
};

// Edge types: overview shows wikilinks (concept↔concept only have wikilinks).
// Full mode hides wikilinks (too many source→concept wikilinks).
const OVERVIEW_EDGE_TYPES = new Set(["extends", "supports", "contradicts", "related", "wikilink"]);
const FULL_EDGE_TYPES = new Set(["extends", "supports", "contradicts", "related"]);

// ── Node sizing ─────────────────────────────────────────────────────
function nodeSize(page: PageInfo): { w: number; h: number } {
  if (page.dir === "synthesis") {
    return { w: 400, h: 220 };
  }
  if (page.dir === "concepts") {
    // Scale by number of sources: min 250x160, max 350x220
    const t = Math.min(1, page.sourceCount / 10);
    return {
      w: Math.round(250 + t * 100),
      h: Math.round(160 + t * 60),
    };
  }
  // sources: scale by citation_count: min 200x120, max 300x180
  const t = Math.min(1, page.citations / 50);
  return {
    w: Math.round(200 + t * 100),
    h: Math.round(120 + t * 60),
  };
}

function nodeColor(page: PageInfo): string {
  return PROVENANCE_COLORS[page.provenance] ?? "0";
}

// ── Layout constants ────────────────────────────────────────────────
const COMMUNITY_COL_COUNT = 3;   // columns of community groups
const COMMUNITY_GAP_X = 100;     // horizontal gap between community columns
const COMMUNITY_GAP_Y = 80;      // vertical gap between community groups in a column
const GROUP_PADDING = 30;
const NODE_GAP = 16;

// ── Circular/packed layout within a community group ─────────────────
function layoutCommunityNodes(
  pages: PageInfo[],
  centerX: number,
  centerY: number,
  slugToId: Map<string, string>,
  nodes: CanvasNode[],
): { width: number; height: number } {
  if (pages.length === 0) return { width: 0, height: 0 };

  if (pages.length === 1) {
    const p = pages[0];
    const sz = nodeSize(p);
    const nodeId = `node-${p.slug}`;
    slugToId.set(p.slug, nodeId);
    nodes.push({
      id: nodeId,
      type: "file",
      x: centerX,
      y: centerY,
      width: sz.w,
      height: sz.h,
      file: `${p.dir}/${p.slug}.md`,
      color: nodeColor(p),
    });
    return { width: sz.w, height: sz.h };
  }

  // Sort: synthesis first, then concepts, then sources (largest nodes at center)
  const sorted = [...pages].sort((a, b) => {
    const order: Record<string, number> = { synthesis: 0, concepts: 1, sources: 2 };
    return (order[a.dir] ?? 2) - (order[b.dir] ?? 2);
  });

  // Use a packed rows layout: place nodes in rows, centering each row
  const maxRowWidth = 600;
  const rows: { pages: PageInfo[]; sizes: { w: number; h: number }[]; totalW: number; maxH: number }[] = [];
  let currentRow: typeof rows[0] = { pages: [], sizes: [], totalW: 0, maxH: 0 };

  for (const p of sorted) {
    const sz = nodeSize(p);
    const newWidth = currentRow.totalW + (currentRow.pages.length > 0 ? NODE_GAP : 0) + sz.w;
    if (currentRow.pages.length > 0 && newWidth > maxRowWidth) {
      rows.push(currentRow);
      currentRow = { pages: [], sizes: [], totalW: 0, maxH: 0 };
    }
    currentRow.pages.push(p);
    currentRow.sizes.push(sz);
    currentRow.totalW += (currentRow.pages.length > 1 ? NODE_GAP : 0) + sz.w;
    currentRow.maxH = Math.max(currentRow.maxH, sz.h);
  }
  if (currentRow.pages.length > 0) rows.push(currentRow);

  // Compute total height and max width
  let totalHeight = 0;
  let maxWidth = 0;
  for (let r = 0; r < rows.length; r++) {
    totalHeight += rows[r].maxH;
    if (r > 0) totalHeight += NODE_GAP;
    maxWidth = Math.max(maxWidth, rows[r].totalW);
  }

  // Place nodes, centering each row horizontally
  let curY = centerY;
  for (const row of rows) {
    let curX = centerX + (maxWidth - row.totalW) / 2;
    for (let i = 0; i < row.pages.length; i++) {
      const p = row.pages[i];
      const sz = row.sizes[i];
      const nodeId = `node-${p.slug}`;
      slugToId.set(p.slug, nodeId);
      nodes.push({
        id: nodeId,
        type: "file",
        x: Math.round(curX),
        y: Math.round(curY + (row.maxH - sz.h) / 2), // vertically center within row
        width: sz.w,
        height: sz.h,
        file: `${p.dir}/${p.slug}.md`,
        color: nodeColor(p),
      });
      curX += sz.w + NODE_GAP;
    }
    curY += row.maxH + NODE_GAP;
  }

  return { width: maxWidth, height: totalHeight };
}

// ── Standard canvas generation (overview / full / domain) ────────────
function generateStandardCanvas(
  pages: PageInfo[],
  relations: Relation[],
  opts: { conceptsOnly: boolean; allEdges: boolean },
): CanvasData {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const slugToId = new Map<string, string>();

  const filtered = opts.conceptsOnly
    ? pages.filter(p => p.dir === "concepts" || p.dir === "synthesis")
    : pages;

  // Load community data
  const commData = loadCommunities();

  // Build community -> pages mapping
  const communityPages = new Map<number, PageInfo[]>();
  const unassigned: PageInfo[] = [];

  if (commData) {
    // Initialize empty arrays for each community
    for (const c of commData.communities) {
      communityPages.set(c.id, []);
    }
    for (const p of filtered) {
      const cid = commData.page_community[p.slug];
      if (cid !== undefined && communityPages.has(cid)) {
        communityPages.get(cid)!.push(p);
      } else {
        unassigned.push(p);
      }
    }
    // Remove empty communities
    for (const [cid, plist] of communityPages) {
      if (plist.length === 0) communityPages.delete(cid);
    }
  } else {
    // Fallback: single group with all pages
    communityPages.set(0, filtered);
  }

  // If there are unassigned pages, create an "Other" community
  if (unassigned.length > 0) {
    communityPages.set(-1, unassigned);
  }

  // Sort communities by size descending so largest gets placed first
  const sortedCommunities = [...communityPages.entries()].sort((a, b) => b[1].length - a[1].length);

  // Vertical column layout: distribute communities across COMMUNITY_COL_COUNT columns
  const colHeights: number[] = new Array(COMMUNITY_COL_COUNT).fill(0);
  const colXOffsets: number[] = [];
  const colWidth = 700; // max width for each column including group padding
  for (let c = 0; c < COMMUNITY_COL_COUNT; c++) {
    colXOffsets.push(c * (colWidth + COMMUNITY_GAP_X));
  }

  // Community color palette (rotating)
  const COMMUNITY_GROUP_COLORS = ["1", "3", "5", "2", "4", "6", "1", "3", "5", "2", "4", "6"];

  for (const [cid, cPages] of sortedCommunities) {
    // Pick the shortest column
    let shortestCol = 0;
    for (let c = 1; c < COMMUNITY_COL_COUNT; c++) {
      if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
    }

    const groupX = colXOffsets[shortestCol];
    const groupY = colHeights[shortestCol];
    const innerX = groupX + GROUP_PADDING;
    const innerY = groupY + GROUP_PADDING + 30; // 30px for label

    // Layout nodes inside this community
    const { width: contentW, height: contentH } = layoutCommunityNodes(
      cPages, innerX, innerY, slugToId, nodes,
    );

    const groupW = Math.max(300, contentW + GROUP_PADDING * 2);
    const groupH = Math.max(200, contentH + GROUP_PADDING * 2 + 30);

    // Community label
    let groupLabel: string;
    if (cid === -1) {
      groupLabel = "Other";
    } else if (commData) {
      const comm = commData.communities.find(c => c.id === cid);
      groupLabel = comm ? comm.label : `Community ${cid}`;
    } else {
      groupLabel = "All Pages";
    }

    nodes.push({
      id: `group-community-${cid}`,
      type: "group",
      x: groupX,
      y: groupY,
      width: groupW,
      height: groupH,
      label: groupLabel,
      color: COMMUNITY_GROUP_COLORS[cid >= 0 ? cid % COMMUNITY_GROUP_COLORS.length : 0],
    });

    colHeights[shortestCol] += groupH + COMMUNITY_GAP_Y;
  }

  // Add edges with filtering
  const allowedTypes = opts.allEdges ? null : (opts.conceptsOnly ? OVERVIEW_EDGE_TYPES : FULL_EDGE_TYPES);
  let edgeCount = 0;
  for (const rel of relations) {
    const fromId = slugToId.get(rel.source);
    const toId = slugToId.get(rel.target);
    if (!fromId || !toId) continue;
    if (allowedTypes && !allowedTypes.has(rel.type)) continue;

    edges.push({
      id: `edge-${edgeCount++}`,
      fromNode: fromId,
      toNode: toId,
      fromSide: "right",
      toSide: "left",
      label: rel.type === "wikilink" ? undefined : rel.type,
      color: EDGE_COLORS[rel.type] ?? undefined,
    });
  }

  return { nodes, edges };
}

// ── Scoped canvas: BFS radial layout from seed concept ───────────────
function generateScopedCanvas(
  pages: PageInfo[],
  relations: Relation[],
  seed: string,
  maxDepth: number,
): CanvasData {
  const pageMap = new Map(pages.map(p => [p.slug, p]));
  if (!pageMap.has(seed)) {
    console.error(`Seed "${seed}" not found. Available concepts:`);
    pages.filter(p => p.dir === "concepts").forEach(p => console.error(`  ${p.slug}`));
    process.exit(1);
  }

  // Build adjacency list from relations
  const adj = new Map<string, Set<string>>();
  for (const rel of relations) {
    if (!adj.has(rel.source)) adj.set(rel.source, new Set());
    if (!adj.has(rel.target)) adj.set(rel.target, new Set());
    adj.get(rel.source)!.add(rel.target);
    adj.get(rel.target)!.add(rel.source);
  }

  // BFS with depth tracking
  const depthMap = new Map<string, number>();
  const queue: { slug: string; depth: number }[] = [{ slug: seed, depth: 0 }];
  depthMap.set(seed, 0);

  while (queue.length > 0) {
    const { slug, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const neighbor of adj.get(slug) ?? []) {
      if (!depthMap.has(neighbor) && pageMap.has(neighbor)) {
        depthMap.set(neighbor, depth + 1);
        queue.push({ slug: neighbor, depth: depth + 1 });
      }
    }
  }

  // Group by BFS depth
  const depthGroups = new Map<number, PageInfo[]>();
  for (const [slug, depth] of depthMap) {
    const page = pageMap.get(slug);
    if (!page) continue;
    if (!depthGroups.has(depth)) depthGroups.set(depth, []);
    depthGroups.get(depth)!.push(page);
  }

  // Collect scoped relations
  const scopedRelations = relations.filter(
    r => depthMap.has(r.source) && depthMap.has(r.target)
  );

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const slugToId = new Map<string, string>();

  // Radial layout: seed at center, depth 1 in ring around it, depth 2 outer ring
  const CENTER_X = 1200;
  const CENTER_Y = 1200;
  const RING_RADIUS_BASE = 500;  // radius for depth 1
  const RING_RADIUS_STEP = 450;  // additional radius per depth

  for (const [depth, depthPages] of depthGroups) {
    // Sort: synthesis first, then concepts, then sources (for consistent ordering)
    depthPages.sort((a, b) => {
      const order: Record<string, number> = { synthesis: 0, concepts: 1, sources: 2 };
      return (order[a.dir] ?? 3) - (order[b.dir] ?? 3);
    });

    if (depth === 0) {
      // Seed node at center — larger
      const p = depthPages[0];
      const { w, h } = nodeSize(p);
      const nodeId = `node-${p.slug}`;
      slugToId.set(p.slug, nodeId);
      nodes.push({
        id: nodeId,
        type: "file",
        x: CENTER_X - w / 2,
        y: CENTER_Y - h / 2,
        width: Math.round(w * 1.3),
        height: Math.round(h * 1.3),
        file: `${p.dir}/${p.slug}.md`,
        color: "6", // purple — seed highlight
      });
    } else {
      // Arrange in a ring at this depth
      const radius = RING_RADIUS_BASE + (depth - 1) * RING_RADIUS_STEP;
      const angleStep = (2 * Math.PI) / depthPages.length;

      for (let i = 0; i < depthPages.length; i++) {
        const p = depthPages[i];
        const { w, h } = nodeSize(p);
        const angle = angleStep * i - Math.PI / 2; // start from top
        const cx = CENTER_X + radius * Math.cos(angle);
        const cy = CENTER_Y + radius * Math.sin(angle);
        const nodeId = `node-${p.slug}`;
        slugToId.set(p.slug, nodeId);
        nodes.push({
          id: nodeId,
          type: "file",
          x: Math.round(cx - w / 2),
          y: Math.round(cy - h / 2),
          width: w,
          height: h,
          file: `${p.dir}/${p.slug}.md`,
          color: nodeColor(p),
        });
      }
    }

    // Add group ring for each depth > 0
    if (depth > 0 && depthPages.length > 0) {
      const radius = RING_RADIUS_BASE + (depth - 1) * RING_RADIUS_STEP;
      const ringSize = radius * 2 + 400;
      nodes.push({
        id: `group-depth-${depth}`,
        type: "group",
        x: Math.round(CENTER_X - ringSize / 2),
        y: Math.round(CENTER_Y - ringSize / 2),
        width: ringSize,
        height: ringSize,
        label: depth === 1 ? "Direct connections" : `Depth ${depth}`,
        color: depth === 1 ? "5" : "0",
      });
    }
  }

  // Edge filtering: show semantic edges + wikilinks between concepts only
  const scopedConceptSlugs = new Set(
    [...depthMap.keys()].filter(s => {
      const p = pageMap.get(s);
      return p && (p.dir === "concepts" || p.dir === "synthesis");
    })
  );
  let edgeCount = 0;
  for (const rel of scopedRelations) {
    const fromId = slugToId.get(rel.source);
    const toId = slugToId.get(rel.target);
    if (!fromId || !toId) continue;
    // Show wikilinks only between concepts; show semantic types always
    if (rel.type === "wikilink" && !(scopedConceptSlugs.has(rel.source) && scopedConceptSlugs.has(rel.target))) {
      continue;
    }
    edges.push({
      id: `edge-${edgeCount++}`,
      fromNode: fromId,
      toNode: toId,
      fromSide: "bottom",
      toSide: "top",
      label: rel.type === "wikilink" ? undefined : rel.type,
      color: EDGE_COLORS[rel.type] ?? undefined,
    });
  }

  return { nodes, edges };
}

// ── Batch generation (--all) ─────────────────────────────────────────
function generateAll(pages: PageInfo[], relations: Relation[], allEdges: boolean) {
  const results: { path: string; nodes: number; edges: number }[] = [];

  // 1. Overview (concepts + synthesis only)
  const overview = generateStandardCanvas(pages, relations, { conceptsOnly: true, allEdges });
  const overviewPath = resolve(WIKI, "overview.canvas");
  writeFileSync(overviewPath, JSON.stringify(overview, null, 2));
  results.push({ path: "wiki/overview.canvas", nodes: overview.nodes.length, edges: overview.edges.length });

  // 2. Domain canvases (with sources)
  for (const domain of ["agent", "peft", "drift", "benchmark", "foundational"]) {
    const domainPages = pages.filter(p => p.domain === domain);
    if (domainPages.length === 0) continue;
    const canvas = generateStandardCanvas(domainPages, relations, { conceptsOnly: false, allEdges });
    const canvasDir = resolve(WIKI, "canvas");
    mkdirSync(canvasDir, { recursive: true });
    const path = resolve(canvasDir, `${domain}-domain.canvas`);
    writeFileSync(path, JSON.stringify(canvas, null, 2));
    results.push({ path: `wiki/canvas/${domain}-domain.canvas`, nodes: canvas.nodes.length, edges: canvas.edges.length });
  }

  // Scoped canvases deprecated (GPT-5.4 xhigh review: DEPRECATE verdict).
  // Use --scoped <concept> for manual one-off generation if needed.

  return results;
}

// ── CLI ──────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  let domain: string | undefined;
  let scoped: string | undefined;
  let depth = 2;
  let full = false;
  let all = false;
  let allEdges = false;
  let output: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--domain" && argv[i + 1]) domain = argv[++i];
    else if (argv[i] === "--scoped" && argv[i + 1]) scoped = argv[++i];
    else if (argv[i] === "--depth" && argv[i + 1]) depth = parseInt(argv[++i], 10);
    else if (argv[i] === "--full") full = true;
    else if (argv[i] === "--all") all = true;
    else if (argv[i] === "--all-edges") allEdges = true;
    else if (argv[i] === "--output" && argv[i + 1]) output = resolve(argv[++i]);
  }

  const pages = loadPages(domain);
  const relations = loadRelations();

  if (all) {
    console.log(`Generating all canvases: ${pages.length} pages, ${relations.length} relations\n`);
    const results = generateAll(loadPages(), relations, allEdges);
    console.log("Generated canvases:");
    for (const r of results) {
      console.log(`  ${r.path}: ${r.nodes} nodes, ${r.edges} edges`);
    }
    return;
  }

  if (scoped) {
    console.log(`Generating scoped canvas: seed="${scoped}", depth=${depth}`);
    const allPages = loadPages(); // need all pages for BFS
    const canvas = generateScopedCanvas(allPages, relations, scoped, depth);
    const out = output ?? resolve(WIKI, "canvas", `${scoped}.canvas`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(canvas, null, 2));
    console.log(`  Nodes: ${canvas.nodes.length}, Edges: ${canvas.edges.length}`);
    console.log(`  Saved: ${out}`);
    return;
  }

  // Default: overview (concepts + synthesis only) unless --full
  const conceptsOnly = !full;
  const canvas = generateStandardCanvas(pages, relations, { conceptsOnly, allEdges });
  const out = output ?? resolve(WIKI, full ? "noria-map.canvas" : "overview.canvas");

  console.log(`Generating ${full ? "full" : "overview"} canvas: ${pages.length} pages, ${relations.length} relations`);
  console.log(`  Nodes: ${canvas.nodes.length} (${canvas.nodes.filter(n => n.type === "group").length} groups, ${canvas.nodes.filter(n => n.type === "file").length} file nodes)`);
  console.log(`  Edges: ${canvas.edges.length}`);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(canvas, null, 2));
  console.log(`  Saved: ${out}`);
}

main();
