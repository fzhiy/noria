#!/usr/bin/env npx tsx
/**
 * Juggl Typed Links Injector — Injects typed relation links into wiki/ frontmatter
 * for Obsidian Juggl plugin visualization.
 *
 * Reads .kb/relations.jsonl and adds `juggl-links:` field to wiki page frontmatter.
 * Only injects semantically meaningful relation types (extends, supports, contradicts, related).
 * Skips plain wikilinks (already visible in Obsidian graph).
 *
 * Usage:
 *   npx tsx tools/kb-juggl-inject.ts              # Inject into all wiki pages
 *   npx tsx tools/kb-juggl-inject.ts --dry-run     # Preview changes without writing
 *   npx tsx tools/kb-juggl-inject.ts --clean        # Remove all juggl-links fields
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const RELATIONS = resolve(ROOT, ".kb", "relations.jsonl");

// Relation types worth injecting (skip wikilink — already in Obsidian graph)
const INJECT_TYPES = new Set(["extends", "supports", "contradicts", "related"]);

interface Relation {
  source: string;
  target: string;
  type: string;
}

interface JugglLink {
  type: string;
  target: string;
}

function loadRelations(): Relation[] {
  if (!existsSync(RELATIONS)) {
    console.error("No .kb/relations.jsonl found. Run `npx tsx tools/kb-relations.ts --scan` first.");
    process.exit(1);
  }
  return readFileSync(RELATIONS, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean) as Relation[];
}

function buildLinkMap(relations: Relation[]): Map<string, JugglLink[]> {
  const map = new Map<string, JugglLink[]>();
  for (const rel of relations) {
    if (!INJECT_TYPES.has(rel.type)) continue;
    // Forward direction: source → target
    if (!map.has(rel.source)) map.set(rel.source, []);
    map.get(rel.source)!.push({ type: rel.type, target: rel.target });
  }
  // Deduplicate per slug
  for (const [slug, links] of map) {
    const seen = new Set<string>();
    map.set(slug, links.filter(l => {
      const key = `${l.type}:${l.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  return map;
}

function formatJugglYaml(links: JugglLink[]): string {
  return links.map(l => `  - type: ${l.type}\n    target: "[[${l.target}]]"`).join("\n");
}

function processFile(filePath: string, slug: string, links: JugglLink[], dryRun: boolean, clean: boolean): boolean {
  const content = readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^(---\n)([\s\S]*?)\n(---)/);
  if (!fmMatch) return false;

  const [fullMatch, open, fmBody, close] = fmMatch;
  const restContent = content.slice(fullMatch.length);

  // Remove existing juggl-links block
  const cleaned = fmBody.replace(/juggl-links:\n(?:  - type: \S+\n    target: "[^"]+"\n?)*/g, "").trimEnd();

  if (clean) {
    if (cleaned === fmBody.trimEnd()) return false; // nothing to clean
    const newContent = `${open}${cleaned}\n${close}${restContent}`;
    if (!dryRun) writeFileSync(filePath, newContent);
    return true;
  }

  if (!links || links.length === 0) return false;

  const jugglBlock = `juggl-links:\n${formatJugglYaml(links)}`;
  const newFm = `${cleaned}\n${jugglBlock}`;
  const newContent = `${open}${newFm}\n${close}${restContent}`;

  if (newContent === content) return false; // no change

  if (!dryRun) writeFileSync(filePath, newContent);
  return true;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const clean = argv.includes("--clean");

  const relations = loadRelations();
  const linkMap = buildLinkMap(relations);

  console.log(`Loaded ${relations.length} relations, ${linkMap.size} pages with injectable links`);
  if (dryRun) console.log("DRY RUN — no files will be modified\n");
  if (clean) console.log("CLEAN MODE — removing all juggl-links fields\n");

  let modified = 0;
  let skipped = 0;

  for (const dir of ["sources", "concepts", "synthesis"]) {
    const dirPath = resolve(WIKI, dir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath).filter(f => f.endsWith(".md"))) {
      const slug = f.replace(/\.md$/, "");
      const links = linkMap.get(slug) ?? [];
      const filePath = resolve(dirPath, f);

      if (processFile(filePath, slug, links, dryRun, clean)) {
        modified++;
        if (dryRun) {
          const action = clean ? "would clean" : "would inject";
          console.log(`  ${action}: ${dir}/${slug} (${links.length} links)`);
        }
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n${clean ? "Cleaned" : "Injected"}: ${modified} files, Skipped: ${skipped} files`);
  if (dryRun) console.log("(dry run — no files changed)");
}

main();
