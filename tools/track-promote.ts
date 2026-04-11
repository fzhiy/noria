#!/usr/bin/env npx tsx
/**
 * Track promotion tool: discover and promote social-lead pages to source-derived.
 *
 * Scans social-lead wiki pages for links to peer-reviewed papers (arXiv, DOI).
 * When a paper is found and compiled, promotes the social-lead page.
 *
 * Usage:
 *   npx tsx tools/track-promote.ts --scan                   # Scan all social-lead pages for promotion candidates
 *   npx tsx tools/track-promote.ts --check <slug>           # Check a specific page for promotion
 *   npx tsx tools/track-promote.ts --promote <slug> --paper <paper-citekey>  # Promote a page
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_SRC = resolve(ROOT, "wiki", "sources");
const WIKI_CON = resolve(ROOT, "wiki", "concepts");
const WIKI_SYN = resolve(ROOT, "wiki", "synthesis");

// ── Frontmatter parser ────────────────────────────────────────────────
function parseFm(text: string): Record<string, any> | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm: Record<string, any> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([^:]+?):\s*(.*)/);
    if (!kv) continue;
    const key = kv[1].trim();
    let val: any = kv[2].trim().replace(/^["']|["']$/g, "");
    if (val.startsWith("[") && val.endsWith("]")) {
      try { val = JSON.parse(val); } catch {
        val = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
    fm[key] = val;
  }
  return Object.keys(fm).length > 0 ? fm : null;
}

// ── Link extraction ───────────────────────────────────────────────────
interface FoundLink {
  type: "arxiv" | "doi" | "github" | "url";
  value: string;
}

function extractLinks(text: string): FoundLink[] {
  const links: FoundLink[] = [];
  // arXiv links
  const arxivRe = /(?:arxiv\.org\/abs\/|arXiv:)(\d{4}\.\d{4,5})/gi;
  let m: RegExpExecArray | null;
  while ((m = arxivRe.exec(text)) !== null) links.push({ type: "arxiv", value: m[1] });
  // DOI links
  const doiRe = /(?:doi\.org\/|DOI:\s*)(10\.\d{4,}\/[^\s,\]]+)/gi;
  while ((m = doiRe.exec(text)) !== null) links.push({ type: "doi", value: m[1] });
  // GitHub repo links
  const ghRe = /github\.com\/([\w-]+\/[\w.-]+)/gi;
  while ((m = ghRe.exec(text)) !== null) links.push({ type: "github", value: m[1] });
  return links;
}

// ── Page loading ──────────────────────────────────────────────────────
interface PageInfo {
  slug: string;
  path: string;
  provenance: string;
  title: string;
  sources: string[];
  links: FoundLink[];
  content: string;
}

function loadSocialLeadPages(): PageInfo[] {
  const pages: PageInfo[] = [];
  if (!existsSync(WIKI_SRC)) return pages;
  for (const f of readdirSync(WIKI_SRC).filter(f => f.endsWith(".md"))) {
    const path = resolve(WIKI_SRC, f);
    const content = readFileSync(path, "utf-8");
    const fm = parseFm(content);
    if (!fm || fm.provenance !== "social-lead") continue;
    pages.push({
      slug: f.replace(/\.md$/, ""),
      path,
      provenance: fm.provenance,
      title: String(fm.title ?? f),
      sources: Array.isArray(fm.sources) ? fm.sources : [],
      links: extractLinks(content),
      content,
    });
  }
  return pages;
}

function findCompiledPaper(link: FoundLink): string | null {
  // Check if a paper matching this link exists in wiki/sources/ as source-derived
  if (!existsSync(WIKI_SRC)) return null;
  for (const f of readdirSync(WIKI_SRC).filter(f => f.endsWith(".md"))) {
    const content = readFileSync(resolve(WIKI_SRC, f), "utf-8");
    const fm = parseFm(content);
    if (!fm || fm.provenance === "social-lead") continue;
    if (link.type === "arxiv" && content.includes(link.value)) return f.replace(/\.md$/, "");
    if (link.type === "doi" && content.includes(link.value)) return f.replace(/\.md$/, "");
  }
  return null;
}

// ── Commands ──────────────────────────────────────────────────────────
function cmdScan() {
  const pages = loadSocialLeadPages();
  if (pages.length === 0) {
    console.log("No social-lead pages found.");
    return;
  }

  console.log(`=== Track Promotion Scan ===\n`);
  console.log(`Found ${pages.length} social-lead page(s):\n`);

  let candidates = 0;
  for (const p of pages) {
    const hasLinks = p.links.length > 0;
    console.log(`  ${p.slug}`);
    console.log(`    Title: ${p.title}`);

    if (p.links.length === 0) {
      console.log(`    Links: none found (no promotion path)`);
      console.log(``);
      continue;
    }

    console.log(`    Links: ${p.links.map(l => `${l.type}:${l.value}`).join(", ")}`);

    for (const link of p.links) {
      const paper = findCompiledPaper(link);
      if (paper) {
        console.log(`    ✓ PROMOTABLE: linked paper "${paper}" is already compiled`);
        console.log(`      Run: npx tsx tools/track-promote.ts --promote ${p.slug} --paper ${paper}`);
        candidates++;
      } else {
        console.log(`    ○ ${link.type}:${link.value} — not yet compiled. Search/compile first.`);
      }
    }
    console.log(``);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Social-lead pages: ${pages.length}`);
  console.log(`Promotion candidates: ${candidates}`);
  console.log(`Pages without links: ${pages.filter(p => p.links.length === 0).length}`);
}

function cmdCheck(slug: string) {
  const path = resolve(WIKI_SRC, `${slug}.md`);
  if (!existsSync(path)) {
    console.error(`Page not found: wiki/sources/${slug}.md`);
    process.exit(1);
  }

  const content = readFileSync(path, "utf-8");
  const fm = parseFm(content);
  if (!fm) { console.error("No frontmatter found"); process.exit(1); }

  console.log(`=== Check: ${slug} ===\n`);
  console.log(`  Title: ${fm.title}`);
  console.log(`  Provenance: ${fm.provenance}`);
  console.log(`  Venue Tier: ${fm.venue_tier ?? "none"}`);

  if (fm.provenance !== "social-lead") {
    console.log(`\n  Not a social-lead page. No promotion needed.`);
    return;
  }

  const links = extractLinks(content);
  if (links.length === 0) {
    console.log(`\n  No arXiv/DOI/GitHub links found. Cannot promote without a paper reference.`);
    return;
  }

  console.log(`\n  Found links:`);
  for (const link of links) {
    const paper = findCompiledPaper(link);
    if (paper) {
      console.log(`    ✓ ${link.type}:${link.value} → compiled as "${paper}"`);
      console.log(`      Ready to promote: --promote ${slug} --paper ${paper}`);
    } else {
      console.log(`    ○ ${link.type}:${link.value} → not compiled yet`);
    }
  }
}

function cmdPromote(slug: string, paperCitekey: string) {
  const path = resolve(WIKI_SRC, `${slug}.md`);
  if (!existsSync(path)) {
    console.error(`Page not found: wiki/sources/${slug}.md`);
    process.exit(1);
  }

  const paperPath = resolve(WIKI_SRC, `${paperCitekey}.md`);
  if (!existsSync(paperPath)) {
    console.error(`Paper not found: wiki/sources/${paperCitekey}.md`);
    console.error("Compile the paper first, then promote.");
    process.exit(1);
  }

  const paperFm = parseFm(readFileSync(paperPath, "utf-8"));
  if (!paperFm || paperFm.provenance === "social-lead") {
    console.error(`Paper "${paperCitekey}" is itself social-lead. Cannot promote with a social-lead source.`);
    process.exit(1);
  }

  let content = readFileSync(path, "utf-8");
  const fm = parseFm(content);
  if (!fm || fm.provenance !== "social-lead") {
    console.error(`Page "${slug}" is not social-lead (current: ${fm?.provenance}). Nothing to promote.`);
    process.exit(1);
  }

  // Update provenance
  content = content.replace(/provenance:\s*social-lead/, "provenance: source-derived");

  // Update venue_tier from paper if available
  if (paperFm.venue_tier && paperFm.venue_tier !== "social") {
    content = content.replace(/venue_tier:\s*social/, `venue_tier: ${paperFm.venue_tier}`);
  }

  // Add paper citekey to sources if not already present
  if (!content.includes(paperCitekey)) {
    content = content.replace(
      /sources:\s*\[([^\]]*)\]/,
      (match, existing) => {
        const sources = existing.split(",").map((s: string) => s.trim()).filter(Boolean);
        sources.push(paperCitekey);
        return `sources: [${sources.join(", ")}]`;
      }
    );
  }

  writeFileSync(path, content, "utf-8");
  console.log(`✓ Promoted: ${slug}`);
  console.log(`  provenance: social-lead → source-derived`);
  console.log(`  Linked paper: ${paperCitekey}`);
  console.log(`  Venue tier: ${paperFm.venue_tier ?? "unchanged"}`);
  console.log(`\n  Next: run /kb-compile to update concept pages if needed.`);
}

// ── Main ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv[0]?.replace(/^--/, "");

switch (mode) {
  case "scan":
    cmdScan();
    break;
  case "check":
    if (!argv[1]) { console.error("Usage: --check <slug>"); process.exit(1); }
    cmdCheck(argv[1]);
    break;
  case "promote": {
    const slug = argv[1];
    const paperIdx = argv.indexOf("--paper");
    const paper = paperIdx >= 0 ? argv[paperIdx + 1] : undefined;
    if (!slug || !paper) {
      console.error("Usage: --promote <slug> --paper <paper-citekey>");
      process.exit(1);
    }
    cmdPromote(slug, paper);
    break;
  }
  default:
    console.error(`Usage:
  npx tsx tools/track-promote.ts --scan                              Scan all social-lead pages
  npx tsx tools/track-promote.ts --check <slug>                      Check a specific page
  npx tsx tools/track-promote.ts --promote <slug> --paper <citekey>  Promote a page`);
    process.exit(1);
}
