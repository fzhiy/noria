#!/usr/bin/env npx tsx
/**
 * Stale compilation checker — detects raw files modified after compilation.
 *
 * Computes SHA256 of raw files and compares with source_hash stored in manifest.
 * Reports files that need recompilation.
 *
 * Usage:
 *   npx tsx tools/kb-stale-check.ts              # Show stale files
 *   npx tsx tools/kb-stale-check.ts --update      # Update hashes for all compiled files (backfill)
 *   npx tsx tools/kb-stale-check.ts --json         # Machine-readable output
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = resolve(ROOT, ".kb", "manifest.json");

function sha256(filePath: string): string {
  const content = readFileSync(filePath);
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

function main() {
  if (!existsSync(MANIFEST)) {
    console.error("No manifest.json found. Run /kb-compile first.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
  const files: Record<string, any> = manifest.files ?? {};
  const argv = process.argv.slice(2);
  const updateMode = argv.includes("--update");
  const jsonMode = argv.includes("--json");

  const stale: { raw_file: string; status: string; reason: string }[] = [];
  const missing: string[] = [];
  let updated = 0;

  for (const [rawPath, entry] of Object.entries(files)) {
    if (entry.status === "archived") continue;
    if (entry.status !== "compiled") continue;

    const fullPath = resolve(ROOT, rawPath);
    if (!existsSync(fullPath)) {
      missing.push(rawPath);
      continue;
    }

    const currentHash = sha256(fullPath);

    if (updateMode) {
      if (entry.source_hash !== currentHash) {
        entry.source_hash = currentHash;
        updated++;
      }
    } else {
      if (!entry.source_hash) {
        stale.push({ raw_file: rawPath, status: "no-hash", reason: "No source_hash recorded (pre-hashing)" });
      } else if (entry.source_hash !== currentHash) {
        stale.push({ raw_file: rawPath, status: "modified", reason: `Hash mismatch: file modified since compilation on ${entry.compiled_at}` });
      }
    }
  }

  if (updateMode) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`Updated ${updated} source hashes in manifest.json`);
    console.log(`Total compiled entries: ${Object.values(files).filter((e: any) => e.status === "compiled").length}`);
    if (missing.length > 0) console.log(`Missing raw files: ${missing.length} (skipped)`);
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify({ stale, missing }, null, 2));
    return;
  }

  if (stale.length === 0 && missing.length === 0) {
    console.log("All compiled files are up-to-date (no stale entries).");
    return;
  }

  if (stale.length > 0) {
    console.log(`# Stale Compilations (${stale.length})\n`);
    for (const s of stale) {
      const icon = s.status === "modified" ? "⚠" : "ℹ";
      console.log(`${icon} ${s.raw_file}`);
      console.log(`  ${s.reason}`);
      console.log(`  Action: recompile with /kb-compile\n`);
    }
  }

  if (missing.length > 0) {
    console.log(`# Missing Raw Files (${missing.length})\n`);
    for (const m of missing) {
      console.log(`  ✗ ${m}`);
    }
  }
}

main();
