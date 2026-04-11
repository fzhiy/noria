#!/usr/bin/env npx tsx
/** kb-import — Import existing Obsidian/markdown notes into raw/imports/ for /kb-compile. */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const TODAY = new Date().toISOString().slice(0, 10);
interface Meta { title: string; tags: string[]; [k: string]: unknown }

function parseFrontmatter(raw: string): { meta: Meta | null; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: null, body: raw };
  const data: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const arr = kv[2].match(/^\[([^\]]*)\]$/);
    data[kv[1]] = arr
      ? arr[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : kv[2].replace(/^["']|["']$/g, "").trim();
  }
  if (!Array.isArray(data.tags)) data.tags = data.tags ? [String(data.tags)] : [];
  return { meta: { title: "", ...data } as Meta, body: m[2] };
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function makeSlug(title: string | undefined, filename: string): string {
  const base = title ? toSlug(title) : toSlug(filename.replace(/\.md$/, ""));
  return base.startsWith("import-") ? base : `import-${base}`;
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return 1.0;
  const [shorter, longer] = la.length <= lb.length ? [la, lb] : [lb, la];
  if (longer.length === 0) return 1.0;
  const m = shorter.length, n = longer.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = shorter[i - 1] === longer[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return (2.0 * dp[m][n]) / (m + n);
}
function scanMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...scanMarkdown(full));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}
function collectExistingTitles(): { source: string; title: string; file: string }[] {
  const titles: { source: string; title: string; file: string }[] = [];
  for (const { dir, source } of [
    { dir: path.join(ROOT, "raw/zotero/papers"), source: "zotero" },
    { dir: path.join(ROOT, "raw/imports"), source: "imports" },
    { dir: path.join(ROOT, "wiki/sources"), source: "wiki-sources" },
  ]) {
    for (const f of scanMarkdown(dir)) {
      const { meta } = parseFrontmatter(fs.readFileSync(f, "utf-8"));
      titles.push({ source, title: meta?.title || path.basename(f, ".md"), file: f });
    }
  }
  return titles;
}
function buildImportContent(originalPath: string, meta: Meta | null, body: string): string {
  const title = meta?.title || path.basename(originalPath, ".md").replace(/[-_]/g, " ");
  const originalTags = (meta?.tags as string[]) || [];
  const lines = [
    `---`, `title: "${title}"`, `type: note`, `source_type: import`,
    `import_source: "${originalPath}"`, `import_date: ${TODAY}`, `tags: [imported]`,
  ];
  if (originalTags.length > 0)
    lines.push(`original_tags: [${originalTags.map(t => `"${t}"`).join(", ")}]`);
  if (meta) {
    const skip = new Set(["title", "tags", "type", "source_type", "import_source", "import_date", "original_tags"]);
    const extras = Object.entries(meta)
      .filter(([k, v]) => !skip.has(k) && v !== "" && !(Array.isArray(v) && v.length === 0));
    if (extras.length > 0) {
      lines.push(`import_meta:`);
      for (const [k, v] of extras) lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push(`---`, "", body);
  return lines.join("\n");
}
interface Opts { source: string; target: string; dryRun: boolean; dedupe: boolean }

function parseArgs(argv: string[]): Opts | null {
  const o: Opts = { source: "", target: "", dryRun: false, dedupe: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(`Usage: kb-import --source <path> [--target <path>] [--dry-run] [--dedupe]

Import Obsidian/markdown notes into raw/imports/ for /kb-compile.

  --source <path>  Source directory to scan for .md files     [required]
  --target <path>  Target subdirectory under raw/imports/     [raw/imports/notes]
  --dry-run        Preview without writing files
  --dedupe         Check against existing raw/ and wiki/ for duplicates
  --help           Show this help`);
      return null;
    }
    if (a === "--source") o.source = argv[++i] || "";
    else if (a === "--target") o.target = argv[++i] || "";
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--dedupe") o.dedupe = true;
  }
  return o;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) process.exit(0);
  if (!opts.source) { console.error("Error: --source is required."); process.exit(1); }

  const sourceDir = path.resolve(opts.source);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.error(`Error: source directory does not exist: ${sourceDir}`); process.exit(1);
  }
  const targetDir = opts.target ? path.resolve(ROOT, opts.target) : path.join(ROOT, "raw/imports/notes");
  const L = opts.dryRun ? "[DRY RUN] " : "";

  const files = scanMarkdown(sourceDir);
  console.log(`${L}Scanned ${sourceDir}: found ${files.length} .md file(s)\n`);
  if (files.length === 0) { console.log("Nothing to import."); return; }

  const existing = opts.dedupe ? collectExistingTitles() : [];
  if (opts.dedupe) console.log(`${L}Loaded ${existing.length} existing title(s) for dedup\n`);

  let imported = 0, skippedDup = 0, skippedEmpty = 0, generatedFM = 0;
  const results: string[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8").trim();
    if (!raw) { skippedEmpty++; results.push(`  SKIP (empty): ${path.relative(sourceDir, file)}`); continue; }

    const { meta, body } = parseFrontmatter(raw);
    if (meta && !body.trim()) results.push(`  WARN (frontmatter only): ${path.relative(sourceDir, file)}`);
    if (!meta) generatedFM++;

    const title = meta?.title || path.basename(file, ".md").replace(/[-_]/g, " ");
    const slug = makeSlug(meta?.title, path.basename(file));

    if (opts.dedupe) {
      let dupFound = false;
      const baseName = path.basename(file);
      for (const ex of existing) {
        if (ex.source === "imports" && path.basename(ex.file) === baseName) {
          results.push(`  DUP (filename in imports): ${path.relative(sourceDir, file)} <-> ${path.relative(ROOT, ex.file)}`);
          dupFound = true; break;
        }
      }
      if (!dupFound) {
        for (const ex of existing) {
          if (ex.source === "imports") continue;
          const sim = similarity(title, ex.title);
          if (sim > 0.85) {
            results.push(`  DUP (title ${sim.toFixed(2)} with ${ex.source}): "${title}" <-> "${ex.title}" (${path.relative(ROOT, ex.file)})`);
            dupFound = true; break;
          }
        }
      }
      if (dupFound) { skippedDup++; continue; }
    }

    const content = buildImportContent(file, meta, body);
    const outPath = path.join(targetDir, `${slug}.md`);
    if (opts.dryRun) {
      results.push(`  IMPORT: ${path.relative(sourceDir, file)} -> ${path.relative(ROOT, outPath)}`);
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      let finalPath = outPath, suffix = 1;
      while (fs.existsSync(finalPath)) { finalPath = path.join(targetDir, `${slug}-${suffix}.md`); suffix++; }
      fs.writeFileSync(finalPath, content, "utf-8");
      results.push(`  IMPORT: ${path.relative(sourceDir, file)} -> ${path.relative(ROOT, finalPath)}`);
    }
    imported++;
  }

  console.log(results.join("\n"));
  console.log(`\n${L}=== Import Summary ===`);
  console.log(`Imported ${imported} file(s), skipped ${skippedDup} duplicate(s), skipped ${skippedEmpty} empty file(s)`);
  if (generatedFM > 0) console.log(`Generated frontmatter for ${generatedFM} file(s) that had none`);
  if (!opts.dryRun && imported > 0) {
    console.log(`\nFiles written to: ${path.relative(ROOT, targetDir)}/`);
    console.log(`Next step: run /kb-compile to process imported notes into wiki/`);
  }
}

main();
