#!/usr/bin/env npx tsx
/**
 * Feedback triage: periodic scan of outputs/queries/ feedback files.
 *
 * Inspired by Hermes-Agent's "periodic nudge" pattern — not real-time
 * processing, but batch evaluation of accumulated feedback signals.
 *
 * Scans pending feedback, classifies by kind (gap/accuracy/insight),
 * aggregates recurring themes, and outputs a triage report.
 *
 * Usage:
 *   npx tsx tools/kb-feedback-triage.ts                    # Triage all pending
 *   npx tsx tools/kb-feedback-triage.ts --dry-run          # Preview without writing report
 *   npx tsx tools/kb-feedback-triage.ts --include-triaged  # Include already-triaged items
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUERIES_DIR = resolve(PROJECT_ROOT, "outputs", "queries");
const REVIEWS_DIR = resolve(PROJECT_ROOT, "outputs", "reviews");
const WIKI_DIR = resolve(PROJECT_ROOT, "wiki");
const KB_DIR = resolve(PROJECT_ROOT, ".kb");
const SIGNAL_INDEX = resolve(KB_DIR, "signal-index.jsonl");

// ── Types ─────────────────────────────────────────────────────────────
interface FeedbackEntry {
  filename: string;
  title: string;
  feedback_kind: "gap" | "accuracy" | "insight";
  review_status: string;
  answer_status: string;
  wiki_pages: string[];
  citekeys: string[];
  created: string;
  question_summary: string;
  feedback_detail: string;
}

interface TriageReport {
  date: string;
  total: number;
  by_kind: Record<string, FeedbackEntry[]>;
  gap_themes: Map<string, FeedbackEntry[]>;
  accuracy_targets: { page: string; entries: FeedbackEntry[] }[];
  insight_candidates: FeedbackEntry[];
  recommendations: string[];
}

// ── Signal Index (machine-readable feedback for flywheel) ────────────
interface SignalRecord {
  ts: string;
  kind: string;
  topic?: string;
  target?: string;
  anchors: string[];
  citekeys: string[];
  source_file: string;
  count: number;
}

function toSlug(wikiPath: string): string {
  return wikiPath.replace(/\.md$/, "").split("/").pop() ?? "uncategorized";
}

function buildSignals(report: TriageReport): SignalRecord[] {
  const signals: SignalRecord[] = [];
  const ts = report.date;

  for (const entry of report.by_kind.gap ?? []) {
    signals.push({
      ts, kind: "gap",
      topic: entry.wiki_pages[0] ? toSlug(entry.wiki_pages[0]) : "uncategorized",
      anchors: entry.wiki_pages.map(toSlug),
      citekeys: entry.citekeys,
      source_file: entry.filename,
      count: 1,
    });
  }

  for (const entry of report.by_kind.accuracy ?? []) {
    signals.push({
      ts, kind: "accuracy",
      target: entry.wiki_pages[0] ? toSlug(entry.wiki_pages[0]) : undefined,
      anchors: entry.wiki_pages.map(toSlug),
      citekeys: entry.citekeys,
      source_file: entry.filename,
      count: 1,
    });
  }

  for (const entry of report.insight_candidates) {
    signals.push({
      ts, kind: "insight",
      anchors: entry.wiki_pages.map(toSlug),
      citekeys: entry.citekeys,
      source_file: entry.filename,
      count: 1,
    });
  }

  return signals;
}

function writeSignalIndex(signals: SignalRecord[], dryRun: boolean): void {
  if (signals.length === 0) return;
  const lines = signals.map(s => JSON.stringify(s)).join("\n") + "\n";
  if (dryRun) {
    console.log("\n[DRY RUN] Would append to .kb/signal-index.jsonl:");
    console.log(lines);
    return;
  }
  mkdirSync(KB_DIR, { recursive: true });
  appendFileSync(SIGNAL_INDEX, lines, "utf-8");
}

// ── CLI ───────────────────────────────────────────────────────────────
interface CliArgs { dryRun: boolean; includeTriaged: boolean }

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { dryRun: false, includeTriaged: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") a.dryRun = true;
    else if (argv[i] === "--include-triaged") a.includeTriaged = true;
    else { console.error(`Unknown flag: ${argv[i]}`); process.exit(1); }
  }
  return a;
}

// ── Frontmatter parser (reuses project pattern) ───────────────────────
function parseFrontmatter(content: string): Record<string, any> {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const fm: Record<string, any> = {};
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith("[")) {
      fm[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      fm[key] = val.replace(/^["']|["']$/g, "").trim();
    }
  }
  return fm;
}

function extractSection(content: string, heading: string): string {
  const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = content.match(re);
  return m ? m[1].trim() : "";
}

// ── Load feedback entries ─────────────────────────────────────────────
function loadFeedback(includeTriaged: boolean): FeedbackEntry[] {
  if (!existsSync(QUERIES_DIR)) return [];

  const entries: FeedbackEntry[] = [];
  for (const f of readdirSync(QUERIES_DIR)) {
    if (!f.endsWith(".md") || f === ".gitkeep") continue;

    const content = readFileSync(resolve(QUERIES_DIR, f), "utf-8");
    const fm = parseFrontmatter(content);

    // Only process feedback files (not regular kb-ask outputs)
    if (fm.provenance !== "query-derived") continue;
    if (!fm.feedback_kind) continue;
    if (!includeTriaged && fm.review_status && fm.review_status !== "pending") continue;

    entries.push({
      filename: f,
      title: String(fm.title ?? f),
      feedback_kind: fm.feedback_kind as FeedbackEntry["feedback_kind"],
      review_status: String(fm.review_status ?? "pending"),
      answer_status: String(fm.answer_status ?? "unknown"),
      wiki_pages: Array.isArray(fm.wiki_pages) ? fm.wiki_pages : [],
      citekeys: Array.isArray(fm.citekeys) ? fm.citekeys : [],
      created: String(fm.created ?? "unknown"),
      question_summary: extractSection(content, "Question Summary"),
      feedback_detail: extractSection(content, "Feedback"),
    });
  }

  return entries.sort((a, b) => a.created.localeCompare(b.created));
}

// ── Concept page Open Questions loader ────────────────────────────────
function loadOpenQuestions(): Map<string, string[]> {
  const oq = new Map<string, string[]>();
  const conceptDir = resolve(WIKI_DIR, "concepts");
  if (!existsSync(conceptDir)) return oq;

  for (const f of readdirSync(conceptDir)) {
    if (!f.endsWith(".md")) continue;
    const content = readFileSync(resolve(conceptDir, f), "utf-8");
    const section = extractSection(content, "Open Questions");
    if (!section) continue;
    const questions = section.split("\n")
      .filter(l => l.startsWith("- "))
      .map(l => l.slice(2).trim());
    if (questions.length > 0) oq.set(f.replace(/\.md$/, ""), questions);
  }
  return oq;
}

// ── Theme extraction (gap clustering) ─────────────────────────────────
function extractGapThemes(gaps: FeedbackEntry[]): Map<string, FeedbackEntry[]> {
  // Group by first wiki_pages entry as theme anchor
  const themes = new Map<string, FeedbackEntry[]>();

  for (const entry of gaps) {
    const anchor = entry.wiki_pages[0]
      ? entry.wiki_pages[0].replace(/\.md$/, "").split("/").pop()!
      : "uncategorized";

    if (!themes.has(anchor)) themes.set(anchor, []);
    themes.get(anchor)!.push(entry);
  }
  return themes;
}

// ── Build triage report ───────────────────────────────────────────────
function buildReport(entries: FeedbackEntry[]): TriageReport {
  const today = new Date().toISOString().slice(0, 10);
  const by_kind: Record<string, FeedbackEntry[]> = { gap: [], accuracy: [], insight: [] };
  for (const e of entries) {
    (by_kind[e.feedback_kind] ??= []).push(e);
  }

  // Gap: cluster by theme, find recurring topics
  const gap_themes = extractGapThemes(by_kind.gap ?? []);

  // Accuracy: group by target wiki page
  const accByPage = new Map<string, FeedbackEntry[]>();
  for (const e of by_kind.accuracy ?? []) {
    for (const page of e.wiki_pages) {
      if (!accByPage.has(page)) accByPage.set(page, []);
      accByPage.get(page)!.push(e);
    }
  }
  const accuracy_targets = Array.from(accByPage.entries())
    .map(([page, entries]) => ({ page, entries }))
    .sort((a, b) => b.entries.length - a.entries.length);

  // Insight: filter for those with ≥2 citekeys (synthesis candidates)
  const insight_candidates = (by_kind.insight ?? [])
    .filter(e => e.citekeys.length >= 2);

  // Generate recommendations
  const recommendations: string[] = [];
  const openQuestions = loadOpenQuestions();

  // Recommend filling high-frequency gaps
  for (const [theme, gaps] of gap_themes) {
    if (gaps.length >= 2) {
      recommendations.push(`HIGH: "${theme}" has ${gaps.length} gap reports — consider /kb-sync + /kb-compile to expand coverage`);
    }
  }

  // Link gap themes to existing Open Questions
  for (const [concept, questions] of openQuestions) {
    const relatedGaps = entries.filter(e =>
      e.feedback_kind === "gap" &&
      (e.wiki_pages.some(p => p.includes(concept)) ||
       e.question_summary.toLowerCase().includes(concept.replace(/-/g, " ")))
    );
    if (relatedGaps.length > 0) {
      recommendations.push(`LINK: ${relatedGaps.length} gap(s) relate to Open Questions in concepts/${concept}.md`);
    }
  }

  // Flag accuracy issues for citation audit
  for (const { page, entries } of accuracy_targets) {
    recommendations.push(`AUDIT: ${page} has ${entries.length} accuracy report(s) — needs citation audit against raw/`);
  }

  // Flag synthesis-ready insights
  if (insight_candidates.length > 0) {
    recommendations.push(`SYNTHESIS: ${insight_candidates.length} insight(s) with ≥2 citekeys — candidates for /kb-reflect`);
  }

  return { date: today, total: entries.length, by_kind, gap_themes, accuracy_targets, insight_candidates, recommendations };
}

// ── Render report as markdown ─────────────────────────────────────────
function renderReport(report: TriageReport): string {
  const lines: string[] = [
    `# Feedback Triage Report — ${report.date}`,
    "",
    `**Total pending feedback**: ${report.total}`,
    `| Kind | Count |`,
    `|------|-------|`,
    `| gap | ${(report.by_kind.gap ?? []).length} |`,
    `| accuracy | ${(report.by_kind.accuracy ?? []).length} |`,
    `| insight | ${(report.by_kind.insight ?? []).length} |`,
    "",
  ];

  // Recommendations (actionable summary — progressive disclosure)
  if (report.recommendations.length > 0) {
    lines.push("## Recommendations", "");
    for (const r of report.recommendations) lines.push(`- ${r}`);
    lines.push("");
  }

  // Gap themes
  if (report.gap_themes.size > 0) {
    lines.push("## Gap Themes", "");
    for (const [theme, gaps] of report.gap_themes) {
      lines.push(`### ${theme} (${gaps.length} report${gaps.length > 1 ? "s" : ""})`);
      for (const g of gaps) {
        lines.push(`- **${g.created}** ${g.question_summary.slice(0, 120)}${g.question_summary.length > 120 ? "..." : ""}`);
        if (g.citekeys.length > 0) lines.push(`  - Citekeys: ${g.citekeys.join(", ")}`);
      }
      lines.push("");
    }
  }

  // Accuracy targets
  if (report.accuracy_targets.length > 0) {
    lines.push("## Accuracy Issues (needs citation audit)", "");
    for (const { page, entries } of report.accuracy_targets) {
      lines.push(`### ${page} (${entries.length} report${entries.length > 1 ? "s" : ""})`);
      for (const e of entries) {
        lines.push(`- **${e.created}** ${e.feedback_detail.slice(0, 150)}${e.feedback_detail.length > 150 ? "..." : ""}`);
      }
      lines.push("");
    }
  }

  // Insight candidates
  if (report.insight_candidates.length > 0) {
    lines.push("## Synthesis Candidates (≥2 citekeys)", "");
    for (const e of report.insight_candidates) {
      lines.push(`- **${e.created}** ${e.question_summary.slice(0, 120)}`);
      lines.push(`  - Citekeys: ${e.citekeys.join(", ")}`);
      lines.push(`  - Pages: ${e.wiki_pages.join(", ") || "(none)"}`);
    }
    lines.push("");
  }

  // All entries (detailed appendix)
  lines.push("## All Feedback Entries", "");
  lines.push("| File | Kind | Status | Answer | Created |");
  lines.push("|------|------|--------|--------|---------|");
  for (const kind of ["accuracy", "gap", "insight"] as const) {
    for (const e of report.by_kind[kind] ?? []) {
      lines.push(`| ${e.filename} | ${e.feedback_kind} | ${e.review_status} | ${e.answer_status} | ${e.created} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const entries = loadFeedback(args.includeTriaged);

  if (entries.length === 0) {
    console.log("No pending feedback found in outputs/queries/.");
    return;
  }

  const report = buildReport(entries);
  const rendered = renderReport(report);

  const signals = buildSignals(report);

  if (args.dryRun) {
    console.log(rendered);
    writeSignalIndex(signals, true);
    return;
  }

  // Write triage report
  mkdirSync(REVIEWS_DIR, { recursive: true });
  const outFile = resolve(REVIEWS_DIR, `${report.date}-feedback-triage.md`);
  writeFileSync(outFile, rendered, "utf-8");
  console.log(`Triage report written: ${outFile}`);
  console.log(`  ${report.total} feedback entries processed`);
  console.log(`  ${report.recommendations.length} recommendations generated`);

  // Append signal records
  writeSignalIndex(signals, false);
  console.log(`  ${signals.length} signal records appended to .kb/signal-index.jsonl`);
}

main();
