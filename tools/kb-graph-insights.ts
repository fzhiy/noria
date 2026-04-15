#!/usr/bin/env npx tsx
/**
 * Graph Insights — zero-LLM analysis for surprising connections, sparse communities, and hub bridges.
 *
 * Reads from .kb/ state files (relations.jsonl, communities.json, graph-features.json).
 * Outputs human-readable reports or JSON for downstream consumption.
 *
 * Usage:
 *   npx tsx tools/kb-graph-insights.ts --surprise     # Cross-community surprising edges
 *   npx tsx tools/kb-graph-insights.ts --sparse        # Weak communities (cohesion < 1.5)
 *   npx tsx tools/kb-graph-insights.ts --hubs          # Bridge nodes connecting 3+ communities
 *   npx tsx tools/kb-graph-insights.ts --all           # All three analyses
 *   npx tsx tools/kb-graph-insights.ts --all --json    # Machine-readable output
 *   npx tsx tools/kb-graph-insights.ts --all --save    # Save to outputs/reviews/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KB = resolve(ROOT, ".kb");
const RELATIONS_FILE = resolve(KB, "relations.jsonl");
const COMMUNITIES_FILE = resolve(KB, "communities.json");
const FEATURES_FILE = resolve(KB, "graph-features.json");
const OUTPUTS = resolve(ROOT, "outputs", "reviews");

// ── Types ─────────────────────────────────────────────────────────────
interface Relation {
  source: string;
  target: string;
  type: string;
  evidence?: string;
  origin: string;
  created: string;
}

interface SurpriseEdge {
  source: string;
  target: string;
  surprise: number;
  community_diff: number;
  type_diff: number;
  centrality_contrast: number;
  source_community: number;
  target_community: number;
}

interface SparseCommunity {
  id: number;
  label: string;
  size: number;
  cohesion: number;
  concepts: string[];
}

interface HubNode {
  slug: string;
  type: string;
  communities_bridged: number[];
  bridge_count: number;
  centrality: number;
}

// ── Loaders ───────────────────────────────────────────────────────────
function loadRelations(): Relation[] {
  if (!existsSync(RELATIONS_FILE)) return [];
  return readFileSync(RELATIONS_FILE, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean) as Relation[];
}

function loadCommunities(): { communities: any[]; page_community: Record<string, number> } {
  if (!existsSync(COMMUNITIES_FILE)) {
    console.error("No communities.json found. Run: npx tsx tools/kb-relations.ts --communities");
    process.exit(1);
  }
  return JSON.parse(readFileSync(COMMUNITIES_FILE, "utf-8"));
}

function loadFeatures(): Record<string, any> {
  if (!existsSync(FEATURES_FILE)) return {};
  return JSON.parse(readFileSync(FEATURES_FILE, "utf-8"));
}

// ── Surprise Edge Detection ──────────────────────────────────────────
function detectSurpriseEdges(relations: Relation[], pageCommunity: Record<string, number>, features: Record<string, any>): SurpriseEdge[] {
  const edges: SurpriseEdge[] = [];

  for (const r of relations) {
    if (r.type !== "wikilink") continue;
    const srcComm = pageCommunity[r.source];
    const tgtComm = pageCommunity[r.target];
    if (srcComm === undefined || tgtComm === undefined) continue;

    // Only cross-community edges are surprising
    const community_diff = srcComm !== tgtComm ? 1.0 : 0.0;
    if (community_diff === 0) continue;

    // Type difference: cross-type (source↔concept) is more surprising
    const srcType = features[r.source]?.type ?? "unknown";
    const tgtType = features[r.target]?.type ?? "unknown";
    const type_diff = srcType !== tgtType ? 1.0 : 0.5;

    // Centrality contrast: peripheral-to-hub coupling
    const srcCent = features[r.source]?.centrality ?? 0;
    const tgtCent = features[r.target]?.centrality ?? 0;
    const epsilon = 0.01;
    const centrality_contrast = Math.min(
      Math.log2(1 + Math.max(srcCent, tgtCent)) / Math.log2(1 + Math.min(srcCent, tgtCent) + epsilon),
      5.0
    );

    const surprise = community_diff * type_diff * centrality_contrast;
    if (surprise > 0.1) {
      edges.push({
        source: r.source, target: r.target,
        surprise, community_diff, type_diff, centrality_contrast,
        source_community: srcComm, target_community: tgtComm,
      });
    }
  }

  return edges.sort((a, b) => b.surprise - a.surprise);
}

// ── Sparse Community Detection ───────────────────────────────────────
function detectSparseCommunities(communities: any[]): SparseCommunity[] {
  return communities
    .filter(c => c.cohesion !== undefined && c.cohesion < 1.5 && c.size >= 3)
    .map(c => ({ id: c.id, label: c.label, size: c.size, cohesion: c.cohesion, concepts: c.concepts }))
    .sort((a, b) => a.cohesion - b.cohesion);
}

// ── Hub / Bridge Node Detection ──────────────────────────────────────
function detectHubBridges(relations: Relation[], pageCommunity: Record<string, number>, features: Record<string, any>): HubNode[] {
  // For each page, find which communities its wikilink neighbors belong to
  const pageBridged = new Map<string, Set<number>>();

  for (const r of relations) {
    if (r.type !== "wikilink") continue;
    const srcComm = pageCommunity[r.source];
    const tgtComm = pageCommunity[r.target];

    if (srcComm !== undefined && tgtComm !== undefined && srcComm !== tgtComm) {
      if (!pageBridged.has(r.source)) pageBridged.set(r.source, new Set());
      if (!pageBridged.has(r.target)) pageBridged.set(r.target, new Set());
      pageBridged.get(r.source)!.add(tgtComm);
      pageBridged.get(r.target)!.add(srcComm);
      // Also add own community
      pageBridged.get(r.source)!.add(srcComm);
      pageBridged.get(r.target)!.add(tgtComm);
    }
  }

  const hubs: HubNode[] = [];
  for (const [slug, comms] of pageBridged) {
    if (comms.size >= 3) {
      hubs.push({
        slug,
        type: features[slug]?.type ?? "unknown",
        communities_bridged: [...comms].sort(),
        bridge_count: comms.size,
        centrality: features[slug]?.centrality ?? 0,
      });
    }
  }

  return hubs.sort((a, b) => b.bridge_count - a.bridge_count || b.centrality - a.centrality);
}

// ── Output Formatting ────────────────────────────────────────────────
function formatReport(surpriseEdges: SurpriseEdge[], sparseComms: SparseCommunity[], hubs: HubNode[]): string {
  const lines: string[] = ["# Graph Insights Report", `Generated: ${new Date().toISOString().split("T")[0]}`, ""];

  if (surpriseEdges.length > 0) {
    lines.push("## Surprising Cross-Community Connections", "");
    lines.push("| Source | Target | Surprise | Comm | Type Diff |");
    lines.push("|--------|--------|----------|------|-----------|");
    for (const e of surpriseEdges.slice(0, 20)) {
      lines.push(`| ${e.source} | ${e.target} | ${e.surprise.toFixed(2)} | ${e.source_community}→${e.target_community} | ${e.type_diff === 1.0 ? "cross-type" : "same-type"} |`);
    }
    lines.push(`\nTotal: ${surpriseEdges.length} surprising edges (showing top 20)`, "");
  }

  if (sparseComms.length > 0) {
    lines.push("## Sparse Communities (cohesion < 1.5, ≥3 members)", "");
    for (const c of sparseComms) {
      lines.push(`- **[${c.id}] ${c.label}** — ${c.size} sources, cohesion=${c.cohesion}`);
      lines.push(`  Concepts: ${c.concepts.join(", ")}`);
      lines.push(`  Action: \`/kb-sync s2 "${c.concepts[0]}" --limit 5\` to strengthen`);
    }
    lines.push("");
  }

  if (hubs.length > 0) {
    lines.push("## Bridge Nodes (connecting 3+ communities)", "");
    lines.push("| Page | Type | Communities | Centrality |");
    lines.push("|------|------|-------------|------------|");
    for (const h of hubs.slice(0, 15)) {
      lines.push(`| ${h.slug} | ${h.type} | ${h.communities_bridged.join(",")} | ${h.centrality} |`);
    }
    lines.push(`\nTotal: ${hubs.length} bridge nodes (showing top 15)`, "");
  }

  if (surpriseEdges.length === 0 && sparseComms.length === 0 && hubs.length === 0) {
    lines.push("No actionable insights found. Knowledge graph appears well-connected.", "");
  }

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const doSurprise = args.includes("--surprise") || args.includes("--all");
const doSparse = args.includes("--sparse") || args.includes("--all");
const doHubs = args.includes("--hubs") || args.includes("--all");
const asJson = args.includes("--json");
const doSave = args.includes("--save");

if (!doSurprise && !doSparse && !doHubs) {
  console.error("Usage: npx tsx tools/kb-graph-insights.ts --surprise|--sparse|--hubs|--all [--json] [--save]");
  process.exit(1);
}

const relations = loadRelations();
const { communities, page_community } = loadCommunities();
const features = loadFeatures();

const surpriseEdges = doSurprise ? detectSurpriseEdges(relations, page_community, features) : [];
const sparseComms = doSparse ? detectSparseCommunities(communities) : [];
const hubs = doHubs ? detectHubBridges(relations, page_community, features) : [];

if (asJson) {
  const output: any = {};
  if (doSurprise) output.surprise_edges = surpriseEdges;
  if (doSparse) output.sparse_communities = sparseComms;
  if (doHubs) output.hub_bridges = hubs;
  console.log(JSON.stringify(output, null, 2));
} else {
  const report = formatReport(surpriseEdges, sparseComms, hubs);
  console.log(report);

  if (doSave) {
    mkdirSync(OUTPUTS, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const outPath = resolve(OUTPUTS, `${date}-graph-insights.md`);
    writeFileSync(outPath, report, "utf-8");
    console.log(`Saved: ${outPath}`);
  }
}
