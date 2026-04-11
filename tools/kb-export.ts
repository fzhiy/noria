#!/usr/bin/env npx tsx
/** kb-export — Export verified wiki knowledge for remote machines. */
import * as fs from "node:fs";
import * as path from "node:path";

const TRUST = ["query-derived", "llm-derived", "source-derived", "user-verified"] as const;
type Prov = (typeof TRUST)[number];
const trustRank = (p: string) => { const i = TRUST.indexOf(p as Prov); return i === -1 ? -1 : i; };

interface Meta { title: string; type: string; provenance: string; sources: string[]; tags: string[]; updated: string; [k: string]: unknown }
interface Page { relPath: string; slug: string; meta: Meta; body: string }

function parseFrontmatter(raw: string): { meta: Meta; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const empty: Meta = { title: "", type: "", provenance: "", sources: [], tags: [], updated: "" };
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

const WIKI = path.resolve(import.meta.dirname ?? __dirname, "..", "wiki");

function collectPages(): Page[] {
  const pages: Page[] = [];
  for (const sub of ["sources", "concepts", "synthesis"]) {
    const dir = path.join(WIKI, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".md") && f !== "index.md")) {
      const raw = fs.readFileSync(path.join(dir, f), "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      pages.push({ relPath: path.join(sub, f), slug: f.replace(/\.md$/, ""), meta, body });
    }
  }
  return pages;
}

interface Opts {
  output: string; format: "markdown" | "jsonl"; minProv: Prov;
  dryRun: boolean; incSrc: boolean; incCon: boolean; incSyn: boolean; stripFM: boolean;
}

function parseArgs(argv: string[]): Opts | null {
  const o: Opts = { output: "", format: "markdown", minProv: "llm-derived",
    dryRun: false, incSrc: false, incCon: false, incSyn: false, stripFM: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(`Usage: kb-export [options]

Export wiki pages filtered by provenance trust level.

Options:
  --output <path>          Output directory (markdown) or file (jsonl)  [required]
  --format <type>          "markdown" or "jsonl"                        [markdown]
  --min-provenance <level> Minimum trust: query-derived | llm-derived
                           | source-derived | user-verified            [llm-derived]
  --dry-run                Show what would be exported without writing
  --strip-frontmatter      Remove YAML frontmatter from markdown output
  --include-sources        Include wiki/sources/ pages
  --include-concepts       Include wiki/concepts/ pages
  --include-synthesis      Include wiki/synthesis/ pages
  --help                   Show this help

Trust hierarchy (low -> high):
  query-derived < llm-derived < source-derived < user-verified

Examples:
  npx tsx tools/kb-export.ts --output export/
  npx tsx tools/kb-export.ts --format jsonl --output export/wiki.jsonl
  npx tsx tools/kb-export.ts --min-provenance user-verified --dry-run
  npx tsx tools/kb-export.ts --include-concepts --include-sources --output export/`);
      return null;
    }
    if (a === "--output") o.output = argv[++i];
    else if (a === "--format") o.format = argv[++i] as "markdown" | "jsonl";
    else if (a === "--min-provenance") o.minProv = argv[++i] as Prov;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--strip-frontmatter") o.stripFM = true;
    else if (a === "--include-sources") o.incSrc = true;
    else if (a === "--include-concepts") o.incCon = true;
    else if (a === "--include-synthesis") o.incSyn = true;
  }
  return o;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) process.exit(0);

  if (!opts.output && !opts.dryRun) { console.error("Error: --output is required (or use --dry-run)."); process.exit(1); }
  const minRank = trustRank(opts.minProv);
  if (minRank === -1) { console.error(`Error: unknown provenance level "${opts.minProv}".`); process.exit(1); }

  const hasFilter = opts.incSrc || opts.incCon || opts.incSyn;
  const typeOk = (t: string) => !hasFilter || (opts.incSrc && t === "source") || (opts.incCon && t === "concept") || (opts.incSyn && t === "synthesis");

  const all = collectPages();
  const sel = all.filter(p => trustRank(p.meta.provenance) >= minRank && typeOk(p.meta.type));

  if (opts.dryRun) {
    console.log(`Dry run — ${sel.length}/${all.length} pages match filters`);
    console.log(`  min-provenance: ${opts.minProv} (rank >= ${minRank})`);
    console.log(`  format: ${opts.format}`);
    if (hasFilter) {
      const ts = [opts.incSrc && "sources", opts.incCon && "concepts", opts.incSyn && "synthesis"].filter(Boolean);
      console.log(`  types: ${ts.join(", ")}`);
    }
    console.log("");
    for (const p of sel) console.log(`  [${p.meta.provenance}] ${p.relPath} — ${p.meta.title}`);
    return;
  }

  if (opts.format === "jsonl") {
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    const lines = sel.map(p => JSON.stringify({
      slug: p.slug, title: p.meta.title, type: p.meta.type, provenance: p.meta.provenance,
      sources: p.meta.sources, tags: p.meta.tags, content: p.body, updated: p.meta.updated,
    }));
    fs.writeFileSync(opts.output, lines.join("\n") + "\n", "utf-8");
    console.log(`Wrote ${sel.length} records to ${opts.output}`);
  } else {
    fs.mkdirSync(opts.output, { recursive: true });
    for (const p of sel) {
      const dest = path.join(opts.output, p.relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const raw = fs.readFileSync(path.join(WIKI, p.relPath), "utf-8");
      fs.writeFileSync(dest, opts.stripFM ? p.body : raw, "utf-8");
    }
    const metadata = {
      exportedAt: new Date().toISOString(), pageCount: sel.length,
      minProvenance: opts.minProv, format: "markdown",
      pages: sel.map(p => ({ relPath: p.relPath, slug: p.slug, provenance: p.meta.provenance, type: p.meta.type })),
    };
    fs.writeFileSync(path.join(opts.output, "_metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf-8");
    console.log(`Exported ${sel.length} pages to ${opts.output}/`);
  }
}

main();
