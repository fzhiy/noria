#!/usr/bin/env npx tsx
/**
 * Wiki KB linter: structural + optional semantic checks.
 * TypeScript port of kb_lint.py — identical output format and behavior.
 *
 * Usage:
 *   npx tsx tools/kb-lint.ts [--fix] [--json] [--semantic]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const SRC_DIR = resolve(WIKI, "sources");
const CON_DIR = resolve(WIKI, "concepts");
const SYN_DIR = resolve(WIKI, "synthesis");
const INDEX = resolve(WIKI, "index.md");
const DIRS = [SRC_DIR, CON_DIR, SYN_DIR];

const VALID_TYPES = new Set(["source", "concept", "synthesis", "index"]);
const VALID_PROV = new Set(["source-derived", "llm-derived", "user-verified", "social-lead"]);
const REQ_FIELDS = new Set(["title", "type", "provenance", "sources", "tags", "created", "updated"]);
const LOC_RE = /^(abstract|title|webpage|tweet|readme|release-notes|sec\.\d+(\.\d+)*)$/;
const WL_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const CITE_RE = /\[source:\s*([^\]]+)\]/g;
const OUTPUTS_REF_RE = /outputs\//i;
const QD_BODY_RE = /provenance:\s*query-derived/i;
const KEY_ASPECTS_RE = /^- \*\*/gm;
const PARA_RE = /(?:^|\n\n)([^\n#\-|>].+?)(?=\n\n|\n#|$)/gs;

// ── Types ─────────────────────────────────────────────────────────────
interface Issue {
  level: "PASS" | "FAIL" | "WARN" | "REVIEW";
  check: string;
  file: string;
  line: number;
  msg: string;
}

type CheckDef = [string, string]; // [display name, key]

// ── Frontmatter parser ────────────────────────────────────────────────
function parseFm(text: string): Record<string, any> | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([^:]+?):\s*(.*)/);
    if (!kv) continue;
    const key = kv[1].trim();
    let val: any = kv[2].trim();
    // Strip quotes
    val = val.replace(/^["']|["']$/g, "");
    // Parse arrays: [a, b, c] or JSON arrays ["a", "b"]
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
    fm[key] = val;
  }
  return Object.keys(fm).length > 0 ? fm : null;
}

// ── Helpers ───────────────────────────────────────────────────────────
function rel(p: string): string {
  return relative(ROOT, p);
}

function listMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md")).sort().map(f => resolve(dir, f));
}

function pages(): string[] {
  const r: string[] = [];
  for (const d of DIRS) r.push(...listMd(d));
  return r;
}

function slugOk(s: string): boolean {
  return DIRS.some(d => existsSync(resolve(d, `${s}.md`)));
}

function norm(t: string): string {
  return t.replace(/[\s\-_]+/g, " ").trim().toLowerCase();
}

function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) results.push(m);
  return results;
}

// ── Sequence similarity (port of difflib.SequenceMatcher.ratio) ───────
function seqRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a.length || !b.length) return 0.0;
  // LCS-based ratio matching Python's SequenceMatcher behavior
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2.0 * dp[m][n]) / (m + n);
}

// ── Check 1: Frontmatter ──────────────────────────────────────────────
function ckFrontmatter(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  let ok = 0;
  for (const p of ps) {
    const text = readFileSync(p, "utf-8");
    const fm = parseFm(text);
    const r = rel(p);
    if (!fm) { iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: "missing YAML frontmatter" }); continue; }
    const keys = new Set(Object.keys(fm));
    const miss = [...REQ_FIELDS].filter(f => !keys.has(f));
    if (miss.length) { iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: `missing field(s): ${miss.sort().join(", ")}` }); continue; }
    if (!VALID_TYPES.has(fm.type)) { iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: `invalid type: '${fm.type}'` }); continue; }
    if (!VALID_PROV.has(fm.provenance)) { iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: `invalid provenance: '${fm.provenance}'` }); continue; }
    if (!Array.isArray(fm.sources)) { iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: "sources must be a list" }); continue; }
    if (!Array.isArray(fm.tags)) { iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: "tags must be a list" }); continue; }
    ok++;
  }
  if (existsSync(INDEX)) {
    const fm = parseFm(readFileSync(INDEX, "utf-8"));
    const r = rel(INDEX);
    if (!fm) iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: "missing YAML frontmatter" });
    else if (!fm.title || !fm.type) iss.push({ level: "FAIL", check: "frontmatter", file: r, line: 1, msg: "index.md must have title and type" });
    else ok++;
  }
  if (ok) iss.unshift({ level: "PASS", check: "frontmatter", file: "", line: 0, msg: `${ok} pages have valid frontmatter` });
  return iss;
}

// ── Check 2: Wikilinks ────────────────────────────────────────────────
function ckWikilinks(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  let ok = 0;
  const all = [...ps];
  if (existsSync(INDEX)) all.push(INDEX);
  for (const p of all) {
    const lines = readFileSync(p, "utf-8").split("\n");
    for (let n = 0; n < lines.length; n++) {
      for (const m of allMatches(WL_RE, lines[n])) {
        const slug = m[1].trim();
        if (slugOk(slug)) ok++;
        else iss.push({ level: "FAIL", check: "wikilinks", file: rel(p), line: n + 1, msg: `broken link: [[${slug}]]` });
      }
    }
  }
  if (ok) iss.unshift({ level: "PASS", check: "wikilinks", file: "", line: 0, msg: `${ok} wikilinks resolved` });
  return iss;
}

// ── Check 3: Citations ────────────────────────────────────────────────
function ckCitations(ps: string[], fix: boolean): Issue[] {
  const iss: Issue[] = [];
  let ok = 0;
  const slugs = new Set(existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, "")) : []);
  for (const p of ps) {
    const text = readFileSync(p, "utf-8");
    const lines = text.split("\n");
    let modified = false;
    for (let n = 0; n < lines.length; n++) {
      for (const m of allMatches(CITE_RE, lines[n])) {
        const body = m[1].trim();
        // Multi-citekey: [source: key1; key2]
        if (body.includes(";") && !body.includes(",")) {
          const cks = body.split(";").map(c => c.trim()).filter(Boolean);
          const bad = cks.filter(c => !slugs.has(c));
          if (bad.length) {
            for (const b of bad) iss.push({ level: "FAIL", check: "citations", file: rel(p), line: n + 1, msg: `citekey not found: ${b}` });
          } else {
            iss.push({ level: "WARN", check: "citations", file: rel(p), line: n + 1, msg: `multi-citekey missing locations: ${m[0]}` });
          }
          continue;
        }
        const parts = body.split(",").map(s => s.trim());
        const ck = parts[0];
        if (!slugs.has(ck)) { iss.push({ level: "FAIL", check: "citations", file: rel(p), line: n + 1, msg: `citekey not found: ${ck}` }); continue; }
        if (parts.length < 2 || !parts[1]) {
          if (fix) {
            lines[n] = lines[n].replace(m[0], `[source: ${ck}, title]`);
            modified = true;
            iss.push({ level: "WARN", check: "citations", file: rel(p), line: n + 1, msg: `auto-fixed -> title: ${m[0]}` });
          } else {
            iss.push({ level: "WARN", check: "citations", file: rel(p), line: n + 1, msg: `citation missing location: ${m[0]}` });
          }
          continue;
        }
        const loc = parts.slice(1).join(",").trim();
        if (!LOC_RE.test(loc)) { iss.push({ level: "WARN", check: "citations", file: rel(p), line: n + 1, msg: `non-standard location: '${loc}'` }); continue; }
        ok++;
      }
    }
    if (modified) {
      writeFileSync(p, lines.join("\n") + (text.endsWith("\n") && !lines[lines.length - 1].endsWith("\n") ? "" : ""));
    }
  }
  if (ok) iss.unshift({ level: "PASS", check: "citations", file: "", line: 0, msg: `${ok} citations valid` });
  return iss;
}

// ── Check 4: Orphans ──────────────────────────────────────────────────
function ckOrphans(): Issue[] {
  const iss: Issue[] = [];
  if (!existsSync(INDEX)) return [{ level: "FAIL", check: "orphans", file: rel(INDEX), line: 0, msg: "index.md not found" }];
  const linked = new Set(allMatches(WL_RE, readFileSync(INDEX, "utf-8")).map(m => m[1].trim()));
  const orphs: string[] = [];
  for (const d of [SRC_DIR, CON_DIR, SYN_DIR]) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter(f => f.endsWith(".md") && f !== ".gitkeep").sort()) {
      if (!linked.has(f.replace(/\.md$/, ""))) orphs.push(rel(resolve(d, f)));
    }
  }
  for (const o of orphs) iss.push({ level: o.includes("synthesis") ? "WARN" : "FAIL", check: "orphans", file: o, line: 0, msg: "not linked from index.md" });
  let total = 0;
  for (const d of [SRC_DIR, CON_DIR, SYN_DIR]) {
    if (existsSync(d)) total += readdirSync(d).filter(f => f.endsWith(".md") && f !== ".gitkeep").length;
  }
  const ok = total - orphs.length;
  if (ok > 0) iss.unshift({ level: "PASS", check: "orphans", file: "", line: 0, msg: `${ok} pages linked from index` });
  return iss;
}

// ── Check 5: Provenance ───────────────────────────────────────────────
function ckProvenance(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  let ok = 0;
  for (const p of ps) {
    const fm = parseFm(readFileSync(p, "utf-8"));
    if (!fm) continue;
    const prov = fm.provenance ?? "";
    const srcs = Array.isArray(fm.sources) ? fm.sources : [];
    if (prov === "llm-derived" && srcs.length < 2) { iss.push({ level: "FAIL", check: "provenance", file: rel(p), line: 1, msg: `llm-derived needs >=2 sources, has ${srcs.length}` }); continue; }
    if (prov === "source-derived" && srcs.length < 1) { iss.push({ level: "FAIL", check: "provenance", file: rel(p), line: 1, msg: "source-derived needs >=1 source" }); continue; }
    if (prov === "social-lead") {
      const tier = fm.venue_tier ?? "";
      if (tier === "top-conf" || tier === "top-journal") {
        iss.push({ level: "FAIL", check: "provenance", file: rel(p), line: 1, msg: `social-lead cannot have venue_tier '${tier}' — use 'social' or omit` });
        continue;
      }
    }
    ok++;
  }
  if (ok) iss.unshift({ level: "PASS", check: "provenance", file: "", line: 0, msg: `${ok} pages satisfy provenance rules` });
  return iss;
}

// ── Check 6: Outputs Quarantine ───────────────────────────────────────
function ckOutputsQuarantine(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  let ok = 0;
  const all = [...ps];
  if (existsSync(INDEX)) all.push(INDEX);
  for (const p of all) {
    const text = readFileSync(p, "utf-8");
    const r = rel(p);
    let found = false;
    const lines = text.split("\n");
    for (let n = 0; n < lines.length; n++) {
      if (OUTPUTS_REF_RE.test(lines[n])) {
        const stripped = lines[n].trim();
        if (stripped.startsWith("#") || stripped.startsWith("```")) continue;
        iss.push({ level: "FAIL", check: "outputs_quarantine", file: r, line: n + 1, msg: "references outputs/ (query-derived quarantine violation)" });
        found = true;
      }
    }
    // Check body for smuggled query-derived provenance
    const fmEnd = text.indexOf("---", 4);
    if (fmEnd > 0) {
      const body = text.slice(fmEnd + 3);
      const bodyLines = body.split("\n");
      const headerLines = text.slice(0, fmEnd + 3).split("\n").length;
      for (let i = 0; i < bodyLines.length; i++) {
        if (QD_BODY_RE.test(bodyLines[i])) {
          iss.push({ level: "FAIL", check: "outputs_quarantine", file: r, line: headerLines + i, msg: "contains 'provenance: query-derived' in body (smuggling risk)" });
          found = true;
        }
      }
    }
    if (!found) ok++;
  }
  if (ok) iss.unshift({ level: "PASS", check: "outputs_quarantine", file: "", line: 0, msg: `${ok} pages clean of outputs/ references` });
  return iss;
}

// ── Check 7: Duplicates ───────────────────────────────────────────────
function ckDuplicates(): Issue[] {
  const iss: Issue[] = [];
  if (!existsSync(CON_DIR)) return iss;
  const titles = new Map<string, string[]>();
  for (const f of readdirSync(CON_DIR).filter(f => f.endsWith(".md")).sort()) {
    const fm = parseFm(readFileSync(resolve(CON_DIR, f), "utf-8"));
    if (fm?.title) {
      const n = norm(String(fm.title));
      if (!titles.has(n)) titles.set(n, []);
      titles.get(n)!.push(rel(resolve(CON_DIR, f)));
    }
  }
  for (const [n, files] of titles) {
    if (files.length > 1) {
      for (const f of files) iss.push({ level: "FAIL", check: "duplicates", file: f, line: 1, msg: `possible duplicate: '${n}' (${files.length} pages)` });
    }
  }
  const ok = [...titles.values()].filter(v => v.length === 1).length;
  if (ok) iss.unshift({ level: "PASS", check: "duplicates", file: "", line: 0, msg: `${ok} concept titles are unique` });
  return iss;
}

// ── Semantic: Thin Concepts ───────────────────────────────────────────
function ckThinConcepts(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  for (const p of ps) {
    if (!p.startsWith(CON_DIR)) continue;
    const n = (readFileSync(p, "utf-8").match(KEY_ASPECTS_RE) ?? []).length;
    if (n < 3) iss.push({ level: "REVIEW", check: "thin_concepts", file: rel(p), line: 0, msg: `thin concept (${n} bullet point(s), recommend enrichment)` });
  }
  return iss;
}

// ── Semantic: Low Citation Density ────────────────────────────────────
function ckLowCitationDensity(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  for (const p of ps) {
    const text = readFileSync(p, "utf-8");
    const fmEnd = text.indexOf("---", 4);
    if (fmEnd === -1) continue;
    const body = text.slice(fmEnd + 3);
    const paras = allMatches(PARA_RE, body).map(m => m[1]);
    if (!paras.length) continue;
    const uncited: number[] = [];
    const bodyLines = body.split("\n");
    for (const para of paras) {
      if (CITE_RE.test(para)) { CITE_RE.lastIndex = 0; continue; }
      CITE_RE.lastIndex = 0;
      const fl = para.trim().split("\n")[0] ?? "";
      const ln = fl ? bodyLines.findIndex(l => fl.slice(0, 40) && l.includes(fl.slice(0, 40))) + 1 : 0;
      uncited.push(ln);
    }
    if (uncited.length > paras.length / 2) {
      for (const ln of uncited) {
        iss.push({ level: "REVIEW", check: "low_citation_density", file: rel(p), line: ln, msg: "paragraph without source citation" });
      }
    }
  }
  return iss;
}

// ── Semantic: Single-Source Concepts ──────────────────────────────────
function ckSingleSourceConcepts(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  for (const p of ps) {
    if (!p.startsWith(CON_DIR)) continue;
    const fm = parseFm(readFileSync(p, "utf-8"));
    if (!fm || fm.provenance !== "llm-derived") continue;
    const srcs = Array.isArray(fm.sources) ? fm.sources : [];
    if (srcs.length === 1) {
      iss.push({ level: "REVIEW", check: "single_source_concepts", file: rel(p), line: 1, msg: `single source (${srcs[0]}), may benefit from additional sources` });
    }
  }
  return iss;
}

// ── Semantic: Fuzzy Near-Duplicates ───────────────────────────────────
function ckFuzzyNearDuplicates(): Issue[] {
  const iss: Issue[] = [];
  if (!existsSync(CON_DIR)) return iss;
  const titles: [string, string][] = [];
  for (const f of readdirSync(CON_DIR).filter(f => f.endsWith(".md")).sort()) {
    const fm = parseFm(readFileSync(resolve(CON_DIR, f), "utf-8"));
    if (fm?.title) titles.push([norm(String(fm.title)), rel(resolve(CON_DIR, f))]);
  }
  const seen = new Set<string>();
  for (let i = 0; i < titles.length; i++) {
    const [t1, f1] = titles[i];
    for (let j = i + 1; j < titles.length; j++) {
      const [t2, f2] = titles[j];
      if (t1 === t2) continue;
      const ratio = seqRatio(t1, t2);
      if (ratio > 0.7) {
        const pair = [f1, f2].sort().join("|");
        if (!seen.has(pair)) {
          seen.add(pair);
          iss.push({ level: "REVIEW", check: "fuzzy_near_duplicates", file: f1, line: 0, msg: `similar to ${f2} (ratio=${ratio.toFixed(2)})` });
        }
      }
    }
  }
  return iss;
}

// ── Semantic: Staleness ───────────────────────────────────────────────
function ckStaleness(ps: string[], days = 30): Issue[] {
  const iss: Issue[] = [];
  const now = Date.now();
  let fresh = 0;
  for (const p of ps) {
    if (!p.startsWith(CON_DIR) && !p.startsWith(SYN_DIR)) continue;
    const fm = parseFm(readFileSync(p, "utf-8"));
    if (!fm?.updated) continue;
    const dt = new Date(String(fm.updated));
    if (isNaN(dt.getTime())) continue;
    const age = Math.floor((now - dt.getTime()) / 86400000);
    if (age > days) {
      iss.push({ level: "REVIEW", check: "staleness", file: rel(p), line: 1, msg: `not updated in ${age} days (since ${fm.updated})` });
    } else {
      fresh++;
    }
  }
  if (fresh) iss.unshift({ level: "PASS", check: "staleness", file: "", line: 0, msg: `${fresh} pages updated within ${days} days` });
  return iss;
}

// ── Check 8: Social-Lead Quarantine ──────────────────────────────────
function ckSocialLeadQuarantine(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  // Build set of social-lead citekeys
  const socialKeys = new Set<string>();
  for (const p of ps) {
    const fm = parseFm(readFileSync(p, "utf-8"));
    if (fm?.provenance === "social-lead") {
      const slug = basename(p, ".md");
      socialKeys.add(slug);
    }
  }
  if (socialKeys.size === 0) return iss;
  // Check synthesis pages do not cite social-lead sources
  let ok = 0;
  const synPages = listMd(SYN_DIR);
  for (const p of synPages) {
    const text = readFileSync(p, "utf-8");
    const r = rel(p);
    let found = false;
    const lines = text.split("\n");
    for (let n = 0; n < lines.length; n++) {
      const cites = allMatches(CITE_RE, lines[n]);
      for (const m of cites) {
        const parts = m[1].split(",").map(s => s.trim());
        const citekey = parts[0];
        if (socialKeys.has(citekey)) {
          iss.push({ level: "FAIL", check: "social_lead_quarantine", file: r, line: n + 1, msg: `synthesis cites social-lead source '${citekey}' — social-lead cannot support synthesis` });
          found = true;
        }
      }
    }
    if (!found) ok++;
  }
  if (ok) iss.unshift({ level: "PASS", check: "social_lead_quarantine", file: "", line: 0, msg: `${ok} synthesis pages free of social-lead citations` });
  return iss;
}

// ── Check 9: Synthesis Governance ─────────────────────────────────────
function ckSynthesisGovernance(ps: string[]): Issue[] {
  const iss: Issue[] = [];
  const synthPages = ps.filter(p => p.includes("/synthesis/") && !p.endsWith(".gitkeep"));
  const count = synthPages.length;

  // Check each synthesis page for ## Thesis section
  let withThesis = 0;
  for (const p of synthPages) {
    const content = readFileSync(p, "utf-8");
    if (/^## Thesis/m.test(content)) {
      withThesis++;
    } else {
      const slug = basename(p, ".md");
      iss.push({ level: "FAIL", check: "synthesis_governance", file: rel(p), line: 0, msg: `missing ## Thesis section (required by synthesis governance)` });
    }
  }

  // Ceiling warnings
  if (count > 20) {
    iss.push({ level: "WARN", check: "synthesis_governance", file: "", line: 0, msg: `${count} synthesis articles — HARD REVIEW: exceeds 20, audit for thesis overlap` });
  } else if (count > 15) {
    // Check justification frontmatter for pages beyond ceiling
    for (const p of synthPages) {
      const content = readFileSync(p, "utf-8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch && !fmMatch[1].includes("justification:")) {
        iss.push({ level: "WARN", check: "synthesis_governance", file: rel(p), line: 0, msg: `above ceiling (${count} > 15) but missing justification: in frontmatter` });
      }
    }
  }

  iss.push({ level: "PASS", check: "synthesis_governance", file: "", line: 0, msg: `${count} synthesis pages (${withThesis} with Thesis, ceiling: 15)` });
  return iss;
}

// ── Check registry ────────────────────────────────────────────────────
const CHECKS: CheckDef[] = [
  ["Frontmatter Validation", "frontmatter"],
  ["Wikilink Resolution", "wikilinks"],
  ["Citation Validation", "citations"],
  ["Orphan Detection", "orphans"],
  ["Provenance Rules", "provenance"],
  ["Outputs Quarantine", "outputs_quarantine"],
  ["Duplicate Detection", "duplicates"],
  ["Social-Lead Quarantine", "social_lead_quarantine"],
  ["Synthesis Governance", "synthesis_governance"],
];

const SEMANTIC_CHECKS: CheckDef[] = [
  ["Thin Concepts", "thin_concepts"],
  ["Low Citation Density", "low_citation_density"],
  ["Single-Source Concepts", "single_source_concepts"],
  ["Fuzzy Near-Duplicates", "fuzzy_near_duplicates"],
  ["Staleness Detection", "staleness"],
];

// ── JSON report ───────────────────────────────────────────────────────
function buildJson(allIss: Issue[], checks: CheckDef[]): Record<string, any> {
  const byCk = new Map<string, Issue[]>();
  for (const i of allIss) {
    if (!byCk.has(i.check)) byCk.set(i.check, []);
    byCk.get(i.check)!.push(i);
  }
  const res: Record<string, any> = {
    timestamp: new Date().toISOString(),
    checks: {},
    summary: { passed: 0, failed: 0, errors: 0, warnings: 0, reviews: 0 },
  };
  for (const [, key] of checks) {
    let total = 0;
    const errors: any[] = [], warnings: any[] = [];
    let hasFail = false;
    for (const i of byCk.get(key) ?? []) {
      if (i.level === "PASS") {
        const m = i.msg.match(/^(\d+)/);
        if (m) total = parseInt(m[1]);
        continue;
      }
      const sev = i.level === "FAIL" ? "error" : i.level === "REVIEW" ? "review" : "warning";
      const entry = { file: i.file, line: i.line, message: i.msg, severity: sev };
      if (i.level === "FAIL") { errors.push(entry); hasFail = true; }
      else warnings.push(entry);
    }
    res.checks[key] = { status: hasFail ? "fail" : "pass", total: total + errors.length, errors, warnings };
    res.summary[hasFail ? "failed" : "passed"]++;
    res.summary.errors += errors.length;
    res.summary.warnings += warnings.length;
    res.summary.reviews += warnings.filter((w: any) => w.severity === "review").length;
  }
  return res;
}

// ── Text report ───────────────────────────────────────────────────────
function report(allIss: Issue[], asJson: boolean, extraChecks?: CheckDef[]): number {
  const active = [...CHECKS, ...(extraChecks ?? [])];
  if (asJson) {
    const r = buildJson(allIss, active);
    console.log(JSON.stringify(r, null, 2));
    return r.summary.errors ? 1 : 0;
  }
  const byCk = new Map<string, Issue[]>();
  for (const i of allIss) {
    if (!byCk.has(i.check)) byCk.set(i.check, []);
    byCk.get(i.check)!.push(i);
  }
  let fails = 0, warns = 0, passed = 0;
  for (const [name, key] of active) {
    const items = byCk.get(key) ?? [];
    console.log(`\n=== ${name} ===`);
    if (!items.length) { console.log("PASS: (no items to check)"); passed++; continue; }
    let hasFail = false;
    for (const i of items) {
      const loc = i.line ? `${i.file}:${i.line}` : i.file;
      if (i.level === "PASS") console.log(`PASS: ${i.msg}`);
      else if (i.level === "REVIEW") { console.log(`REVIEW: ${loc} \u2014 ${i.msg}`); warns++; }
      else if (i.level === "WARN") { console.log(`WARN: ${loc} -- ${i.msg}`); warns++; }
      else { console.log(`FAIL: ${loc} -- ${i.msg}`); fails++; hasFail = true; }
    }
    if (!hasFail) passed++;
  }
  const n = active.length;
  console.log(`\n=== Summary ===`);
  console.log(`PASS: ${passed}/${n} checks passed`);
  if (fails) console.log(`FAIL: ${n - passed} check(s) failed (${fails} errors)`);
  if (warns) console.log(`WARN: ${warns} warnings`);
  return fails ? 1 : 0;
}

// ── Main ──────────────────────────────────────────────────────────────
function main(): number {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const json = args.includes("--json");
  const semantic = args.includes("--semantic");

  const ps = pages();
  const iss: Issue[] = [];
  iss.push(...ckFrontmatter(ps));
  iss.push(...ckWikilinks(ps));
  iss.push(...ckCitations(ps, fix));
  iss.push(...ckOrphans());
  iss.push(...ckProvenance(ps));
  iss.push(...ckOutputsQuarantine(ps));
  iss.push(...ckDuplicates());
  iss.push(...ckSocialLeadQuarantine(ps));
  iss.push(...ckSynthesisGovernance(ps));

  let extra: CheckDef[] | undefined;
  if (semantic) {
    extra = SEMANTIC_CHECKS;
    iss.push(...ckThinConcepts(ps));
    iss.push(...ckLowCitationDensity(ps));
    iss.push(...ckSingleSourceConcepts(ps));
    iss.push(...ckFuzzyNearDuplicates());
    iss.push(...ckStaleness(ps));
  }
  return report(iss, json, extra);
}

process.exit(main());
