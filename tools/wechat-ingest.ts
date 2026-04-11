#!/usr/bin/env npx tsx
/**
 * WeChat 公众号 content ingestion for NORIA via we-mp-rss API.
 *
 * Requires we-mp-rss running at localhost:8001 (see tools/wechat/docker-compose.yaml).
 *
 * Modes:
 *   --poll              Fetch new articles from all subscribed accounts
 *   --search <keyword>  Search for accounts by name
 *   --subscribe <name>  Subscribe to an account (search + add first result)
 *   --list              List subscribed accounts
 *   --status            Check we-mp-rss service status
 *
 * Usage:
 *   npx tsx tools/wechat-ingest.ts --poll --since 2026-04-01
 *   npx tsx tools/wechat-ingest.ts --subscribe "机器之心"
 *   npx tsx tools/wechat-ingest.ts --list
 *   npx tsx tools/wechat-ingest.ts --status
 *   npx tsx tools/wechat-ingest.ts --poll --dry-run
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_WECHAT = resolve(PROJECT_ROOT, "raw", "wechat");
const CONFIG_PATH = resolve(PROJECT_ROOT, "tools", "research-topic-config.json");

// Load .env
const envPath = resolve(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const WE_MP_RSS_URL = process.env.WE_MP_RSS_URL ?? "http://localhost:8001";
const WE_MP_RSS_USER = process.env.WE_MP_RSS_USER ?? "admin";
const WE_MP_RSS_PASS = process.env.WE_MP_RSS_PASS ?? "noria2026";
const API_PREFIX = "/api/v1/wx";

// ── API Client ─────────────────────────────────────────────────────────
let authToken: string | null = null;

async function apiLogin(): Promise<string> {
  const res = await fetch(`${WE_MP_RSS_URL}${API_PREFIX}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(WE_MP_RSS_USER)}&password=${encodeURIComponent(WE_MP_RSS_PASS)}`,
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${res.statusText}`);
  const resp = await res.json() as any;
  // Response format: { code: 0, message: "success", data: { access_token, token_type, expires_in } }
  const data = resp.data ?? resp;
  return data.access_token ?? data.token ?? "";
}

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  if (!authToken) authToken = await apiLogin();
  const url = `${WE_MP_RSS_URL}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${authToken}`,
    ...(opts.headers as Record<string, string> ?? {}),
  };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    // Token expired, re-login
    authToken = await apiLogin();
    headers["Authorization"] = `Bearer ${authToken}`;
    const retry = await fetch(url, { ...opts, headers });
    if (!retry.ok) throw new Error(`API ${retry.status}: ${retry.statusText} (${path})`);
    const retryResp = await retry.json() as any;
    return retryResp.data !== undefined ? retryResp.data : retryResp;
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText} (${path})`);
  const resp = await res.json() as any;
  // Unwrap {code, message, data} envelope if present
  return resp.data !== undefined ? resp.data : resp;
}

// ── Quality Filter ─────────────────────────────────────────────────────
function loadTrackAKeywords(): string[] {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return config.tracks?.A?.keywords ?? [];
  } catch { return []; }
}

interface Article {
  id: string;
  title: string;
  mp_name: string;
  mp_id: string;
  link: string;
  content?: string;
  summary?: string;
  publish_time: string;
  created_at: string;
}

function assessRelevance(article: Article, keywords: string[]): { pass: boolean; score: number; reasons: string[] } {
  const text = `${article.title} ${article.summary ?? ""} ${article.content ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  // L1: Account allowlist (always pass if from subscribed account — we only subscribe relevant ones)
  score += 2;
  reasons.push("subscribed account");

  // L2: Keyword match
  const matched = keywords.filter(kw => text.includes(kw.toLowerCase()));
  if (matched.length > 0) {
    score += matched.length;
    reasons.push(`keywords: ${matched.slice(0, 3).join(", ")}`);
  }

  // L3: Link detection (arXiv, DOI, GitHub links boost relevance)
  const hasArxiv = /arxiv\.org|arXiv/i.test(text);
  const hasDoi = /doi\.org|DOI:/i.test(text);
  const hasGithub = /github\.com/i.test(text);
  if (hasArxiv) { score += 3; reasons.push("contains arXiv link"); }
  if (hasDoi) { score += 3; reasons.push("contains DOI"); }
  if (hasGithub) { score += 1; reasons.push("contains GitHub link"); }

  return { pass: score >= 3, score, reasons };
}

// ── Slug & Dedup ───────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, (m) => m.slice(0, 6)) // keep Chinese chars but truncate
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function existingSlugs(): Set<string> {
  const slugs = new Set<string>();
  if (existsSync(RAW_WECHAT)) {
    for (const f of readdirSync(RAW_WECHAT)) {
      if (f.endsWith(".md")) slugs.add(f.replace(/\.md$/, ""));
    }
  }
  return slugs;
}

// ── Markdown Output ────────────────────────────────────────────────────
function articleToMarkdown(article: Article): string {
  const today = new Date().toISOString().split("T")[0];
  const pubDate = article.publish_time?.split("T")[0] ?? today;
  const slug = `${slugify(article.mp_name)}-${pubDate}-${slugify(article.title)}`;

  const lines = [
    "---",
    `citekey: "${slug}"`,
    `title: "${article.title.replace(/"/g, '\\"')}"`,
    `author: "${article.mp_name}"`,
    `mp_id: "${article.mp_id}"`,
    `published: "${pubDate}"`,
    `link: "${article.link}"`,
    `source_type: wechat`,
    `date_synced: ${today}`,
    "---", "",
  ];

  if (article.summary?.trim()) {
    lines.push("## Summary", "", article.summary.trim(), "");
  }

  if (article.content?.trim()) {
    // Truncate content to avoid huge raw files
    const maxLen = 10000;
    const content = article.content.length > maxLen
      ? article.content.slice(0, maxLen) + "\n\n---\n*Content truncated at 10000 chars.*"
      : article.content;
    lines.push("## Content", "", content, "");
  }

  return lines.join("\n");
}

// ── Commands ───────────────────────────────────────────────────────────
async function cmdStatus() {
  try {
    // Try root page first (always available when service is up)
    const res = await fetch(`${WE_MP_RSS_URL}/`);
    if (!res.ok) throw new Error(`${res.status}`);
    console.log(`we-mp-rss status: RUNNING at ${WE_MP_RSS_URL}`);
    console.log(`  Web UI: ${WE_MP_RSS_URL}/`);
    console.log(`  Swagger: ${WE_MP_RSS_URL}/api/docs`);
    // Try to check subscriptions
    try {
      const mps = await api(`${API_PREFIX}/mps?limit=5`);
      const items = mps.items ?? mps.data ?? mps ?? [];
      console.log(`  Subscribed accounts: ${Array.isArray(items) ? items.length : "?"}`);
    } catch {
      console.log(`  Auth: not yet logged in (scan QR at web UI first)`);
    }
  } catch (e: any) {
    console.error(`we-mp-rss status: NOT REACHABLE at ${WE_MP_RSS_URL}`);
    console.error(`  Error: ${e.message}`);
    console.error(`  Start it: cd tools/wechat && docker compose up -d`);
    process.exit(1);
  }
}

async function cmdList() {
  const data = await api(`${API_PREFIX}/mps?limit=50`);
  const accounts = data.list ?? data.items ?? data ?? [];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log("No subscribed accounts. Use --subscribe <name> to add one.");
    return;
  }
  console.log(`Subscribed accounts (${accounts.length}):\n`);
  for (const a of accounts) {
    console.log(`  ${a.mp_name ?? a.nickname ?? a.name} (${a.mp_id ?? a.fakeid ?? a.id})`);
    if (a.mp_intro ?? a.signature) console.log(`    ${(a.mp_intro ?? a.signature ?? "").slice(0, 80)}`);
  }
}

async function cmdSearch(keyword: string) {
  console.log(`Searching for: "${keyword}"`);
  const data = await api(`${API_PREFIX}/mps/search/${encodeURIComponent(keyword)}`);
  const results = data.list ?? data.items ?? data ?? [];
  if (!Array.isArray(results) || results.length === 0) {
    console.log("No accounts found.");
    return;
  }
  console.log(`Found ${results.length} account(s):\n`);
  for (const a of results) {
    console.log(`  ${a.nickname ?? a.mp_name ?? a.name} (${a.alias ?? a.fakeid ?? ""})`);
    if (a.signature) console.log(`    ${a.signature.slice(0, 100)}`);
  }
}

async function cmdSubscribe(name: string) {
  console.log(`Searching for "${name}"...`);
  const data = await api(`${API_PREFIX}/mps/search/${encodeURIComponent(name)}`);
  const results = data.list ?? data.items ?? data ?? [];
  if (!Array.isArray(results) || results.length === 0) {
    console.error(`No accounts found for "${name}".`);
    process.exit(1);
  }
  const account = results[0];
  const displayName = account.nickname ?? account.mp_name ?? account.name;
  const mpId = account.fakeid ?? account.mp_id ?? account.id;
  console.log(`Subscribing to: ${displayName} (${account.alias ?? mpId})`);
  // Subscribe using the account's search result fields
  await api(`${API_PREFIX}/mps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mp_name: displayName,
      mp_id: mpId,
      mp_cover: account.round_head_img ?? "",
      avatar: account.round_head_img ?? "",
      mp_intro: account.signature ?? "",
    }),
  });
  console.log(`  Subscribed. Triggering initial scrape...`);
  try {
    await api(`${API_PREFIX}/mps/update/${mpId}?start_page=1&end_page=3`);
    console.log(`  Scraping pages 1-3. Articles will appear shortly.`);
  } catch {
    console.log(`  Initial scrape trigger failed. Articles may appear after next scheduled job.`);
  }
}

function unixToDate(ts: number | string): string {
  const n = typeof ts === "string" ? parseInt(ts, 10) : ts;
  if (!n || n < 1000000000) return "";
  return new Date(n * 1000).toISOString().split("T")[0];
}

function stripHtml(html: string): string {
  // Try defuddle first for proper Markdown conversion (headings, links, lists)
  try {
    const result = execSync("npx -y defuddle", {
      input: html, encoding: "utf-8", timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const md = result.trim();
    if (md.length > 0) return md;
  } catch { /* defuddle unavailable or failed — fall through to regex */ }

  // Fallback: naive regex stripping
  return html
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "[$1]")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchArticleContent(articleId: string): Promise<string> {
  // First try detail endpoint
  try {
    const detail = await api(`${API_PREFIX}/articles/${articleId}`);
    if (detail.content) return stripHtml(detail.content);
  } catch { /* detail might fail */ }
  // Trigger refresh and wait
  try {
    await api(`${API_PREFIX}/articles/${articleId}/refresh`, { method: "POST" });
    // Wait for content gathering
    await new Promise(r => setTimeout(r, 10000));
    const detail = await api(`${API_PREFIX}/articles/${articleId}`);
    if (detail.content) return stripHtml(detail.content);
  } catch { /* refresh might fail */ }
  return "";
}

async function cmdUrl(url: string, dryRun: boolean) {
  console.log(`Importing article from URL: ${url}\n`);

  // Use the featured article endpoint to import by URL
  const result = await api(`${API_PREFIX}/mps/featured/article`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  console.log(`  Article imported. Fetching content...`);
  // Wait for content to be gathered
  await new Promise(r => setTimeout(r, 12000));

  // Find the article in the list
  const data = await api(`${API_PREFIX}/articles?limit=20`);
  const articles = data.list ?? [];
  const match = articles.find((a: any) => (a.url ?? "").includes(url.split("s/")[1]?.slice(0, 16) ?? "NOMATCH"));

  if (!match) {
    console.log("  Could not find imported article. It may need more time to process.");
    console.log("  Try: npx tsx tools/wechat-ingest.ts --poll");
    return;
  }

  const articleId = match.id;
  const content = await fetchArticleContent(articleId);
  const pubDate = typeof match.publish_time === "number" || /^\d+$/.test(String(match.publish_time))
    ? unixToDate(match.publish_time)
    : (match.publish_time ?? "").split("T")[0];

  const article: Article = {
    ...match,
    mp_name: match.mp_name ?? "unknown",
    link: url,
    content,
    publish_time: pubDate,
  };

  console.log(`  Title: ${article.title}`);
  console.log(`  Author: ${article.mp_name}`);
  console.log(`  Content: ${content.length} chars`);

  if (content.length === 0) {
    console.log("\n  WARNING: Content not yet available. The article may need manual refresh.");
    console.log(`  Try: curl -X POST http://localhost:8001/api/v1/wx/articles/${articleId}/refresh`);
  }

  const slug = `${slugify(article.mp_name)}-${pubDate}-${slugify(article.title)}`;

  if (dryRun) {
    console.log(`\n  [dry-run] Would save: raw/wechat/${slug}.md`);
    return;
  }

  mkdirSync(RAW_WECHAT, { recursive: true });
  const md = articleToMarkdown(article);
  writeFileSync(resolve(RAW_WECHAT, `${slug}.md`), md, "utf-8");
  console.log(`\n  Saved: raw/wechat/${slug}.md`);
}

async function cmdPoll(since: string | null, dryRun: boolean) {
  const keywords = loadTrackAKeywords();
  const existing = existingSlugs();

  console.log(`Polling articles from we-mp-rss...`);
  const data = await api(`${API_PREFIX}/articles?limit=100`);
  const articles: Article[] = data.list ?? data.items ?? data ?? [];

  if (!Array.isArray(articles) || articles.length === 0) {
    console.log("No articles found. Subscribe to accounts first, then wait for scrape.");
    return;
  }

  console.log(`Found ${articles.length} article(s). Filtering...\n`);

  let saved = 0, skipped = 0, filtered = 0;

  for (const article of articles) {
    // Normalize publish_time (may be unix timestamp)
    const pubDate = typeof article.publish_time === "number" || /^\d+$/.test(String(article.publish_time))
      ? unixToDate(article.publish_time)
      : (article.publish_time ?? "").split("T")[0];

    // Date filter
    if (since && pubDate && pubDate < since) {
      skipped++;
      continue;
    }

    // Use url field as link if link is missing
    const link = article.link ?? (article as any).url ?? "";
    const mpName = article.mp_name ?? "unknown";

    const slug = `${slugify(mpName)}-${pubDate}-${slugify(article.title)}`;
    if (existing.has(slug)) {
      skipped++;
      continue;
    }

    // Relevance filter
    const enrichedArticle = { ...article, link, mp_name: mpName, publish_time: pubDate };
    const rel = assessRelevance(enrichedArticle, keywords);
    if (!rel.pass) {
      console.log(`  SKIP (score=${rel.score}): ${article.title.slice(0, 60)}`);
      filtered++;
      continue;
    }

    console.log(`  + ${slug}`);
    console.log(`    Score: ${rel.score} | ${rel.reasons.join(", ")}`);

    if (!dryRun) {
      // Fetch full content for passing articles
      const articleId = article.id ?? (article as any).article_id;
      if (articleId && !enrichedArticle.content) {
        console.log(`    Fetching content...`);
        enrichedArticle.content = await fetchArticleContent(articleId);
        console.log(`    Content: ${enrichedArticle.content?.length ?? 0} chars`);
      }
      mkdirSync(RAW_WECHAT, { recursive: true });
      const md = articleToMarkdown(enrichedArticle);
      writeFileSync(resolve(RAW_WECHAT, `${slug}.md`), md, "utf-8");
      saved++;
    }
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}Result: ${saved} saved, ${skipped} skipped (dup/old), ${filtered} filtered (low relevance)`);
}

// ── CLI ────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  let mode = "";
  let target = "";
  let since: string | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--poll") mode = "poll";
    else if (a === "--url" && argv[i + 1]) { mode = "url"; target = argv[++i]; }
    else if (a === "--search" && argv[i + 1]) { mode = "search"; target = argv[++i]; }
    else if (a === "--subscribe" && argv[i + 1]) { mode = "subscribe"; target = argv[++i]; }
    else if (a === "--list") mode = "list";
    else if (a === "--status") mode = "status";
    else if (a === "--since" && argv[i + 1]) since = argv[++i];
    else if (a === "--dry-run") dryRun = true;
  }

  if (!mode) {
    console.error(`Usage:
  npx tsx tools/wechat-ingest.ts --status                  Check we-mp-rss status
  npx tsx tools/wechat-ingest.ts --list                    List subscribed accounts
  npx tsx tools/wechat-ingest.ts --search <keyword>        Search for accounts
  npx tsx tools/wechat-ingest.ts --subscribe <name>        Subscribe to an account
  npx tsx tools/wechat-ingest.ts --poll [--since DATE]     Fetch new articles
  npx tsx tools/wechat-ingest.ts --poll --dry-run          Preview without saving
  npx tsx tools/wechat-ingest.ts --url <mp.weixin URL>     Import a specific article by URL

Environment:
  WE_MP_RSS_URL   API base URL (default: http://localhost:8001)
  WE_MP_RSS_USER  Login username (default: admin)
  WE_MP_RSS_PASS  Login password

Setup:
  cd tools/wechat && docker compose up -d
  Then open http://localhost:8001/ to scan QR code for WeChat Reading login.`);
    process.exit(1);
  }

  switch (mode) {
    case "status": await cmdStatus(); break;
    case "list": await cmdList(); break;
    case "search": await cmdSearch(target); break;
    case "subscribe": await cmdSubscribe(target); break;
    case "poll": await cmdPoll(since, dryRun); break;
    case "url": await cmdUrl(target, dryRun); break;
  }
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
