#!/usr/bin/env npx tsx
/**
 * Academic Knowledge Gap Scanner — Detects 5 types of knowledge gaps.
 *
 * Part of the NORIA knowledge flywheel: gap detection → targeted expansion.
 * Zero LLM cost — pure data analysis from wiki frontmatter, relations, and signal index.
 *
 * Gap types:
 *   1. Demand gap    — topic queried ≥N times but coverage is thin
 *   2. Depth gap     — source exists but only abstract-level citations
 *   3. Structural gap — concepts share sources but no synthesis bridges them
 *   4. Frontier gap  — concept's newest source is >1 year old
 *   5. Audit gap     — accuracy feedback disputes a claim
 *
 * Usage:
 *   npx tsx tools/kb-gap-scan.ts                    # Full scan, all 5 gap types
 *   npx tsx tools/kb-gap-scan.ts --type demand      # Specific gap type only
 *   npx tsx tools/kb-gap-scan.ts --json             # Machine-readable output
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const KB = resolve(ROOT, ".kb");
const RELATIONS = resolve(KB, "relations.jsonl");
const SIGNAL_INDEX = resolve(KB, "signal-index.jsonl");
const OUTPUTS = resolve(ROOT, "outputs", "reviews");

// ── Data loaders ─────────────────────────────────────────────────────
interface PageMeta {
  slug: string;
  dir: string;
  title: string;
  type: string;
  year: number;
  sources: string[];
  provenance: string;
  hasSectionCitations: boolean;
  redirect?: string;
  lastReviewed?: string;
  superseded_by?: string[];
}

function loadPages(): PageMeta[] {
  const pages: PageMeta[] = [];
  for (const dir of ["sources", "concepts", "synthesis"]) {
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
        title: String(fm.title ?? slug),
        type: String(fm.type ?? dir.replace(/s$/, "")),
        year: parseInt(String(fm.year ?? "0"), 10) || 0,
        sources: Array.isArray(fm.sources) ? fm.sources : [],
        provenance: String(fm.provenance ?? "unknown"),
        hasSectionCitations: /\[source:.*sec\./i.test(content),
        redirect: fm.redirect ? String(fm.redirect) : undefined,
        lastReviewed: fm.last_reviewed ? String(fm.last_reviewed) : undefined,
        superseded_by: Array.isArray(fm.superseded_by) ? fm.superseded_by : undefined,
      });
    }
  }
  return pages;
}

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

interface Relation { source: string; target: string; type: string }

function loadRelations(): Relation[] {
  if (!existsSync(RELATIONS)) return [];
  return readFileSync(RELATIONS, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

interface Signal { ts: string; kind: string; topic?: string; target?: string; anchors?: string[]; count?: number }

function loadSignals(): Signal[] {
  if (!existsSync(SIGNAL_INDEX)) return [];
  return readFileSync(SIGNAL_INDEX, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ── Gap detectors ────────────────────────────────────────────────────
interface Gap {
  type: "demand" | "depth" | "structural" | "frontier" | "audit" | "synthesis-review" | "synthesis-update" | "community-sparse" | "surprise-connection";
  severity: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  action: string;
  anchors: string[];
}

function detectDemandGaps(signals: Signal[], pages: PageMeta[]): Gap[] {
  const gaps: Gap[] = [];
  // Count gap signals by topic
  const topicCounts = new Map<string, number>();
  for (const s of signals) {
    if (s.kind === "gap" && s.topic) {
      topicCounts.set(s.topic, (topicCounts.get(s.topic) ?? 0) + (s.count ?? 1));
    }
  }
  for (const [topic, count] of topicCounts) {
    if (count >= 3) {
      gaps.push({
        type: "demand",
        severity: count >= 5 ? "HIGH" : "MEDIUM",
        description: `"${topic}" has ${count} gap reports but insufficient wiki coverage`,
        action: `/kb-sync s2 "${topic}" --limit 5`,
        anchors: [topic],
      });
    }
  }
  return gaps;
}

function detectDepthGaps(pages: PageMeta[], signals: Signal[]): Gap[] {
  const gaps: Gap[] = [];
  // Sources that are abstract-only (no sec.X citations) and referenced by feedback
  const queriedSlugs = new Set<string>();
  for (const s of signals) {
    for (const a of s.anchors ?? []) queriedSlugs.add(a);
    if (s.target) queriedSlugs.add(s.target);
  }

  const abstractOnly = pages.filter(p =>
    p.dir === "sources" && !p.hasSectionCitations && p.provenance === "source-derived" && !p.redirect
  );

  for (const page of abstractOnly) {
    const queried = queriedSlugs.has(page.slug);
    // Also flag sources linked to many concepts (important but shallow)
    const conceptLinks = pages.filter(p =>
      p.dir === "concepts" && p.sources.includes(page.slug)
    ).length;

    if (queried || conceptLinks >= 3) {
      gaps.push({
        type: "depth",
        severity: queried ? "HIGH" : "MEDIUM",
        description: `${page.slug} is abstract-only${queried ? " (queried by users)" : ""} but linked to ${conceptLinks} concepts`,
        action: `/kb-deepen ${page.slug}`,
        anchors: [page.slug],
      });
    }
  }
  return gaps;
}

function detectStructuralGaps(pages: PageMeta[], relations: Relation[]): Gap[] {
  const gaps: Gap[] = [];
  const concepts = pages.filter(p => p.dir === "concepts");
  const synthesisSlugs = new Set(pages.filter(p => p.dir === "synthesis").map(p => p.slug));

  // Build concept→sources map from frontmatter sources: field (not wikilinks)
  // A source page lists its citekey in sources:, and concepts list their supporting citekeys
  const conceptSources = new Map<string, Set<string>>();
  for (const concept of concepts) {
    // Find source pages whose slug appears in this concept's sources: frontmatter
    const linkedSources = new Set<string>();
    for (const srcPage of pages.filter(p => p.dir === "sources")) {
      // Check if concept's sources field contains this source slug
      if (concept.sources.includes(srcPage.slug)) {
        linkedSources.add(srcPage.slug);
      }
      // Also check if source's sources field contains this concept slug
      if (srcPage.sources.includes(concept.slug)) {
        linkedSources.add(srcPage.slug);
      }
    }
    if (linkedSources.size > 0) {
      conceptSources.set(concept.slug, linkedSources);
    }
  }

  // Build synthesis→concepts map for bridge detection
  const synthesisConcepts = new Map<string, Set<string>>();
  for (const rel of relations) {
    if (synthesisSlugs.has(rel.source)) {
      if (!synthesisConcepts.has(rel.source)) synthesisConcepts.set(rel.source, new Set());
      synthesisConcepts.get(rel.source)!.add(rel.target);
    }
    if (synthesisSlugs.has(rel.target)) {
      if (!synthesisConcepts.has(rel.target)) synthesisConcepts.set(rel.target, new Set());
      synthesisConcepts.get(rel.target)!.add(rel.source);
    }
  }

  // Check concept pairs sharing ≥3 sources but no synthesis bridges both
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const a = concepts[i].slug, b = concepts[j].slug;
      const aSrcs = conceptSources.get(a) ?? new Set();
      const bSrcs = conceptSources.get(b) ?? new Set();
      const shared = [...aSrcs].filter(s => bSrcs.has(s));

      if (shared.length >= 3) {
        // Check if any synthesis page links to BOTH concepts
        let bridged = false;
        for (const [synth, linkedConcepts] of synthesisConcepts) {
          if (linkedConcepts.has(a) && linkedConcepts.has(b)) {
            bridged = true;
            break;
          }
        }

        if (!bridged) {
          gaps.push({
            type: "structural",
            severity: shared.length >= 5 ? "HIGH" : "MEDIUM",
            description: `${a} and ${b} share ${shared.length} sources but no synthesis bridges them`,
            action: `/kb-reflect (topic: ${concepts[i].title} × ${concepts[j].title})`,
            anchors: [a, b],
          });
        }
      }
    }
  }
  return gaps;
}

function detectFrontierGaps(pages: PageMeta[]): Gap[] {
  const gaps: Gap[] = [];
  const currentYear = new Date().getFullYear();
  const concepts = pages.filter(p => p.dir === "concepts");

  for (const concept of concepts) {
    // Find newest source linked to this concept
    const linkedSources = pages.filter(p =>
      p.dir === "sources" && p.sources.includes(concept.slug)
    );
    // Also check via concept's own sources field
    const sourcePages = pages.filter(p =>
      p.dir === "sources" && concept.sources.includes(p.slug)
    );
    const allLinked = [...new Set([...linkedSources, ...sourcePages])];

    if (allLinked.length === 0) continue;

    // Check if all sources are superseded
    const nonSuperseded = allLinked.filter(p => !p.superseded_by || p.superseded_by.length === 0);
    if (nonSuperseded.length === 0 && allLinked.length > 0) {
      gaps.push({
        type: "frontier",
        severity: "HIGH",
        description: `${concept.slug}: all ${allLinked.length} sources have been superseded — needs fresh evidence`,
        action: `/kb-sync s2 "${concept.title}" --limit 5`,
        anchors: [concept.slug, ...allLinked.map(p => p.slug)],
      });
      continue;
    }

    const newestYear = Math.max(...allLinked.map(p => p.year).filter(y => y > 0));
    if (newestYear > 0 && newestYear < currentYear - 1) {
      gaps.push({
        type: "frontier",
        severity: "LOW",
        description: `${concept.slug} newest source is from ${newestYear} (${currentYear - newestYear} years stale)`,
        action: `/kb-sync s2 "${concept.title}" --year ${currentYear - 1}-`,
        anchors: [concept.slug],
      });
    }
  }
  return gaps;
}

function detectAuditGaps(signals: Signal[]): Gap[] {
  const gaps: Gap[] = [];
  const auditTargets = new Map<string, number>();
  for (const s of signals) {
    if (s.kind === "accuracy" && s.target) {
      auditTargets.set(s.target, (auditTargets.get(s.target) ?? 0) + (s.count ?? 1));
    }
  }
  for (const [target, count] of auditTargets) {
    gaps.push({
      type: "audit",
      severity: count >= 2 ? "HIGH" : "MEDIUM",
      description: `${target} has ${count} accuracy dispute(s) — needs citation verification`,
      action: `Verify claims in ${target} against raw/ source`,
      anchors: [target],
    });
  }
  return gaps;
}

function detectSynthesisReview(pages: PageMeta[]): Gap[] {
  const gaps: Gap[] = [];
  const synthCount = pages.filter(p => p.dir === "synthesis").length;
  const SOFT_CEILING = 15;
  if (synthCount >= SOFT_CEILING - 2) {
    gaps.push({
      type: "synthesis-review",
      severity: "LOW",
      description: `${synthCount} synthesis articles — approaching ceiling (${SOFT_CEILING}). Review before creating more.`,
      action: `/kb-lint --semantic (check synthesis governance)`,
      anchors: [],
    });
  }
  return gaps;
}

function detectSynthesisUpdate(pages: PageMeta[], relations: Relation[]): Gap[] {
  const gaps: Gap[] = [];
  const synthPages = pages.filter(p => p.dir === "synthesis");
  if (!synthPages.length) return gaps;

  // For each synthesis, check if new sources touch its linked concepts but it hasn't been reviewed recently
  const now = new Date();
  const STALE_DAYS = 30;

  for (const synth of synthPages) {
    if (!synth.lastReviewed) continue;
    const reviewed = new Date(synth.lastReviewed);
    const daysSince = Math.floor((now.getTime() - reviewed.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < STALE_DAYS) continue;

    // Count sources compiled after last_reviewed that link to same concepts
    const synthConcepts = new Set<string>();
    for (const r of relations) {
      if (r.source === synth.slug) synthConcepts.add(r.target);
      if (r.target === synth.slug) synthConcepts.add(r.source);
    }

    const newSources = pages.filter(p =>
      p.dir === "sources" && !synth.sources.includes(p.slug) &&
      pages.some(c => c.dir === "concepts" && synthConcepts.has(c.slug) && c.sources.includes(p.slug))
    );

    if (newSources.length >= 2) {
      gaps.push({
        type: "synthesis-update" as any,
        severity: newSources.length >= 5 ? "HIGH" : "MEDIUM",
        description: `${synth.slug} has ${newSources.length} new sources touching its concepts but hasn't been reviewed in ${daysSince} days`,
        action: `/kb-reflect --update ${synth.slug}`,
        anchors: [synth.slug],
      });
    }
  }
  return gaps;
}

// ── Community-Sparse Gap ─────────────────────────────────────────────
function detectCommunitySparseness(): Gap[] {
  const gaps: Gap[] = [];
  const commPath = resolve(KB, "communities.json");
  if (!existsSync(commPath)) return gaps;
  const data = JSON.parse(readFileSync(commPath, "utf-8"));
  for (const comm of data.communities ?? []) {
    if (comm.cohesion !== undefined && comm.cohesion < 1.5 && comm.size >= 3) {
      gaps.push({
        type: "community-sparse",
        severity: comm.cohesion < 1.2 ? "HIGH" : "MEDIUM",
        description: `Community "${comm.label}" (${comm.size} sources) has weak internal cohesion (${comm.cohesion})`,
        action: `/kb-sync s2 "${comm.concepts?.[0] ?? comm.label}" --limit 5`,
        anchors: comm.concepts ?? [],
      });
    }
  }
  return gaps;
}

// ── Surprise-Connection Gap ──────────────────────────────────────────
function detectSurpriseConnections(): Gap[] {
  const gaps: Gap[] = [];
  const commPath = resolve(KB, "communities.json");
  const featPath = resolve(KB, "graph-features.json");
  if (!existsSync(commPath) || !existsSync(featPath)) return gaps;
  const commData = JSON.parse(readFileSync(commPath, "utf-8"));
  const features = JSON.parse(readFileSync(featPath, "utf-8"));
  const pageCommunity: Record<string, number> = commData.page_community ?? {};

  const relations = loadRelations();
  // Find top cross-community wikilink edges by surprise score
  const surprises: { source: string; target: string; surprise: number }[] = [];
  for (const r of relations) {
    if (r.type !== "wikilink") continue;
    const srcComm = pageCommunity[r.source];
    const tgtComm = pageCommunity[r.target];
    if (srcComm === undefined || tgtComm === undefined || srcComm === tgtComm) continue;
    const srcType = features[r.source]?.type ?? "unknown";
    const tgtType = features[r.target]?.type ?? "unknown";
    const type_diff = srcType !== tgtType ? 1.0 : 0.5;
    const srcCent = features[r.source]?.centrality ?? 0;
    const tgtCent = features[r.target]?.centrality ?? 0;
    const contrast = Math.min(Math.log2(1 + Math.max(srcCent, tgtCent)) / Math.log2(1 + Math.min(srcCent, tgtCent) + 0.01), 5.0);
    const surprise = type_diff * contrast;
    if (surprise > 2.0) surprises.push({ source: r.source, target: r.target, surprise });
  }
  surprises.sort((a, b) => b.surprise - a.surprise);

  // Report top 5 as LOW gaps (these are opportunities, not problems)
  for (const s of surprises.slice(0, 5)) {
    gaps.push({
      type: "surprise-connection",
      severity: "LOW",
      description: `Surprising cross-community link: ${s.source} ↔ ${s.target} (surprise=${s.surprise.toFixed(1)})`,
      action: `/kb-reflect (explore connection between ${s.source} and ${s.target})`,
      anchors: [s.source, s.target],
    });
  }
  return gaps;
}

// ── Main ─────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  let typeFilter: string | undefined;
  let jsonMode = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--type" && argv[i + 1]) typeFilter = argv[++i];
    if (argv[i] === "--json") jsonMode = true;
  }

  const pages = loadPages();
  const relations = loadRelations();
  const signals = loadSignals();

  let allGaps: Gap[] = [];

  if (!typeFilter || typeFilter === "demand") allGaps.push(...detectDemandGaps(signals, pages));
  if (!typeFilter || typeFilter === "depth") allGaps.push(...detectDepthGaps(pages, signals));
  if (!typeFilter || typeFilter === "structural") allGaps.push(...detectStructuralGaps(pages, relations));
  if (!typeFilter || typeFilter === "frontier") allGaps.push(...detectFrontierGaps(pages));
  if (!typeFilter || typeFilter === "audit") allGaps.push(...detectAuditGaps(signals));
  if (!typeFilter || typeFilter === "synthesis-review") allGaps.push(...detectSynthesisReview(pages));
  if (!typeFilter || typeFilter === "synthesis-update") allGaps.push(...detectSynthesisUpdate(pages, relations));
  if (!typeFilter || typeFilter === "community-sparse") allGaps.push(...detectCommunitySparseness());
  if (!typeFilter || typeFilter === "surprise-connection") allGaps.push(...detectSurpriseConnections());

  // Sort by severity
  const sevOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  allGaps.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  if (jsonMode) {
    console.log(JSON.stringify(allGaps, null, 2));
    return;
  }

  // Human-readable report
  console.log(`# Knowledge Gap Scan — ${new Date().toISOString().split("T")[0]}\n`);
  console.log(`Scanned: ${pages.length} pages, ${relations.length} relations, ${signals.length} signals\n`);

  const byType = new Map<string, Gap[]>();
  for (const g of allGaps) {
    if (!byType.has(g.type)) byType.set(g.type, []);
    byType.get(g.type)!.push(g);
  }

  for (const [type, gaps] of byType) {
    console.log(`## ${type.toUpperCase()} gaps (${gaps.length})\n`);
    for (const g of gaps) {
      console.log(`- [${g.severity}] ${g.description}`);
      console.log(`  Action: ${g.action}\n`);
    }
  }

  console.log(`\n**Total: ${allGaps.length} gaps** (${allGaps.filter(g => g.severity === "HIGH").length} HIGH, ${allGaps.filter(g => g.severity === "MEDIUM").length} MEDIUM, ${allGaps.filter(g => g.severity === "LOW").length} LOW)`);

  // Save report
  mkdirSync(OUTPUTS, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const reportPath = resolve(OUTPUTS, `${date}-gap-scan.md`);
  const reportLines = [
    `# Knowledge Gap Scan — ${date}`,
    ``,
    `Scanned: ${pages.length} pages, ${relations.length} relations, ${signals.length} signals`,
    ``,
  ];
  for (const [type, gaps] of byType) {
    reportLines.push(`## ${type.toUpperCase()} gaps (${gaps.length})`, ``);
    for (const g of gaps) {
      reportLines.push(`- [${g.severity}] ${g.description}`, `  Action: ${g.action}`, ``);
    }
  }
  reportLines.push(`**Total: ${allGaps.length} gaps** (${allGaps.filter(g => g.severity === "HIGH").length} HIGH, ${allGaps.filter(g => g.severity === "MEDIUM").length} MEDIUM, ${allGaps.filter(g => g.severity === "LOW").length} LOW)`);
  writeFileSync(reportPath, reportLines.join("\n"), "utf-8");
  console.log(`\nReport saved: ${reportPath}`);
}

main();
