#!/usr/bin/env npx tsx
/**
 * GitHub -> raw/github/ search & import tool.
 *
 * Searches official paper repos, benchmark implementations, and tagged releases
 * via GitHub REST API. Outputs to raw/github/ with social-lead provenance tier.
 *
 * Design: narrow allowlist, NOT broad search. Only imports:
 *   - Official repos linked from known papers (--repo URL)
 *   - Repos matching strict keyword search with star/activity filters (--search)
 *   - Release notes for tracked repos (--releases)
 *
 * Auth: No token required for public reads (60 req/hr unauthenticated).
 *       Set GITHUB_TOKEN env var for 5000 req/hr if needed.
 *
 * Usage:
 *   npx tsx tools/github-search.ts --repo anthropics/claude-code
 *   npx tsx tools/github-search.ts --search "web agent benchmark" --min-stars 50 --limit 5
 *   npx tsx tools/github-search.ts --releases anthropics/claude-code --limit 3
 *   npx tsx tools/github-search.ts --repo anthropics/claude-code --dry-run
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_GH = resolve(PROJECT_ROOT, "raw", "github");

// Load .env
const envPath = resolve(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const GH_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GH_API = "https://api.github.com";

// ── CLI ────────────────────────────────────────────────────────────────
interface CliArgs {
  mode: "repo" | "search" | "releases";
  target: string;        // owner/repo or search query
  limit: number;
  minStars: number;
  language: string | null;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = {
    mode: "repo",
    target: "",
    limit: 5,
    minStars: 10,
    language: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) { args.mode = "repo"; args.target = argv[++i]; }
    else if (a === "--search" && argv[i + 1]) { args.mode = "search"; args.target = argv[++i]; }
    else if (a === "--releases" && argv[i + 1]) { args.mode = "releases"; args.target = argv[++i]; }
    else if (a === "--limit" && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (a === "--min-stars" && argv[i + 1]) args.minStars = parseInt(argv[++i], 10);
    else if (a === "--language" && argv[i + 1]) args.language = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
  }

  if (!args.target) {
    console.error(`Usage:
  npx tsx tools/github-search.ts --repo OWNER/REPO          Fetch repo README + metadata
  npx tsx tools/github-search.ts --search "query" [opts]    Search repos (narrow, filtered)
  npx tsx tools/github-search.ts --releases OWNER/REPO      Fetch recent releases

Options:
  --limit N          Max results (default: 5)
  --min-stars N      Minimum stars for search (default: 10)
  --language LANG    Filter by language
  --dry-run          Show what would be saved without writing`);
    process.exit(1);
  }
  return args;
}

// ── GitHub API ─────────────────────────────────────────────────────────
async function ghFetch(path: string): Promise<any> {
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "NORIA-GitHub-Search/1.0",
  };
  if (GH_TOKEN) headers["Authorization"] = `Bearer ${GH_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = res.headers.get("x-ratelimit-reset");
      const resetDate = reset ? new Date(parseInt(reset, 10) * 1000).toLocaleTimeString() : "unknown";
      throw new Error(`Rate limited. Resets at ${resetDate}. Set GITHUB_TOKEN for 5000 req/hr.`);
    }
    throw new Error(`GitHub API ${res.status}: ${res.statusText} (${url})`);
  }
  return res.json();
}

// ── Dedup ──────────────────────────────────────────────────────────────
function existingRepoSlugs(): Set<string> {
  const slugs = new Set<string>();
  if (existsSync(RAW_GH)) {
    for (const f of readdirSync(RAW_GH)) {
      if (f.endsWith(".md")) slugs.add(f.replace(/\.md$/, ""));
    }
  }
  return slugs;
}

function repoSlug(owner: string, name: string): string {
  return `${owner}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

// ── Markdown output ────────────────────────────────────────────────────
interface RepoData {
  full_name: string;
  owner: { login: string };
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { spdx_id: string } | null;
  topics: string[];
  created_at: string;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
}

function repoToMarkdown(repo: RepoData, readme: string): string {
  const today = new Date().toISOString().split("T")[0];
  const slug = repoSlug(repo.owner.login, repo.name);
  const lines = [
    "---",
    `citekey: "${slug}"`,
    `title: "${(repo.full_name).replace(/"/g, '\\"')}"`,
    `description: "${(repo.description ?? "").replace(/"/g, '\\"')}"`,
    `github_url: "${repo.html_url}"`,
    `stars: ${repo.stargazers_count}`,
    `forks: ${repo.forks_count}`,
  ];
  if (repo.language) lines.push(`language: "${repo.language}"`);
  if (repo.license?.spdx_id) lines.push(`license: "${repo.license.spdx_id}"`);
  if (repo.topics.length) lines.push(`topics: [${repo.topics.join(", ")}]`);
  lines.push(`created: "${repo.created_at.split("T")[0]}"`);
  lines.push(`last_pushed: "${repo.pushed_at.split("T")[0]}"`);
  lines.push(`source_type: github`);
  lines.push(`content_type: repo-readme`);
  lines.push(`date_synced: ${today}`);
  lines.push("---", "");

  if (repo.description) {
    lines.push("## Description", "", repo.description, "");
  }

  // Truncate README to avoid excessive raw/ file sizes
  const maxReadmeLen = 8000;
  const trimmedReadme = readme.length > maxReadmeLen
    ? readme.slice(0, maxReadmeLen) + "\n\n---\n*README truncated at 8000 chars. See full version at " + repo.html_url + "*"
    : readme;

  if (trimmedReadme.trim()) {
    lines.push("## README", "", trimmedReadme, "");
  }

  return lines.join("\n");
}

function releaseToMarkdown(repo: string, release: any): string {
  const today = new Date().toISOString().split("T")[0];
  const tag = (release.tag_name ?? "unknown").replace(/[^a-z0-9.-]/gi, "-");
  const slug = `${repo.replace("/", "-").toLowerCase()}-release-${tag}`;
  const lines = [
    "---",
    `citekey: "${slug}"`,
    `title: "${repo} ${release.tag_name}: ${(release.name ?? "").replace(/"/g, '\\"')}"`,
    `github_url: "${release.html_url}"`,
    `tag: "${release.tag_name}"`,
    `published: "${(release.published_at ?? "").split("T")[0]}"`,
    `source_type: github`,
    `content_type: release-notes`,
    `date_synced: ${today}`,
    "---", "",
  ];

  if (release.body?.trim()) {
    // Truncate release notes similarly
    const maxLen = 6000;
    const body = release.body.length > maxLen
      ? release.body.slice(0, maxLen) + "\n\n---\n*Release notes truncated.*"
      : release.body;
    lines.push("## Release Notes", "", body, "");
  }

  return lines.join("\n");
}

// ── Commands ───────────────────────────────────────────────────────────
async function cmdRepo(args: CliArgs) {
  const target = args.target.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  console.log(`Fetching repo: ${target}`);

  const repo: RepoData = await ghFetch(`/repos/${target}`);
  console.log(`  ${repo.full_name} | ${repo.stargazers_count} stars | ${repo.language ?? "?"} | ${repo.license?.spdx_id ?? "no license"}`);
  console.log(`  ${repo.description ?? "(no description)"}`);

  // Fetch README
  let readme = "";
  try {
    const readmeData = await ghFetch(`/repos/${target}/readme`);
    if (readmeData.content) {
      readme = Buffer.from(readmeData.content, "base64").toString("utf-8");
    }
  } catch {
    console.log("  (no README found)");
  }

  const slug = repoSlug(repo.owner.login, repo.name);
  const existing = existingRepoSlugs();
  if (existing.has(slug)) {
    console.log(`  SKIP: ${slug}.md already exists in raw/github/`);
    return;
  }

  const md = repoToMarkdown(repo, readme);

  if (args.dryRun) {
    console.log(`  [dry-run] Would save: raw/github/${slug}.md (${md.length} chars)`);
    return;
  }

  mkdirSync(RAW_GH, { recursive: true });
  const outPath = resolve(RAW_GH, `${slug}.md`);
  writeFileSync(outPath, md, "utf-8");
  console.log(`  Saved: raw/github/${slug}.md`);
}

async function cmdSearch(args: CliArgs) {
  const q = encodeURIComponent(`${args.target} stars:>=${args.minStars}${args.language ? ` language:${args.language}` : ""}`);
  const url = `/search/repositories?q=${q}&sort=stars&order=desc&per_page=${args.limit}`;
  console.log(`Searching: "${args.target}" (min ${args.minStars} stars, limit ${args.limit})`);

  const data = await ghFetch(url);
  const items: RepoData[] = data.items ?? [];
  console.log(`Found ${data.total_count} results, showing top ${items.length}:\n`);

  const existing = existingRepoSlugs();
  let saved = 0;

  for (let i = 0; i < items.length; i++) {
    const repo = items[i];
    const slug = repoSlug(repo.owner.login, repo.name);
    const dup = existing.has(slug);
    const mark = dup ? " [DUP]" : "";
    console.log(`  ${i + 1}. ${repo.full_name} | ${repo.stargazers_count} stars | ${repo.language ?? "?"}${mark}`);
    console.log(`     ${repo.description ?? "(no description)"}`);

    if (dup) continue;

    // Fetch README
    let readme = "";
    try {
      readme = Buffer.from((await ghFetch(`/repos/${repo.full_name}/readme`)).content, "base64").toString("utf-8");
    } catch { /* no readme */ }

    const md = repoToMarkdown(repo, readme);

    if (args.dryRun) {
      console.log(`     [dry-run] Would save: raw/github/${slug}.md`);
    } else {
      mkdirSync(RAW_GH, { recursive: true });
      writeFileSync(resolve(RAW_GH, `${slug}.md`), md, "utf-8");
      console.log(`     Saved: raw/github/${slug}.md`);
      saved++;
    }

    // Rate limit: be conservative with unauthenticated requests
    if (!GH_TOKEN && i < items.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\n${args.dryRun ? "[dry-run] " : ""}${saved} new repos saved to raw/github/`);
}

async function cmdReleases(args: CliArgs) {
  const target = args.target.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  console.log(`Fetching releases: ${target} (limit ${args.limit})`);

  const releases = await ghFetch(`/repos/${target}/releases?per_page=${args.limit}`);
  if (!releases.length) {
    console.log("  No releases found.");
    return;
  }

  const existing = existingRepoSlugs();
  let saved = 0;

  for (const rel of releases) {
    const tag = (rel.tag_name ?? "unknown").replace(/[^a-z0-9.-]/gi, "-");
    const slug = `${target.replace("/", "-").toLowerCase()}-release-${tag}`;
    const dup = existing.has(slug);
    console.log(`  ${rel.tag_name} (${(rel.published_at ?? "").split("T")[0]})${dup ? " [DUP]" : ""}`);
    if (dup) continue;

    const md = releaseToMarkdown(target, rel);

    if (args.dryRun) {
      console.log(`    [dry-run] Would save: raw/github/${slug}.md`);
    } else {
      mkdirSync(RAW_GH, { recursive: true });
      writeFileSync(resolve(RAW_GH, `${slug}.md`), md, "utf-8");
      console.log(`    Saved: raw/github/${slug}.md`);
      saved++;
    }
  }

  console.log(`\n${args.dryRun ? "[dry-run] " : ""}${saved} release notes saved to raw/github/`);
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  const remaining = GH_TOKEN ? "5000" : "60";
  console.log(`GitHub API: ${GH_TOKEN ? "authenticated" : "unauthenticated"} (${remaining} req/hr)\n`);

  switch (args.mode) {
    case "repo": await cmdRepo(args); break;
    case "search": await cmdSearch(args); break;
    case "releases": await cmdReleases(args); break;
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
