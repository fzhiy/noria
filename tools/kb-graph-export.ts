#!/usr/bin/env npx tsx
/**
 * NORIA Interactive Graph Export — sigma.js v3 knowledge graph visualization.
 *
 * Generates a standalone HTML file with an interactive ForceAtlas2 graph.
 * Loads sigma.js, graphology, and graphology-layout-forceatlas2 from CDN.
 * No npm install needed — this is a code generator, not a web app.
 *
 * Data sources:
 *   wiki/sources/*.md, wiki/concepts/*.md, wiki/synthesis/*.md — frontmatter
 *   .kb/relations.jsonl — typed edges
 *   .kb/communities.json — community assignments and labels
 *
 * Usage:
 *   npx tsx tools/kb-graph-export.ts                    # Overview (concepts + synthesis)
 *   npx tsx tools/kb-graph-export.ts --full             # All pages including sources
 *   npx tsx tools/kb-graph-export.ts --output path.html # Custom output
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const KB = resolve(ROOT, ".kb");

// ── Types ────────────────────────────────────────────────────────────

interface PageInfo {
  slug: string;
  dir: string; // "sources" | "concepts" | "synthesis"
  title: string;
  type: string;
  provenance: string;
  citations: number;
  sourceCount: number;
  tags: string[];
}

interface Relation {
  source: string;
  target: string;
  type: string;
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

interface GraphNode {
  id: string;
  label: string;
  type: string;       // source | concept | synthesis
  provenance: string;
  citations: number;
  sourceCount: number;
  community: number;
  communityLabel: string;
  size: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

// ── Frontmatter parser (matches kb-canvas.ts pattern) ────────────────

function parseFm(text: string): Record<string, any> | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "").trim();
    }
  }
  return Object.keys(fm).length > 0 ? fm : null;
}

// ── Data loaders ─────────────────────────────────────────────────────

function loadPages(): PageInfo[] {
  const pages: PageInfo[] = [];
  for (const dir of ["sources", "concepts", "synthesis"] as const) {
    const dirPath = resolve(WIKI, dir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(resolve(dirPath, f), "utf-8");
      const fm = parseFm(content);
      if (!fm) continue;
      const slug = f.replace(/\.md$/, "");
      pages.push({
        slug,
        dir,
        title: String(fm.title ?? slug).slice(0, 80),
        type: String(fm.type ?? dir.replace(/s$/, "")),
        provenance: String(fm.provenance ?? "unknown"),
        citations: parseInt(String(fm.citation_count ?? fm.citations ?? "0"), 10) || 0,
        sourceCount: Array.isArray(fm.sources) ? fm.sources.length : 0,
        tags: Array.isArray(fm.tags) ? fm.tags : [],
      });
    }
  }
  return pages;
}

function loadRelations(): Relation[] {
  const path = resolve(KB, "relations.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as Relation;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Relation[];
}

function loadCommunities(): CommunitiesData {
  const path = resolve(KB, "communities.json");
  if (!existsSync(path)) {
    return { communities: [], page_community: {} };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CommunitiesData;
  } catch {
    return { communities: [], page_community: {} };
  }
}

// ── Graph data builder ───────────────────────────────────────────────

const COMMUNITY_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4",
  "#f032e6", "#bfef45", "#fabed4", "#469990", "#dcbeff", "#9A6324",
];

function buildGraphData(
  pages: PageInfo[],
  relations: Relation[],
  communities: CommunitiesData,
  full: boolean,
): { nodes: GraphNode[]; edges: GraphEdge[]; communityLabels: { id: number; label: string; color: string }[] } {
  // Filter pages
  const filtered = full
    ? pages
    : pages.filter(p => p.dir === "concepts" || p.dir === "synthesis");

  const slugSet = new Set(filtered.map(p => p.slug));

  // Build community lookup
  const communityMap = communities.page_community ?? {};
  const communityLabelMap = new Map<number, string>();
  for (const c of communities.communities ?? []) {
    communityLabelMap.set(c.id, c.label);
  }

  // Compute node sizes
  // Synthesis: largest (fixed large). Concepts: by sourceCount. Sources: by citations.
  const nodes: GraphNode[] = filtered.map(p => {
    const communityId = communityMap[p.slug] ?? -1;
    const communityLabel = communityLabelMap.get(communityId) ?? "Uncategorized";
    let size: number;
    if (p.dir === "synthesis") {
      size = 20;
    } else if (p.dir === "concepts") {
      size = Math.max(8, Math.min(18, 6 + p.sourceCount * 0.8));
    } else {
      // sources
      size = Math.max(4, Math.min(14, 4 + p.citations * 0.5));
    }
    return {
      id: p.slug,
      label: p.title.length > 40 ? p.title.slice(0, 37) + "..." : p.title,
      type: p.type || p.dir.replace(/s$/, ""),
      provenance: p.provenance,
      citations: p.citations,
      sourceCount: p.sourceCount,
      community: communityId,
      communityLabel,
      size,
    };
  });

  // Filter edges: only between visible nodes, default to extends/supports/contradicts
  const edgeTypes = full
    ? new Set(["extends", "supports", "contradicts", "related", "wikilink"])
    : new Set(["extends", "supports", "contradicts", "related", "wikilink"]);

  // Deduplicate edges (same source-target-type combo)
  const edgeKey = (e: Relation) => `${e.source}|${e.target}|${e.type}`;
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const r of relations) {
    if (!slugSet.has(r.source) || !slugSet.has(r.target)) continue;
    if (!edgeTypes.has(r.type)) continue;
    const key = edgeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: r.source, target: r.target, type: r.type });
  }

  // Build community legend entries (only for communities with visible nodes)
  const visibleCommunities = new Set(nodes.map(n => n.community));
  const communityLabels = [...visibleCommunities]
    .filter(id => id >= 0)
    .sort((a, b) => a - b)
    .map(id => ({
      id,
      label: communityLabelMap.get(id) ?? `Community ${id}`,
      color: COMMUNITY_COLORS[id % COMMUNITY_COLORS.length],
    }));

  return { nodes, edges, communityLabels };
}

// ── HTML template ────────────────────────────────────────────────────

function generateHtml(data: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communityLabels: { id: number; label: string; color: string }[];
}): string {
  const jsonData = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NORIA Knowledge Graph</title>
  <script src="https://unpkg.com/graphology@0.25.4/dist/graphology.umd.min.js"></script>
  <script src="https://unpkg.com/graphology-layout-forceatlas2@0.10.1/dist/graphology-layout-forceatlas2.umd.min.js"></script>
  <script src="https://unpkg.com/sigma@3/build/sigma.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
    #graph-container { width: 100vw; height: 100vh; }

    /* Search panel */
    #search-panel {
      position: fixed; top: 16px; left: 16px; z-index: 100;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 12px; width: 280px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    #search-panel h3 { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #58a6ff; }
    #search-input {
      width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d;
      border-radius: 6px; color: #c9d1d9; font-size: 13px; outline: none;
    }
    #search-input:focus { border-color: #58a6ff; }
    #search-results {
      max-height: 200px; overflow-y: auto; margin-top: 6px;
    }
    .search-result {
      padding: 5px 8px; cursor: pointer; border-radius: 4px; font-size: 12px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .search-result:hover { background: #21262d; }
    #stats {
      margin-top: 8px; font-size: 11px; color: #8b949e;
    }

    /* Legend panel */
    #legend {
      position: fixed; bottom: 16px; left: 16px; z-index: 100;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 12px; max-width: 320px; max-height: 50vh; overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    #legend h3 { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #58a6ff; }
    .legend-section { margin-bottom: 10px; }
    .legend-section h4 { font-size: 11px; text-transform: uppercase; color: #8b949e; margin-bottom: 4px; letter-spacing: 0.5px; }
    .legend-item {
      display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 12px;
      cursor: pointer;
    }
    .legend-item:hover { color: #f0f6fc; }
    .legend-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    }
    .legend-square {
      width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
    }

    /* Detail panel */
    #detail-panel {
      position: fixed; top: 16px; right: 16px; z-index: 100;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 16px; width: 300px; display: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    #detail-panel.visible { display: block; }
    #detail-close {
      position: absolute; top: 8px; right: 10px; cursor: pointer;
      color: #8b949e; font-size: 16px; line-height: 1; background: none; border: none;
    }
    #detail-close:hover { color: #f0f6fc; }
    #detail-panel h3 { font-size: 15px; font-weight: 600; margin-bottom: 10px; padding-right: 20px; color: #f0f6fc; }
    .detail-row { display: flex; gap: 8px; margin-bottom: 6px; font-size: 12px; }
    .detail-key { color: #8b949e; min-width: 80px; }
    .detail-val { color: #c9d1d9; }
    .badge {
      display: inline-block; padding: 1px 6px; border-radius: 10px;
      font-size: 11px; font-weight: 500;
    }
    .badge-source { background: #1f3a1f; color: #3fb950; }
    .badge-concept { background: #172540; color: #58a6ff; }
    .badge-synthesis { background: #2d1b42; color: #bc8cff; }
    .badge-prov-source-derived { background: #1f3a1f; color: #3fb950; }
    .badge-prov-llm-derived { background: #2d3a1f; color: #d29922; }
    .badge-prov-user-verified { background: #172540; color: #58a6ff; }

    /* Edge toggle */
    #edge-controls {
      position: fixed; top: 16px; left: 310px; z-index: 100;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 10px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    #edge-controls h4 { font-size: 11px; text-transform: uppercase; color: #8b949e; margin-bottom: 6px; letter-spacing: 0.5px; }
    .edge-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 3px; }
    .edge-toggle input { accent-color: #58a6ff; }
  </style>
</head>
<body>
  <div id="graph-container"></div>

  <div id="search-panel">
    <h3>NORIA Knowledge Graph</h3>
    <input id="search-input" type="text" placeholder="Search nodes by title..." autocomplete="off">
    <div id="search-results"></div>
    <div id="stats"></div>
  </div>

  <div id="edge-controls">
    <h4>Edge Types</h4>
    <label class="edge-toggle"><input type="checkbox" data-edge="extends" checked> extends</label>
    <label class="edge-toggle"><input type="checkbox" data-edge="supports" checked> supports</label>
    <label class="edge-toggle"><input type="checkbox" data-edge="contradicts" checked> contradicts</label>
    <label class="edge-toggle"><input type="checkbox" data-edge="related"> related</label>
    <label class="edge-toggle"><input type="checkbox" data-edge="wikilink"> wikilink</label>
  </div>

  <div id="legend"></div>

  <div id="detail-panel">
    <button id="detail-close">&times;</button>
    <h3 id="detail-title"></h3>
    <div id="detail-body"></div>
  </div>

  <script>
  (function() {
    "use strict";

    // ── Inline data ────────────────────────────────────────────────
    var graphData = ${jsonData};

    var COMMUNITY_COLORS = [
      "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4",
      "#f032e6", "#bfef45", "#fabed4", "#469990", "#dcbeff", "#9A6324"
    ];

    var EDGE_COLORS = {
      extends: "#6e40c9",
      supports: "#3fb950",
      contradicts: "#f85149",
      related: "#484f58",
      wikilink: "#30363d"
    };

    // ── Build graphology graph ─────────────────────────────────────
    // graphology UMD may export as class directly or as { default: class }
    var Graph = typeof graphology === "function" ? graphology : graphology.default || graphology;
    var graph = new Graph({ multi: false, type: "directed", allowSelfLoops: false });

    // Add nodes
    graphData.nodes.forEach(function(n) {
      var color = n.community >= 0
        ? COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length]
        : "#484f58";
      graph.addNode(n.id, {
        label: n.label,
        size: n.size,
        color: color,
        x: Math.random() * 100 - 50,
        y: Math.random() * 100 - 50,
        nodeType: n.type,
        provenance: n.provenance,
        citations: n.citations,
        sourceCount: n.sourceCount,
        community: n.community,
        communityLabel: n.communityLabel,
        edgeType: null,
        origColor: color,
        origSize: n.size,
        hidden: false
      });
    });

    // Add edges
    graphData.edges.forEach(function(e, i) {
      var key = e.source + "->" + e.target + ":" + e.type;
      if (!graph.hasEdge(key) && graph.hasNode(e.source) && graph.hasNode(e.target)) {
        try {
          graph.addEdgeWithKey(key, e.source, e.target, {
            color: EDGE_COLORS[e.type] || "#30363d",
            size: e.type === "contradicts" ? 2 : 1,
            edgeType: e.type,
            origColor: EDGE_COLORS[e.type] || "#30363d",
            hidden: (e.type === "related" || e.type === "wikilink")
          });
        } catch(err) {
          // skip duplicate edges
        }
      }
    });

    // ── ForceAtlas2 layout ─────────────────────────────────────────
    var fa2Settings = {
      iterations: 300,
      settings: {
        gravity: 1,
        scalingRatio: 4,
        strongGravityMode: true,
        barnesHutOptimize: graph.order > 100,
        barnesHutTheta: 0.5,
        slowDown: 2,
        adjustSizes: true
      }
    };

    // FA2 UMD may nest under .default
    var fa2Assign = graphologyLayoutForceatlas2.assign || (graphologyLayoutForceatlas2.default && graphologyLayoutForceatlas2.default.assign) || graphologyLayoutForceatlas2;
    if (typeof fa2Assign === "function") {
      fa2Assign(graph, fa2Settings);
    } else if (typeof graphologyLayoutForceatlas2 === "function") {
      graphologyLayoutForceatlas2.assign(graph, fa2Settings);
    }

    // ── Sigma renderer ─────────────────────────────────────────────
    // Sigma v3 UMD exports as namespace: Sigma.Sigma is the constructor
    var SigmaConstructor = (typeof Sigma === "function") ? Sigma : (Sigma && Sigma.Sigma) || Sigma;
    var container = document.getElementById("graph-container");
    var renderer = new SigmaConstructor(graph, container, {
      renderLabels: true,
      labelFont: "12px -apple-system, BlinkMacSystemFont, sans-serif",
      labelColor: { color: "#c9d1d9" },
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: "#30363d",
      defaultNodeColor: "#484f58",
      edgeLabelFont: "10px sans-serif",
      minCameraRatio: 0.08,
      maxCameraRatio: 8,
      nodeReducer: function(node, data) {
        var res = Object.assign({}, data);
        if (data.hidden) {
          res.hidden = true;
        }
        if (highlightedNode && highlightedNode !== node && !highlightedNeighbors.has(node)) {
          res.color = "#21262d";
          res.label = "";
          res.zIndex = 0;
        } else if (highlightedNode === node) {
          res.zIndex = 2;
          res.highlighted = true;
        } else if (highlightedNeighbors.has(node)) {
          res.zIndex = 1;
        }
        if (searchHighlight && searchHighlight === node) {
          res.color = "#f0f6fc";
          res.zIndex = 3;
          res.highlighted = true;
        }
        return res;
      },
      edgeReducer: function(edge, data) {
        var res = Object.assign({}, data);
        if (data.hidden) {
          res.hidden = true;
          return res;
        }
        if (highlightedNode) {
          var src = graph.source(edge);
          var tgt = graph.target(edge);
          if (src !== highlightedNode && tgt !== highlightedNode) {
            res.hidden = true;
          } else {
            res.size = 2;
          }
        }
        return res;
      }
    });

    // ── Interaction state ──────────────────────────────────────────
    var highlightedNode = null;
    var highlightedNeighbors = new Set();
    var searchHighlight = null;

    // Hover highlight
    renderer.on("enterNode", function(e) {
      highlightedNode = e.node;
      highlightedNeighbors = new Set(graph.neighbors(e.node));
      renderer.refresh();
    });
    renderer.on("leaveNode", function() {
      highlightedNode = null;
      highlightedNeighbors = new Set();
      renderer.refresh();
    });

    // ── Click → detail panel ───────────────────────────────────────
    var detailPanel = document.getElementById("detail-panel");
    var detailTitle = document.getElementById("detail-title");
    var detailBody = document.getElementById("detail-body");
    var detailClose = document.getElementById("detail-close");

    renderer.on("clickNode", function(e) {
      var attrs = graph.getNodeAttributes(e.node);
      detailTitle.textContent = attrs.label;

      var typeClass = "badge-" + attrs.nodeType;
      var provClass = "badge-prov-" + (attrs.provenance || "").replace(/\\s+/g, "-");

      detailBody.innerHTML =
        '<div class="detail-row"><span class="detail-key">Slug</span><span class="detail-val">' + e.node + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">Type</span><span class="detail-val"><span class="badge ' + typeClass + '">' + attrs.nodeType + '</span></span></div>' +
        '<div class="detail-row"><span class="detail-key">Provenance</span><span class="detail-val"><span class="badge ' + provClass + '">' + (attrs.provenance || "unknown") + '</span></span></div>' +
        '<div class="detail-row"><span class="detail-key">Citations</span><span class="detail-val">' + (attrs.citations || 0) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">Sources</span><span class="detail-val">' + (attrs.sourceCount || 0) + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">Community</span><span class="detail-val">' + (attrs.communityLabel || "None") + '</span></div>' +
        '<div class="detail-row"><span class="detail-key">Neighbors</span><span class="detail-val">' + graph.neighbors(e.node).length + '</span></div>';

      detailPanel.classList.add("visible");
    });

    renderer.on("clickStage", function() {
      detailPanel.classList.remove("visible");
    });

    detailClose.addEventListener("click", function() {
      detailPanel.classList.remove("visible");
    });

    // ── Search ─────────────────────────────────────────────────────
    var searchInput = document.getElementById("search-input");
    var searchResults = document.getElementById("search-results");

    searchInput.addEventListener("input", function() {
      var query = searchInput.value.toLowerCase().trim();
      searchResults.innerHTML = "";
      searchHighlight = null;

      if (!query) {
        renderer.refresh();
        return;
      }

      var matches = [];
      graph.forEachNode(function(node, attrs) {
        if (attrs.label.toLowerCase().includes(query) || node.toLowerCase().includes(query)) {
          matches.push({ id: node, label: attrs.label });
        }
      });

      matches.slice(0, 15).forEach(function(m) {
        var div = document.createElement("div");
        div.className = "search-result";
        div.textContent = m.label;
        div.addEventListener("click", function() {
          zoomToNode(m.id);
        });
        searchResults.appendChild(div);
      });

      if (matches.length === 1) {
        zoomToNode(matches[0].id);
      }

      renderer.refresh();
    });

    function zoomToNode(nodeId) {
      searchHighlight = nodeId;
      // In sigma v3, camera state uses graph coordinates directly
      // getNodeDisplayData returns screen coords; we need graph coords for camera
      var nodeAttrs = graph.getNodeAttributes(nodeId);
      var camera = renderer.getCamera();
      camera.animate(
        { x: nodeAttrs.x, y: nodeAttrs.y, ratio: 0.15 },
        { duration: 400 }
      );
      renderer.refresh();
    }

    // ── Edge type toggles ──────────────────────────────────────────
    var edgeCheckboxes = document.querySelectorAll("#edge-controls input[data-edge]");
    edgeCheckboxes.forEach(function(cb) {
      cb.addEventListener("change", function() {
        var edgeType = cb.getAttribute("data-edge");
        var show = cb.checked;
        graph.forEachEdge(function(edge, attrs) {
          if (attrs.edgeType === edgeType) {
            graph.setEdgeAttribute(edge, "hidden", !show);
          }
        });
        renderer.refresh();
      });
    });

    // ── Legend panel ────────────────────────────────────────────────
    var legend = document.getElementById("legend");
    var legendHtml = '<h3>Legend</h3>';

    // Community colors
    legendHtml += '<div class="legend-section"><h4>Communities</h4>';
    graphData.communityLabels.forEach(function(c) {
      legendHtml += '<div class="legend-item" data-community="' + c.id + '">' +
        '<span class="legend-dot" style="background:' + c.color + '"></span>' +
        '<span>' + c.label + '</span></div>';
    });
    legendHtml += '</div>';

    // Node type shapes
    legendHtml += '<div class="legend-section"><h4>Node Type (size)</h4>';
    legendHtml += '<div class="legend-item"><span class="legend-dot" style="background:#c9d1d9;width:16px;height:16px"></span><span>synthesis (largest)</span></div>';
    legendHtml += '<div class="legend-item"><span class="legend-dot" style="background:#c9d1d9;width:11px;height:11px"></span><span>concept (medium)</span></div>';
    legendHtml += '<div class="legend-item"><span class="legend-dot" style="background:#c9d1d9;width:7px;height:7px"></span><span>source (small)</span></div>';
    legendHtml += '</div>';

    // Edge type colors
    legendHtml += '<div class="legend-section"><h4>Edge Types</h4>';
    var edgeEntries = [
      { type: "extends", color: "#6e40c9" },
      { type: "supports", color: "#3fb950" },
      { type: "contradicts", color: "#f85149" },
      { type: "related", color: "#484f58" },
      { type: "wikilink", color: "#30363d" }
    ];
    edgeEntries.forEach(function(e) {
      legendHtml += '<div class="legend-item"><span class="legend-square" style="background:' + e.color + '"></span><span>' + e.type + '</span></div>';
    });
    legendHtml += '</div>';

    // Provenance key
    legendHtml += '<div class="legend-section"><h4>Provenance</h4>';
    legendHtml += '<div class="legend-item"><span class="badge badge-prov-source-derived">source-derived</span></div>';
    legendHtml += '<div class="legend-item"><span class="badge badge-prov-llm-derived">llm-derived</span></div>';
    legendHtml += '<div class="legend-item"><span class="badge badge-prov-user-verified">user-verified</span></div>';
    legendHtml += '</div>';

    legend.innerHTML = legendHtml;

    // Community legend click → isolate community; double-click → reset all
    var activeCommunityFilter = null;
    document.querySelectorAll(".legend-item[data-community]").forEach(function(el) {
      el.addEventListener("click", function() {
        var cid = parseInt(el.getAttribute("data-community"), 10);
        if (activeCommunityFilter === cid) {
          // Clicking the same community again resets the filter
          activeCommunityFilter = null;
          graph.forEachNode(function(node) {
            graph.setNodeAttribute(node, "hidden", false);
          });
        } else {
          activeCommunityFilter = cid;
          graph.forEachNode(function(node, attrs) {
            graph.setNodeAttribute(node, "hidden", attrs.community !== cid);
          });
        }
        renderer.refresh();
      });
    });

    // ── Stats ──────────────────────────────────────────────────────
    var statsEl = document.getElementById("stats");
    var visibleEdges = 0;
    graph.forEachEdge(function(e, a) { if (!a.hidden) visibleEdges++; });
    statsEl.textContent = graph.order + " nodes, " + graph.size + " edges (" + visibleEdges + " visible)";

  })();
  </script>
</body>
</html>`;
}

// ── CLI ──────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  let full = false;
  let output: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--full") full = true;
    else if (argv[i] === "--output" && argv[i + 1]) output = resolve(argv[++i]);
  }

  const pages = loadPages();
  const relations = loadRelations();
  const communities = loadCommunities();

  const { nodes, edges, communityLabels } = buildGraphData(pages, relations, communities, full);

  const html = generateHtml({ nodes, edges, communityLabels });

  const outPath = output ?? resolve(WIKI, "graph", "index.html");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf-8");

  const mode = full ? "full" : "overview (concepts + synthesis)";
  console.log(`Generated graph: ${nodes.length} nodes, ${edges.length} edges, ${communityLabels.length} communities`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Output: ${outPath}`);
}

main();
