#!/usr/bin/env npx tsx
/** kb-merge — Merge duplicate wiki concept pages with redirect stubs and backlink rewiring. */
import * as fs from "node:fs";
import * as path from "node:path";

const WIKI = path.resolve(import.meta.dirname ?? __dirname, "..", "wiki");
const CONCEPTS = path.join(WIKI, "concepts");

interface Meta {
  title: string; type: string; provenance: string;
  sources: string[]; tags: string[]; aliases: string[];
  created: string; updated: string; [k: string]: unknown;
}

function parseFrontmatter(raw: string): { meta: Meta; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const empty: Meta = { title: "", type: "", provenance: "", sources: [], tags: [], aliases: [], created: "", updated: "" };
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
  for (const k of ["sources", "tags", "aliases"])
    if (!Array.isArray(data[k])) data[k] = data[k] ? [String(data[k])] : [];
  return { meta: { ...empty, ...data } as Meta, body: m[2] };
}

function serializeFrontmatter(meta: Meta): string {
  const q = (s: string) => /[:#\[\],{}]/.test(s) ? `"${s}"` : s;
  const a = (xs: string[]) => xs.length === 0 ? "[]" : `[${xs.map(q).join(", ")}]`;
  const lines = [`title: "${meta.title}"`, `type: ${meta.type}`, `provenance: ${meta.provenance}`,
    `sources: ${a(meta.sources)}`, `tags: ${a(meta.tags)}`];
  if (meta.aliases.length > 0) lines.push(`aliases: ${a(meta.aliases)}`);
  if (meta.merged_into) lines.push(`merged_into: ${meta.merged_into}`);
  lines.push(`created: ${meta.created}`, `updated: ${meta.updated}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function collectMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectMdFiles(full));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findBacklinks(slug: string, files: string[]): { file: string; count: number }[] {
  const re = new RegExp(`\\[\\[${esc(slug)}(\\|[^\\]]*)?\\]\\]`, "g");
  const hits: { file: string; count: number }[] = [];
  for (const f of files) {
    const matches = fs.readFileSync(f, "utf-8").match(re);
    if (matches) hits.push({ file: f, count: matches.length });
  }
  return hits;
}

function rewriteLinks(file: string, from: string, to: string, toTitle: string, dry: boolean): number {
  const content = fs.readFileSync(file, "utf-8");
  const pipeRe = new RegExp(`\\[\\[${esc(from)}\\|([^\\]]*)\\]\\]`, "g");
  const bareRe = new RegExp(`\\[\\[${esc(from)}\\]\\]`, "g");
  let out = content.replace(pipeRe, `[[${to}|$1]]`);
  out = out.replace(bareRe, `[[${to}|${toTitle}]]`);
  if (out !== content) {
    const n = (content.match(pipeRe) || []).length + (content.match(bareRe) || []).length;
    if (!dry) fs.writeFileSync(file, out, "utf-8");
    return n;
  }
  return 0;
}

function sequenceMatchRatio(a: string, b: string): number {
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

function listCandidates(): void {
  if (!fs.existsSync(CONCEPTS)) { console.log("No concepts directory found."); return; }
  const entries: { slug: string; title: string }[] = [];
  for (const f of fs.readdirSync(CONCEPTS).filter(f => f.endsWith(".md"))) {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(CONCEPTS, f), "utf-8"));
    if (meta.title && !meta.merged_into) entries.push({ slug: f.replace(/\.md$/, ""), title: meta.title });
  }
  const pairs: { a: string; b: string; ta: string; tb: string; score: number }[] = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const s = sequenceMatchRatio(entries[i].title, entries[j].title);
      if (s > 0.7) pairs.push({ a: entries[i].slug, b: entries[j].slug, ta: entries[i].title, tb: entries[j].title, score: s });
    }
  if (pairs.length === 0) { console.log("No fuzzy-match candidates found (threshold > 0.7)."); return; }
  pairs.sort((x, y) => y.score - x.score);
  console.log(`Found ${pairs.length} candidate pair(s) with title similarity > 0.7:\n`);
  for (const p of pairs) console.log(`  ${p.score.toFixed(3)}  ${p.a} ("${p.ta}")  <->  ${p.b} ("${p.tb}")`);
}

function updateIndex(fromSlug: string, toSlug: string, dry: boolean): boolean {
  const idxPath = path.join(WIKI, "index.md");
  if (!fs.existsSync(idxPath)) return false;
  const lines = fs.readFileSync(idxPath, "utf-8").split("\n");
  const fromRe = new RegExp(`\\[\\[${esc(fromSlug)}(\\|[^\\]]*)?\\]\\]`);
  const toRe = new RegExp(`\\[\\[${esc(toSlug)}(\\|[^\\]]*)?\\]\\]`);
  let fromLine = -1, fromDesc = "", toLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fromRe.test(lines[i])) { fromLine = i; const dm = lines[i].match(/—\s*(.*)/); if (dm) fromDesc = dm[1].trim(); }
    if (toRe.test(lines[i])) toLine = i;
  }
  if (fromLine === -1) return false;
  lines.splice(fromLine, 1);
  if (toLine > fromLine) toLine--;
  if (toLine !== -1 && fromDesc) {
    const td = lines[toLine].match(/—\s*(.*)/);
    if ((!td || td[1].trim() !== fromDesc) && !lines[toLine].includes("(also:"))
      lines[toLine] = `${lines[toLine]} (also: ${fromDesc})`;
  }
  if (!dry) fs.writeFileSync(idxPath, lines.join("\n"), "utf-8");
  return true;
}

function merge(fromSlug: string, toSlug: string, dryRun: boolean): void {
  const today = new Date().toISOString().slice(0, 10);
  const L = dryRun ? "[DRY RUN] " : "";

  if (fromSlug === toSlug) { console.error("Error: cannot merge a concept into itself."); process.exit(1); }
  const fromPath = path.join(CONCEPTS, `${fromSlug}.md`);
  const toPath = path.join(CONCEPTS, `${toSlug}.md`);
  if (!fs.existsSync(fromPath)) { console.error(`Error: ${fromPath} does not exist.`); process.exit(1); }
  if (!fs.existsSync(toPath)) { console.error(`Error: ${toPath} does not exist.`); process.exit(1); }

  const from = parseFrontmatter(fs.readFileSync(fromPath, "utf-8"));
  const to = parseFrontmatter(fs.readFileSync(toPath, "utf-8"));
  console.log(`${L}Merging: ${fromSlug} ("${from.meta.title}") → ${toSlug} ("${to.meta.title}")\n`);

  // Collect backlinks
  const allFiles = collectMdFiles(WIKI);
  const backlinks = findBacklinks(fromSlug, allFiles.filter(f => f !== fromPath));
  console.log(`${L}Found ${backlinks.length} page(s) linking to ${fromSlug}`);
  for (const bl of backlinks) console.log(`  ${path.relative(WIKI, bl.file)} (${bl.count} link(s))`);

  // Merge content
  const srcA = from.meta.sources.length, srcB = to.meta.sources.length;
  const mergedSrc = [...new Set([...to.meta.sources, ...from.meta.sources])];
  const mergedTags = [...new Set([...to.meta.tags, ...from.meta.tags])];
  const mergedAliases = [...new Set([...to.meta.aliases, ...from.meta.aliases, from.meta.title])]
    .filter(a => a !== to.meta.title);
  const mergedMeta: Meta = { ...to.meta, sources: mergedSrc, tags: mergedTags, aliases: mergedAliases, updated: today };

  let mergedBody = to.body;
  const fromBody = from.body.trim();
  if (fromBody) mergedBody = mergedBody.trimEnd() + `\n\n## Merged from [[${fromSlug}|${from.meta.title}]]\n\n${fromBody}\n`;
  const mergedContent = serializeFrontmatter(mergedMeta) + "\n" + mergedBody;

  if (dryRun) {
    console.log(`\n--- Merged content for ${toSlug}.md (preview) ---`);
    console.log(mergedContent.slice(0, 2000) + (mergedContent.length > 2000 ? "\n... (truncated)" : ""));
    console.log("--- end preview ---");
  } else fs.writeFileSync(toPath, mergedContent, "utf-8");

  // Rewrite wikilinks
  let totalRewired = 0, pagesRewired = 0;
  for (const f of allFiles) {
    if (f === fromPath) continue;
    const n = rewriteLinks(f, fromSlug, toSlug, to.meta.title, dryRun);
    if (n > 0) { totalRewired += n; pagesRewired++; }
  }
  console.log(`${L}Backlinks rewired: ${totalRewired} link(s) in ${pagesRewired} page(s)`);

  // Create redirect stub
  const stubMeta: Meta = {
    title: from.meta.title, type: "concept", provenance: "llm-derived",
    sources: [], tags: [], aliases: from.meta.aliases.length > 0 ? from.meta.aliases : [from.meta.title],
    created: from.meta.created || today, updated: today, merged_into: toSlug,
  };
  const stubContent = serializeFrontmatter(stubMeta) + `\nThis concept has been merged into [[${toSlug}|${to.meta.title}]].\n`;
  if (dryRun) {
    console.log(`\n--- Redirect stub for ${fromSlug}.md (preview) ---`);
    console.log(stubContent);
    console.log("--- end preview ---");
  } else fs.writeFileSync(fromPath, stubContent, "utf-8");

  // Update index.md
  const idxOk = updateIndex(fromSlug, toSlug, dryRun);
  console.log(`${L}Index updated: ${idxOk ? "yes" : "no entry found for " + fromSlug}`);

  // Report
  const dup = srcA + srcB - mergedSrc.length;
  console.log(`\n${L}=== Merge Summary ===`);
  console.log(`Merged: ${fromSlug} → ${toSlug}`);
  console.log(`- Sources: ${srcA} + ${srcB} = ${mergedSrc.length} (${dup} duplicate(s) removed)`);
  console.log(`- Backlinks rewired: ${pagesRewired} page(s)`);
  console.log(`- Redirect stub created: wiki/concepts/${fromSlug}.md`);
}

function main(): void {
  const args = process.argv.slice(2);
  let fromSlug = "", toSlug = "", dryRun = false, list = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(`Usage: kb-merge [options]

Merge duplicate wiki concept pages with redirect stubs and backlink rewiring.

Options:
  --from <slug>       Source concept slug to merge away
  --to <slug>         Canonical concept slug to merge into
  --dry-run           Preview changes without writing files
  --list-candidates   Show fuzzy-match concept pairs (similarity > 0.7)
  --help              Show this help

Examples:
  npx tsx tools/kb-merge.ts --list-candidates
  npx tsx tools/kb-merge.ts --from old-slug --to canonical-slug --dry-run
  npx tsx tools/kb-merge.ts --from old-slug --to canonical-slug`);
      return;
    }
    if (a === "--from") fromSlug = args[++i] || "";
    else if (a === "--to") toSlug = args[++i] || "";
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--list-candidates") list = true;
  }
  if (list) { listCandidates(); return; }
  if (!fromSlug || !toSlug) { console.error("Error: --from and --to are required (or use --list-candidates)."); process.exit(1); }
  merge(fromSlug, toSlug, dryRun);
}

main();
