#!/usr/bin/env npx tsx
/**
 * Cascade deletion / archival tool for wiki pages.
 *
 * Moves a page to wiki/archive/, cleans up wikilinks, relations, manifest,
 * and index.md references. Zero LLM cost, idempotent.
 *
 * Usage:
 *   npx tsx tools/kb-delete.ts --archive <slug> --reason retracted|merged|duplicate|off-topic
 *   npx tsx tools/kb-delete.ts --archive <slug> --reason merged --dry-run
 *   npx tsx tools/kb-delete.ts --list-archived   # Show archived pages
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = resolve(ROOT, "wiki");
const ARCHIVE = resolve(WIKI, "archive");
const KB = resolve(ROOT, ".kb");
const RELATIONS = resolve(KB, "relations.jsonl");
const MANIFEST = resolve(KB, "manifest.json");
const INDEX = resolve(WIKI, "index.md");

const VALID_REASONS = ["retracted", "merged", "duplicate", "off-topic"] as const;
type ArchiveReason = typeof VALID_REASONS[number];

interface Action {
  type: "move" | "edit" | "remove-relation" | "update-manifest" | "update-index";
  file: string;
  detail: string;
}

function findPage(slug: string): string | null {
  for (const dir of ["sources", "concepts", "synthesis", "entities"]) {
    const p = resolve(WIKI, dir, `${slug}.md`);
    if (existsSync(p)) return p;
  }
  // Check archive (for idempotency)
  const archived = resolve(ARCHIVE, `${slug}.md`);
  if (existsSync(archived)) return null; // already archived
  return null;
}

function collectActions(slug: string, reason: ArchiveReason): Action[] {
  const actions: Action[] = [];
  const pagePath = findPage(slug);

  if (!pagePath) {
    // Check if already archived (idempotent)
    if (existsSync(resolve(ARCHIVE, `${slug}.md`))) {
      console.log(`Already archived: ${slug}`);
      return [];
    }
    console.error(`Page not found: ${slug}`);
    process.exit(1);
  }

  const relPath = relative(WIKI, pagePath);
  const dir = relPath.split("/")[0]; // sources, concepts, etc.

  // 1. Move to archive
  actions.push({
    type: "move",
    file: pagePath,
    detail: `Move wiki/${relPath} → wiki/archive/${basename(pagePath)}`,
  });

  // 2. Clean wikilinks in all wiki pages — handles both [[slug]] and [[slug|label]] forms
  const wlRegex = new RegExp(`\\[\\[${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^\\]]+)?\\]\\]`, "g");
  const wikiDirs = ["sources", "concepts", "synthesis", "entities"];
  for (const d of wikiDirs) {
    const dirPath = resolve(WIKI, d);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith(".md")) continue;
      const fp = resolve(dirPath, f);
      const content = readFileSync(fp, "utf-8");
      if (wlRegex.test(content)) {
        wlRegex.lastIndex = 0; // reset regex state
        actions.push({
          type: "edit",
          file: fp,
          detail: `Remove [[${slug}]] and [[${slug}|...]] wikilinks in ${d}/${f}`,
        });
      }
    }
  }
  // Also check index.md, dashboard, MOC files
  for (const f of readdirSync(WIKI)) {
    if (!f.endsWith(".md")) continue;
    const fp = resolve(WIKI, f);
    const content = readFileSync(fp, "utf-8");
    wlRegex.lastIndex = 0;
    if (wlRegex.test(content) || content.includes(slug)) {
      wlRegex.lastIndex = 0;
      actions.push({
        type: "edit",
        file: fp,
        detail: `Clean references to ${slug} in ${f}`,
      });
    }
  }

  // 3. Remove relations
  if (existsSync(RELATIONS)) {
    const lines = readFileSync(RELATIONS, "utf-8").split("\n").filter(Boolean);
    const relatedCount = lines.filter(l => l.includes(`"${slug}"`)).length;
    if (relatedCount > 0) {
      actions.push({
        type: "remove-relation",
        file: RELATIONS,
        detail: `Remove ${relatedCount} relation edges involving ${slug}`,
      });
    }
  }

  // 4. Update manifest
  if (existsSync(MANIFEST)) {
    actions.push({
      type: "update-manifest",
      file: MANIFEST,
      detail: `Set status=archived, reason=${reason} for entries referencing ${slug}`,
    });
  }

  // 5. Update index.md
  if (existsSync(INDEX)) {
    const indexContent = readFileSync(INDEX, "utf-8");
    if (indexContent.includes(slug)) {
      actions.push({
        type: "update-index",
        file: INDEX,
        detail: `Remove ${slug} entry from index.md`,
      });
    }
  }

  return actions;
}

function executeActions(actions: Action[], slug: string, reason: ArchiveReason) {
  for (const action of actions) {
    switch (action.type) {
      case "move": {
        mkdirSync(ARCHIVE, { recursive: true });
        const dest = resolve(ARCHIVE, basename(action.file));
        renameSync(action.file, dest);
        // Add archive frontmatter
        let content = readFileSync(dest, "utf-8");
        if (content.startsWith("---")) {
          content = content.replace(/^---\n/, `---\narchived: true\narchive_reason: ${reason}\narchive_date: ${new Date().toISOString().split("T")[0]}\n`);
          writeFileSync(dest, content, "utf-8");
        }
        console.log(`  ✓ ${action.detail}`);
        break;
      }
      case "edit": {
        let content = readFileSync(action.file, "utf-8");
        // Replace both [[slug]] and [[slug|label]] forms with plain text
        const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(`\\[\\[${escaped}\\|([^\\]]+)\\]\\]`, "g"), "$1"); // [[slug|label]] → label
        content = content.replace(new RegExp(`\\[\\[${escaped}\\]\\]`, "g"), slug); // [[slug]] → slug
        writeFileSync(action.file, content, "utf-8");
        console.log(`  ✓ ${action.detail}`);
        break;
      }
      case "remove-relation": {
        const lines = readFileSync(RELATIONS, "utf-8").split("\n").filter(Boolean);
        const kept = lines.filter(l => !l.includes(`"${slug}"`));
        writeFileSync(RELATIONS, kept.join("\n") + "\n", "utf-8");
        console.log(`  ✓ ${action.detail}`);
        break;
      }
      case "update-manifest": {
        const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
        for (const [key, entry] of Object.entries(manifest.files ?? {}) as [string, any][]) {
          if (entry.source_page?.includes(slug) || key.includes(slug)) {
            entry.status = "archived";
            entry.archive_reason = reason;
            entry.archive_date = new Date().toISOString().split("T")[0];
          }
        }
        writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf-8");
        console.log(`  ✓ ${action.detail}`);
        break;
      }
      case "update-index": {
        let content = readFileSync(INDEX, "utf-8");
        // Remove lines containing the slug (bullet points in index)
        const lines = content.split("\n");
        const kept = lines.filter(l => !l.includes(`[[${slug}]]`) && !l.match(new RegExp(`^\\s*-.*${slug}`)));
        writeFileSync(INDEX, kept.join("\n"), "utf-8");
        console.log(`  ✓ ${action.detail}`);
        break;
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--list-archived")) {
  if (!existsSync(ARCHIVE)) {
    console.log("No archived pages.");
    process.exit(0);
  }
  const files = readdirSync(ARCHIVE).filter(f => f.endsWith(".md"));
  if (files.length === 0) {
    console.log("No archived pages.");
  } else {
    console.log(`# Archived Pages (${files.length})\n`);
    for (const f of files) {
      const content = readFileSync(resolve(ARCHIVE, f), "utf-8");
      const reason = content.match(/archive_reason:\s*(\S+)/)?.[1] ?? "unknown";
      const date = content.match(/archive_date:\s*(\S+)/)?.[1] ?? "unknown";
      console.log(`  ${f.replace(".md", "")} — reason: ${reason}, date: ${date}`);
    }
  }
  process.exit(0);
}

const archiveIdx = args.indexOf("--archive");
const reasonIdx = args.indexOf("--reason");
const dryRun = args.includes("--dry-run");

if (archiveIdx < 0 || !args[archiveIdx + 1]) {
  console.error("Usage: npx tsx tools/kb-delete.ts --archive <slug> --reason retracted|merged|duplicate|off-topic [--dry-run]");
  process.exit(1);
}

const slug = args[archiveIdx + 1];
const reason = (reasonIdx >= 0 ? args[reasonIdx + 1] : "off-topic") as ArchiveReason;

if (!VALID_REASONS.includes(reason)) {
  console.error(`Invalid reason: ${reason}. Must be one of: ${VALID_REASONS.join(", ")}`);
  process.exit(1);
}

const actions = collectActions(slug, reason);

console.log(`\n# Archive: ${slug} (reason: ${reason})`);
console.log(`  ${actions.length} actions to perform:\n`);

if (dryRun) {
  for (const a of actions) console.log(`  [DRY] ${a.detail}`);
  console.log("\n  --dry-run: no changes made.");
} else {
  executeActions(actions, slug, reason);
  console.log(`\n  ✓ ${slug} archived successfully. Run \`npx tsx tools/kb-lint.ts\` to verify.`);
}
