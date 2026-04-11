#!/usr/bin/env npx tsx
/**
 * tools/qmd-reindex.ts
 *
 * Rebuilds the QMD search index for the wiki/ collection.
 * Called after /kb-compile to keep the search index in sync.
 *
 * Usage:
 *   npx tsx tools/qmd-reindex.ts            # re-index + embed
 *   npx tsx tools/qmd-reindex.ts --no-embed  # re-index only (fast, BM25 only)
 *   npx tsx tools/qmd-reindex.ts --status    # show index health
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const opts: ExecSyncOptionsWithStringEncoding = {
  cwd: ROOT,
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "pipe"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string): string {
  try {
    return execSync(cmd, opts).trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString().trim() ?? "";
    const stdout = err.stdout?.toString().trim() ?? "";
    throw new Error(`Command failed: ${cmd}\n${stderr}\n${stdout}`);
  }
}

function parseIndexedCount(updateOutput: string): number {
  // QMD update outputs lines like: "Indexed: 5 new, 2 updated, 93 unchanged, 0 removed"
  const match = updateOutput.match(
    /Indexed:\s*(\d+)\s*new,\s*(\d+)\s*updated,\s*(\d+)\s*unchanged/
  );
  if (match) {
    return parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3]);
  }
  // Fallback: count from `qmd ls`
  const ls = run("qmd ls wiki --files 2>/dev/null || true");
  return ls.split("\n").filter((l) => l.trim().length > 0).length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipEmbed = args.includes("--no-embed");
  const statusOnly = args.includes("--status");

  // Ensure the wiki collection exists
  const collections = run("qmd collection list 2>&1");
  if (!collections.includes("wiki")) {
    console.log("Creating QMD collection 'wiki'...");
    const addResult = run(
      `qmd collection add wiki --name wiki --glob "**/*.md" 2>&1`
    );
    console.log(addResult);
  }

  if (statusOnly) {
    console.log(run("qmd status 2>&1"));
    return;
  }

  // Re-index: picks up new/changed/deleted files
  console.log("Updating QMD index for wiki/ ...");
  const updateResult = run("qmd update 2>&1");
  const totalPages = parseIndexedCount(updateResult);

  console.log(updateResult);
  console.log(`\nTotal wiki pages indexed: ${totalPages}`);

  // Embeddings
  if (!skipEmbed) {
    console.log("\nGenerating embeddings (this may take a while on CPU)...");
    try {
      const embedResult = run("qmd embed 2>&1");
      console.log(embedResult);
    } catch (err: any) {
      console.warn(
        "Warning: embedding generation failed (model download or GPU issue)."
      );
      console.warn("BM25 keyword search still works. Vector search unavailable.");
      console.warn(err.message?.split("\n").slice(0, 3).join("\n"));
    }
  } else {
    console.log("Skipping embeddings (--no-embed). BM25 search available.");
  }

  // Quick sanity check
  console.log("\n--- Sanity check ---");
  const testResult = run('qmd search "agent" -n 1 --json 2>&1');
  try {
    const parsed = JSON.parse(testResult);
    if (parsed.length > 0) {
      const file = parsed[0].file ?? parsed[0].path ?? "(unknown)";
      console.log(`Search OK: found "${file}"`);
    } else {
      console.warn("Warning: test search returned no results.");
    }
  } catch {
    // Non-JSON output — just show it
    console.log(testResult.split("\n")[0]);
  }

  console.log("\nDone. Run 'qmd search <query>' or 'qmd query <query>' to search.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
