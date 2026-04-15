#!/usr/bin/env npx tsx
/**
 * noria-queue — Inbox approval queue for NORIA knowledge base
 *
 * Pure file operations, zero LLM calls.
 * Audit trail = git history (each action is a separate commit).
 *
 * Usage:
 *   npx tsx tools/noria-queue.ts list [--type source|concept|synthesis] [--json]
 *   npx tsx tools/noria-queue.ts approve <slug> [--skip-lint]
 *   npx tsx tools/noria-queue.ts reject <slug> --reason "off-topic"
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, writeFileSync, copyFileSync, statSync } from "fs";
import { join, relative, resolve, dirname } from "path";
import { execFileSync } from "child_process";

// ── Repo root detection (find .git, not cwd-dependent) ──────────────

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  while (dir !== "/") {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, "CLAUDE.md"))) return dir;
    dir = dirname(dir);
  }
  // Fallback to cwd
  return process.cwd();
}

const WIKI_ROOT = findRepoRoot(process.argv[1] ? dirname(resolve(process.argv[1])) : process.cwd());
const INBOX_DIR = join(WIKI_ROOT, "inbox");
const WIKI_DIR = join(WIKI_ROOT, "wiki");
const PAGE_TYPES = ["sources", "concepts", "synthesis"] as const;

// ── Slug validation (prevent path traversal + shell injection) ──────

const VALID_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

function validateSlug(slug: string): void {
  if (!slug || !VALID_SLUG.test(slug)) {
    console.error(`Invalid slug: "${slug}". Must match ${VALID_SLUG}`);
    process.exit(1);
  }
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    console.error(`Slug contains path traversal characters: "${slug}"`);
    process.exit(1);
  }
}

// ── Frontmatter — line-level manipulation (no full YAML parse) ──────
// We NEVER parse+reserialize the entire frontmatter. Instead we read
// the raw file content and surgically edit specific lines. This avoids
// corrupting complex YAML structures like juggl-links, claims arrays, etc.

function getFrontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

function setFrontmatterField(content: string, field: string, value: string): string {
  const regex = new RegExp(`^(${field}:\\s*)(.*)$`, "m");
  if (regex.test(content)) {
    return content.replace(regex, `$1${value}`);
  }
  // Insert before the closing ---
  return content.replace(/\n---\n/, `\n${field}: ${value}\n---\n`);
}

function getFrontmatterValue(content: string, field: string): string {
  return (getFrontmatterField(content, field) || "").replace(/^["']|["']$/g, "");
}

// ── Inbox scanning ──────────────────────────────────────────────────

interface InboxItem {
  slug: string;
  type: string;
  path: string;
  title: string;
  provenance: string;
  tags: string;
  mtime: Date;
  content: string;
}

function scanInbox(typeFilter?: string): InboxItem[] {
  const items: InboxItem[] = [];

  for (const pageType of PAGE_TYPES) {
    if (typeFilter && pageType !== typeFilter && pageType.replace(/s$/, "") !== typeFilter) continue;
    const dir = join(INBOX_DIR, pageType);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") || file.startsWith(".")) continue;
      const filePath = join(dir, file);
      const content = readFileSync(filePath, "utf-8");
      const slug = file.replace(/\.md$/, "");
      const stat = statSync(filePath);

      items.push({
        slug,
        type: pageType,
        path: filePath,
        title: getFrontmatterValue(content, "title") || slug,
        provenance: getFrontmatterValue(content, "provenance") || "unknown",
        tags: getFrontmatterValue(content, "tags"),
        mtime: stat.mtime,
        content,
      });
    }
  }

  return items.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// ── Git helpers (safe — no shell interpolation) ─────────────────────

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: WIKI_ROOT, stdio: "pipe" }).toString().trim();
  } catch (e: any) {
    const msg = e.stderr?.toString?.() || e.message || "git error";
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

function gitAdd(file: string): void {
  git("add", relative(WIKI_ROOT, file));
}

function gitRm(file: string): void {
  try {
    git("rm", "-f", relative(WIKI_ROOT, file));
  } catch {
    // File might not be tracked — delete manually
    if (existsSync(file)) unlinkSync(file);
  }
}

function gitCommit(message: string): void {
  git("commit", "-m", message);
}

// ── Validation ──────────────────────────────────────────────────────

interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function validateForPromotion(content: string, slug: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const status = getFrontmatterValue(content, "verification_status");
  const validStatuses = ["unreviewed", "reviewed", "verified", "disputed", ""];
  if (status && !validStatuses.includes(status)) {
    errors.push(`Unknown verification_status: "${status}"`);
  }

  // Fail-closed: claims field is REQUIRED for promotion
  const hasClaims = /^claims:\s*$/m.test(content) || /^claims:\s*\[/m.test(content);
  const hasClaimItems = /^\s+-\s+text:/m.test(content);
  if (!hasClaims || !hasClaimItems) {
    errors.push(`Missing or empty 'claims' field. Source pages must have at least one claim with text + citekey.`);
  } else {
    // Verify each claim has citekey
    const claimTexts = content.match(/^\s+-\s+text:\s*.+$/gm) || [];
    const claimCitekeys = content.match(/^\s+citekey:\s*.+$/gm) || [];
    if (claimCitekeys.length < claimTexts.length) {
      errors.push(`${claimTexts.length} claim(s) found but only ${claimCitekeys.length} have citekey. Every claim needs a citekey.`);
    }
  }

  const provenance = getFrontmatterValue(content, "provenance");
  if (!provenance) warnings.push("Missing provenance field");

  const type = getFrontmatterValue(content, "type");
  if (!type) warnings.push("Missing type field");

  const title = getFrontmatterValue(content, "title");
  if (!title) warnings.push("Missing title field");

  return { ok: errors.length === 0, errors, warnings };
}

// ── Commands ────────────────────────────────────────────────────────

function cmdList(typeFilter?: string, json = false) {
  const items = scanInbox(typeFilter);

  if (items.length === 0) {
    if (json) { console.log(JSON.stringify({ count: 0, items: [] })); return; }
    console.log("Inbox is empty. Nothing to review.");
    return;
  }

  if (json) {
    console.log(JSON.stringify({
      count: items.length,
      items: items.map(i => ({
        slug: i.slug, type: i.type, title: i.title,
        provenance: i.provenance,
        age_hours: Math.round((Date.now() - i.mtime.getTime()) / 3600000),
      })),
    }, null, 2));
    return;
  }

  const typeCounts = new Map<string, number>();
  for (const item of items) typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
  const summary = [...typeCounts.entries()].map(([t, c]) => `${c} ${t}`).join(", ");

  console.log(`\nNORIA Inbox — ${items.length} pending (${summary})`);
  console.log("━".repeat(60));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const age = Math.round((Date.now() - item.mtime.getTime()) / 3600000);
    const ageStr = age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;

    console.log(`[${i + 1}] ${item.slug}  (${item.type.replace(/s$/, "")}, ${item.provenance}, ${ageStr})`);
    console.log(`    "${item.title}"`);
    if (item.tags) console.log(`    tags: ${item.tags}`);
    console.log();
  }

  console.log(`Commands:`);
  console.log(`  npx tsx tools/noria-queue.ts approve <slug>`);
  console.log(`  npx tsx tools/noria-queue.ts reject <slug> --reason "..."`);
}

function cmdApprove(slug: string, skipLint = false) {
  validateSlug(slug);

  const items = scanInbox();
  const item = items.find(i => i.slug === slug);
  if (!item) {
    console.error(`Error: "${slug}" not found in inbox/`);
    console.error(`Available: ${items.map(i => i.slug).join(", ") || "(empty)"}`);
    process.exit(1);
  }

  // Validate BEFORE modifying anything
  const validation = validateForPromotion(item.content, slug);
  if (!validation.ok) {
    console.error(`Validation failed for "${slug}":`);
    for (const e of validation.errors) console.error(`  ERROR: ${e}`);
    process.exit(1);
  }
  for (const w of validation.warnings) console.warn(`  WARNING: ${w}`);

  // Target path
  const targetDir = join(WIKI_DIR, item.type);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${slug}.md`);

  if (existsSync(targetPath)) {
    console.error(`Error: "${slug}" already exists in wiki/${item.type}/`);
    process.exit(1);
  }

  // Set verification_status to reviewed (line-level edit, preserves all other YAML)
  let content = item.content;
  content = setFrontmatterField(content, "verification_status", "reviewed");

  // Write to wiki (copy content, don't parse/reserialize)
  writeFileSync(targetPath, content, "utf-8");

  // Remove from inbox
  gitRm(item.path);

  // Stage new file + commit
  gitAdd(targetPath);
  gitCommit(`[noria-approve] ${slug}`);

  // Run lint (best-effort, non-blocking)
  if (!skipLint) {
    try {
      const result = execFileSync("npx", ["tsx", "tools/kb-lint.ts"], {
        cwd: WIKI_ROOT, timeout: 30000, stdio: "pipe",
      }).toString();
      const fails = result.match(/FAIL/g);
      if (fails && fails.length > 0) {
        console.warn(`\nLint: ${fails.length} issue(s) detected. Run npx tsx tools/kb-lint.ts for details.`);
      }
    } catch { /* lint failure is non-blocking */ }
  }

  // Graph recompute (best-effort)
  try {
    execFileSync("npx", ["tsx", "tools/kb-relations.ts", "--scan"], {
      cwd: WIKI_ROOT, timeout: 60000, stdio: "pipe",
    });
    execFileSync("npx", ["tsx", "tools/kb-relations.ts", "--features"], {
      cwd: WIKI_ROOT, timeout: 60000, stdio: "pipe",
    });
  } catch { /* graph recompute is non-critical */ }

  console.log(`Approved: ${slug} → wiki/${item.type}/${slug}.md`);
}

function cmdReject(slug: string, reason: string) {
  validateSlug(slug);

  if (!reason || reason.trim().length === 0) {
    console.error("Error: --reason is required for rejection");
    process.exit(1);
  }

  // Sanitize reason for git commit message (no shell metacharacters)
  const safeReason = reason.replace(/[`$"\\]/g, "").slice(0, 200);

  const items = scanInbox();
  const item = items.find(i => i.slug === slug);
  if (!item) {
    console.error(`Error: "${slug}" not found in inbox/`);
    process.exit(1);
  }

  // Remove from inbox
  gitRm(item.path);

  // Commit with reason
  gitCommit(`[noria-reject] ${slug} -- ${safeReason}`);

  console.log(`Rejected: ${slug} (reason: ${safeReason})`);
}

// ── CLI ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log(`
noria-queue — Inbox approval queue for NORIA

Commands:
  list [--type source|concept|synthesis] [--json]
  approve <slug> [--skip-lint]
  reject <slug> --reason "reason"

Examples:
  npx tsx tools/noria-queue.ts list
  npx tsx tools/noria-queue.ts approve bai2024-digirl
  npx tsx tools/noria-queue.ts reject off-topic --reason "not related to web agents"
`);
  process.exit(0);
}

switch (command) {
  case "list": {
    const typeIdx = args.indexOf("--type");
    const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : undefined;
    cmdList(typeFilter, args.includes("--json"));
    break;
  }
  case "approve": {
    const slug = args[1];
    if (!slug) { console.error("Usage: noria-queue approve <slug>"); process.exit(1); }
    cmdApprove(slug, args.includes("--skip-lint"));
    break;
  }
  case "reject": {
    const slug = args[1];
    const reasonIdx = args.indexOf("--reason");
    const reason = reasonIdx >= 0 ? args.slice(reasonIdx + 1).join(" ") : "";
    if (!slug) { console.error("Usage: noria-queue reject <slug> --reason \"...\""); process.exit(1); }
    cmdReject(slug, reason);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
