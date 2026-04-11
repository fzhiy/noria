#!/usr/bin/env npx tsx
/** kb-output — Render wiki content as jsonl, marp slides, report, or brief. */
import * as fs from "node:fs";
import * as path from "node:path";

interface Meta {
  title: string; type: string; provenance: string;
  sources: string[]; tags: string[]; created: string; updated: string;
}
interface Page { slug: string; dir: string; meta: Meta; body: string }
interface Claim { text: string; source: string; location: string }

function parseFrontmatter(raw: string): { meta: Meta; body: string } {
  const empty: Meta = { title: "", type: "", provenance: "", sources: [], tags: [], created: "", updated: "" };
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: empty, body: raw };
  const data: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const arr = kv[2].match(/^\[([^\]]*)\]$/);
    data[kv[1]] = arr
      ? arr[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta: { ...empty, ...data } as Meta, body: m[2].trim() };
}

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const WIKI = path.join(ROOT, "wiki");

function collectPages(): Page[] {
  const pages: Page[] = [];
  for (const sub of ["sources", "concepts", "synthesis"]) {
    const dir = path.join(WIKI, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".md") && f !== "index.md")) {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      pages.push({ slug: f.replace(/\.md$/, ""), dir: sub, meta, body });
    }
  }
  return pages;
}

function extractSummary(body: string): string {
  const lines = body.split("\n");
  let buf = "";
  let inPara = false;
  for (const line of lines) {
    if (line.startsWith("#")) { if (inPara) break; continue; }
    const trimmed = line.trim();
    if (trimmed === "") { if (inPara) break; continue; }
    inPara = true;
    buf += (buf ? " " : "") + trimmed;
  }
  return buf;
}

function extractClaims(body: string): Claim[] {
  const claims: Claim[] = [];
  const re = /\[source:\s*([^,\]]+)(?:,\s*([^\]]+))?\]/g;
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(line)) !== null) {
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + match[0].length);
      const dotPos = before.lastIndexOf(". ");
      const dashPos = before.lastIndexOf("- ");
      const sentStart = Math.max(dotPos >= 0 ? dotPos + 2 : 0, dashPos >= 0 ? dashPos + 2 : 0, 0);
      const sentEndRel = after.indexOf(". ");
      const sentEnd = sentEndRel === -1 ? after.length : sentEndRel + 1;
      const sentence = (before.slice(sentStart) + after.slice(0, sentEnd)).trim()
        .replace(/\[source:[^\]]*\]/g, "").trim()
        .replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
      if (sentence.length > 10) {
        claims.push({
          text: sentence,
          source: match[1].trim(),
          location: match[2]?.trim() ?? "",
        });
      }
    }
  }
  return claims;
}

function extractLinks(body: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) links.add(m[1].trim());
  return [...links];
}

function extractSections(body: string): { heading: string; bullets: string[] }[] {
  const sections: { heading: string; bullets: string[] }[] = [];
  let current: { heading: string; bullets: string[] } | null = null;
  for (const line of body.split("\n")) {
    const hMatch = line.match(/^##\s+(.+)/);
    if (hMatch) {
      if (current) sections.push(current);
      current = { heading: hMatch[1].trim(), bullets: [] };
      continue;
    }
    if (current) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        // Strip citations and bold for slide clarity
        const clean = trimmed.replace(/^[-*]\s*/, "")
          .replace(/\[source:[^\]]*\]/g, "").replace(/\*\*/g, "").trim();
        if (clean) current.bullets.push(clean);
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

function renderJsonl(pages: Page[], outPath: string): void {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const lines = pages.map(p => JSON.stringify({
    slug: p.slug,
    title: p.meta.title,
    type: p.meta.type,
    provenance: p.meta.provenance,
    sources: p.meta.sources,
    tags: p.meta.tags,
    summary: extractSummary(p.body),
    claims: extractClaims(p.body),
    links: extractLinks(p.body),
    updated: p.meta.updated,
  }));
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  console.log(`jsonl: wrote ${pages.length} records to ${outPath}`);
}

function renderMarp(page: Page, outPath: string): void {
  fs.mkdirSync(path.resolve(outPath), { recursive: true });
  const slides: string[] = [];
  slides.push([
    "---", "marp: true", "theme: default", "paginate: true", "---", "",
    `# ${page.meta.title}`, "",
    extractSummary(page.body), "",
    `> ${page.meta.provenance} | ${page.meta.updated}`,
  ].join("\n"));
  const sections = extractSections(page.body);
  for (const sec of sections) {
    if (sec.heading.toLowerCase() === "summary") continue; // already on title slide
    const bullets = sec.bullets.slice(0, 6);
    const slideLines = [`## ${sec.heading}`, ""];
    for (const b of bullets) slideLines.push(`- ${b}`);
    slides.push(slideLines.join("\n"));
    if (sec.bullets.length > 6) {
      const overflow = sec.bullets.slice(6, 12);
      const overLines = [`## ${sec.heading} (cont.)`, ""];
      for (const b of overflow) overLines.push(`- ${b}`);
      slides.push(overLines.join("\n"));
    }
  }
  if (page.meta.sources.length > 0) {
    slides.push(["## Sources", "", page.meta.sources.join(", ")].join("\n"));
  }

  const outFile = path.join(outPath, `${page.slug}.md`);
  fs.writeFileSync(outFile, slides.join("\n\n---\n\n") + "\n", "utf-8");
  console.log(`marp: wrote slides to ${outFile}`);
}

function renderReport(pages: Page[], tag: string, outPath: string): void {
  fs.mkdirSync(path.resolve(outPath), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  const sources = pages.filter(p => p.meta.type === "source");
  const concepts = pages.filter(p => p.meta.type === "concept");
  const synthesis = pages.filter(p => p.meta.type === "synthesis");

  const lines: string[] = [
    `# Agent Research Report`,
    `> Generated from LLM Wiki on ${today}`,
    `> Filter: ${tag} (${sources.length} sources, ${concepts.length} concepts, ${synthesis.length} synthesis)`,
    "", "## Overview", "",
  ];
  lines.push(`- **Total pages**: ${pages.length}`);
  lines.push(`- **Sources**: ${sources.length}`);
  lines.push(`- **Concepts**: ${concepts.length}`);
  lines.push(`- **Synthesis**: ${synthesis.length}`);
  const provCounts: Record<string, number> = {};
  for (const p of pages) provCounts[p.meta.provenance] = (provCounts[p.meta.provenance] ?? 0) + 1;
  for (const [k, v] of Object.entries(provCounts)) lines.push(`- **${k}**: ${v} pages`);
  lines.push("");
  if (sources.length > 0) {
    lines.push("## Source Summaries", "");
    for (const p of sources.sort((a, b) => a.slug.localeCompare(b.slug)))
      lines.push(`### ${p.slug} -- ${p.meta.title}`, "", extractSummary(p.body), "");
  }
  if (concepts.length > 0) {
    lines.push("## Concept Map", "");
    for (const p of concepts.sort((a, b) => a.slug.localeCompare(b.slug))) {
      lines.push(`### ${p.meta.title}`, "", extractSummary(p.body));
      const lnk = extractLinks(p.body);
      if (lnk.length) lines.push(`\nRelated: ${lnk.join(", ")}`);
      lines.push("");
    }
  }

  const outFile = path.join(outPath, `report-${tag.replace(/[:/]/g, "-")}.md`);
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf-8");
  console.log(`report: wrote ${outFile} (${pages.length} pages)`);
}

function renderBrief(pages: Page[], outPath: string): void {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const concepts = pages.filter(p => p.meta.type === "concept")
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const lines: string[] = [`# Wiki Knowledge Brief (${today})`, ""];

  for (const p of concepts) {
    lines.push(`## ${p.slug}`, "", extractSummary(p.body));
    if (p.meta.sources.length) lines.push(`Sources: ${p.meta.sources.join(", ")}`);
    lines.push("");
  }
  const sources = pages.filter(p => p.meta.type === "source")
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (sources.length > 0) {
    lines.push("---", `## Source Index (${sources.length} papers)`, "");
    for (const p of sources) {
      const summary = extractSummary(p.body);
      const brief = summary.length > 200 ? summary.slice(0, 200) + "..." : summary;
      lines.push(`- **${p.slug}**: ${brief}`);
    }
    lines.push("");
  }

  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
  console.log(`markdown-brief: wrote ${outPath} (${concepts.length} concepts, ${sources.length} sources)`);
}

const FORMATS = ["jsonl", "marp", "report", "markdown-brief"] as const;
type Format = (typeof FORMATS)[number];

function usage(): void {
  console.log(`kb-output — Render wiki content in multiple formats.
Usage: npx tsx tools/kb-output.ts --format <fmt> [options] --output <path>
Formats: jsonl | marp (--slug required) | report (--tag optional) | markdown-brief
Options: --format, --output, --slug, --tag, --list-formats, --help`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { usage(); return; }
  if (argv.includes("--list-formats")) {
    console.log("Available formats:");
    for (const f of FORMATS) console.log(`  ${f}`);
    return;
  }

  let format: Format | "" = "";
  let output = "";
  let slug = "";
  let tag = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") format = argv[++i] as Format;
    else if (a === "--output") output = argv[++i];
    else if (a === "--slug") slug = argv[++i];
    else if (a === "--tag") tag = argv[++i];
  }

  if (!format) { console.error("Error: --format is required. Use --list-formats to see options."); process.exit(1); }
  if (!FORMATS.includes(format)) { console.error(`Error: unknown format "${format}". Use --list-formats.`); process.exit(1); }
  if (!output) { console.error("Error: --output is required."); process.exit(1); }

  const allPages = collectPages();
  console.log(`Loaded ${allPages.length} wiki pages`);

  switch (format) {
    case "jsonl": {
      renderJsonl(allPages, output);
      break;
    }
    case "marp": {
      if (!slug) { console.error("Error: --slug is required for marp format."); process.exit(1); }
      const page = allPages.find(p => p.slug === slug);
      if (!page) { console.error(`Error: page "${slug}" not found.`); process.exit(1); }
      renderMarp(page, output);
      break;
    }
    case "report": {
      let filtered = allPages;
      if (tag) {
        filtered = allPages.filter(p => p.meta.tags.includes(tag));
        if (filtered.length === 0) {
          console.error(`Error: no pages match tag "${tag}".`);
          process.exit(1);
        }
      }
      renderReport(filtered, tag || "all", output);
      break;
    }
    case "markdown-brief": {
      renderBrief(allPages, output);
      break;
    }
  }
}

main();
