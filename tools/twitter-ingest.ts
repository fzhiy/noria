#!/usr/bin/env npx tsx
/**
 * Twitter/X content ingestion for NORIA.
 *
 * Three modes:
 *   1. URL: parse individual tweet via xcancel.com (no account needed)
 *   2. Search: keyword search via Scweet (needs dedicated account)
 *   3. Profile: recent tweets from curated accounts via Scweet
 *
 * All modes apply 3-layer quality filtering before writing to raw/twitter/.
 *
 * Usage:
 *   npx tsx tools/twitter-ingest.ts "https://x.com/karpathy/status/123"
 *   npx tsx tools/twitter-ingest.ts --search "your research topic" --since 2026-03-01
 *   npx tsx tools/twitter-ingest.ts --profile karpathy --limit 10
 *   npx tsx tools/twitter-ingest.ts --curated --since 2026-04-01
 *   npx tsx tools/twitter-ingest.ts --status
 *   npx tsx tools/twitter-ingest.ts --setup-cookies path/to/cookies.txt
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_TWITTER = resolve(PROJECT_ROOT, "raw", "twitter");
const CONFIG_PATH = resolve(PROJECT_ROOT, "tools", "twitter-curated-accounts.json");
const BRIDGE = resolve(PROJECT_ROOT, "tools", "twitter-scweet-bridge.py");

// ── Types ─────────────────────────────────────────────────────────────
interface Config {
  accounts: { handle: string; name: string; reason: string; priority: string }[];
  keywords: string[];
  quality_filters: {
    must_have_one_of: string[];
    min_likes: number;
    exclude_patterns: string[];
    prefer_threads: boolean;
  };
  nitter_instances: string[];
  scweet: Record<string, any>;
}

interface RawTweet {
  id?: string;
  text?: string;
  full_text?: string;
  content?: string;
  username?: string;
  screen_name?: string;
  user?: string;
  created_at?: string;
  likes?: number;
  favorite_count?: number;
  retweets?: number;
  retweet_count?: number;
  replies?: number;
  reply_count?: number;
  url?: string;
  tweet_url?: string;
  views?: string;
  [key: string]: any;
}

// ── Config ────────────────────────────────────────────────────────────
function loadConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

// ── Quality filtering (3-layer) ───────────────────────────────────────
function qualityFilter(tweet: RawTweet, config: Config): { pass: boolean; quality: string; reasons: string[] } {
  const text = String(tweet.text || tweet.full_text || tweet.content || "");
  const handle = extractHandle(tweet);
  const likes = Number(tweet.likes ?? tweet.favorite_count ?? 0) || 0;
  const reasons: string[] = [];

  // Layer 1: Source authority
  const isCurated = config.accounts.some(a => a.handle.toLowerCase() === handle.toLowerCase());
  if (isCurated) reasons.push("curated_account");

  // Layer 2: Content signals
  const hasLink = config.quality_filters.must_have_one_of.some(p => text.toLowerCase().includes(p.toLowerCase()));
  if (hasLink) reasons.push("has_research_link");

  const hasKeyword = config.keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
  if (hasKeyword) reasons.push("has_keyword");

  // Layer 3: Engagement quality
  const meetsLikes = typeof likes === "number" && likes >= config.quality_filters.min_likes;
  if (meetsLikes) reasons.push("meets_engagement");

  // Exclude patterns
  const excluded = config.quality_filters.exclude_patterns.some(p => text.toLowerCase().includes(p.toLowerCase()));
  if (excluded) return { pass: false, quality: "excluded", reasons: ["matched_exclude_pattern"] };

  // Scoring
  if (reasons.length >= 3) return { pass: true, quality: "verified", reasons };
  if (reasons.length >= 2) return { pass: true, quality: "candidate", reasons };
  if (isCurated || hasLink) return { pass: true, quality: "candidate", reasons };
  return { pass: false, quality: "filtered", reasons };
}

// ── Deduplication ─────────────────────────────────────────────────────
function getExistingTweetIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(RAW_TWITTER)) return ids;
  for (const f of readdirSync(RAW_TWITTER)) {
    if (!f.endsWith(".md")) continue;
    const content = readFileSync(resolve(RAW_TWITTER, f), "utf-8");
    const m = content.match(/tweet_id:\s*"?(\d+)"?/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// ── Markdown generation ───────────────────────────────────────────────
function extractHandle(tweet: RawTweet): string {
  if (tweet.username && typeof tweet.username === "string") return tweet.username;
  if (tweet.screen_name && typeof tweet.screen_name === "string") return tweet.screen_name;
  // Handle case where user is a dict-like object
  const u = tweet.user;
  if (u && typeof u === "object") return (u as any).screen_name || (u as any).name || "unknown";
  if (u && typeof u === "string") return u;
  // Try extracting from tweet_url
  const urlMatch = String(tweet.url || tweet.tweet_url || "").match(/x\.com\/(\w+)\//);
  if (urlMatch) return urlMatch[1];
  return "unknown";
}

function tweetToMarkdown(tweet: RawTweet, quality: string): string {
  const text = String(tweet.text || tweet.full_text || tweet.content || "(no text)");
  const handle = extractHandle(tweet);
  const tweetId = String(tweet.id || "");
  const url = String(tweet.url || tweet.tweet_url || (tweetId ? `https://x.com/${handle}/status/${tweetId}` : ""));
  const rawDate = String(tweet.created_at || "");
  // Parse various date formats: ISO, Twitter API format "Mon Mar 10 ...", etc.
  let date: string;
  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    date = parsed.toISOString().slice(0, 10);
  } else {
    date = new Date().toISOString().slice(0, 10);
  }
  const likes = Number(tweet.likes ?? tweet.favorite_count ?? 0) || 0;
  const retweets = Number(tweet.retweets ?? tweet.retweet_count ?? 0) || 0;
  const replies = Number(tweet.replies ?? tweet.reply_count ?? 0) || 0;

  // Generate citekey
  const keyword = text.slice(0, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "tweet";
  const citekey = `${handle.toLowerCase()}-${date}-${keyword}`;

  // Detect paper links
  const arxivLinks = [...text.matchAll(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/g)].map(m => `arxiv:${m[1]}`);
  const githubLinks = [...text.matchAll(/github\.com\/[\w-]+\/[\w-]+/g)].map(m => m[0]);
  const hasLinks = arxivLinks.length > 0 || githubLinks.length > 0;
  const isThread = text.length > 500;

  // Tags from config keywords
  const config = loadConfig();
  const matchedKeywords = config.keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
  const tags = ["twitter", ...matchedKeywords.slice(0, 5).map(k => k.replace(/\s+/g, "-"))];

  const lines = [
    "---",
    `citekey: "${citekey}"`,
    `title: "${text.slice(0, 100).replace(/"/g, "'").replace(/\n/g, " ")}${text.length > 100 ? "..." : ""}"`,
    `author: "${handle}"`,
    `author_handle: ${handle}`,
    `tweet_id: "${tweetId}"`,
    `url: "${url}"`,
    `source_type: twitter`,
    `quality: ${quality}`,
    `is_thread: ${isThread}`,
    `has_paper_link: ${hasLinks}`,
    arxivLinks.length > 0 ? `linked_papers: [${arxivLinks.join(", ")}]` : `linked_papers: []`,
    `likes: ${likes}`,
    `retweets: ${retweets}`,
    `replies: ${replies}`,
    `date_posted: ${date}`,
    `date_synced: ${new Date().toISOString().slice(0, 10)}`,
    `tags: [${tags.join(", ")}]`,
    "---",
    "",
    "## Content",
    "",
    text,
    "",
  ];

  if (arxivLinks.length > 0 || githubLinks.length > 0) {
    lines.push("## Links", "");
    for (const l of arxivLinks) lines.push(`- ${l}`);
    for (const l of githubLinks) lines.push(`- https://${l}`);
    lines.push("");
  }

  return lines.join("\n");
}

function saveTweet(tweet: RawTweet, quality: string, dryRun: boolean): string | null {
  const handle = extractHandle(tweet);
  const text = String(tweet.text || tweet.full_text || tweet.content || "");
  const rawDate = String(tweet.created_at || "");
  const parsedDate = new Date(rawDate);
  const date = !isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const keyword = text.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 25) || "tweet";
  const filename = `${handle.toLowerCase()}-${date}-${keyword}.md`;
  const filepath = resolve(RAW_TWITTER, filename);

  if (existsSync(filepath)) return null; // skip duplicate by filename

  const md = tweetToMarkdown(tweet, quality);
  if (dryRun) {
    console.log(`[DRY RUN] Would save: ${filename} (quality=${quality})`);
    console.log(md.split("\n").slice(0, 15).join("\n"));
    console.log("...\n");
    return filename;
  }

  mkdirSync(RAW_TWITTER, { recursive: true });
  writeFileSync(filepath, md, "utf-8");
  return filename;
}

// ── Scweet bridge ─────────────────────────────────────────────────────
function callScweet(args: string): any {
  try {
    const output = execSync(`python3 "${BRIDGE}" ${args}`, {
      encoding: "utf-8", timeout: 120000, cwd: PROJECT_ROOT,
    });
    return JSON.parse(output.trim());
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    const stdout = e.stdout?.toString() || "";
    try { return JSON.parse(stdout.trim()); } catch {}
    return { status: "error", error: stderr || e.message };
  }
}

// ── xcancel profile scraper ───────────────────────────────────────────
function scrapeXcancelProfile(handle: string, limit = 20): RawTweet[] {
  const config = loadConfig();
  const instance = config.nitter_instances[0] || "xcancel.com";
  const url = `https://${instance}/${handle}`;

  try {
    const html = execSync(
      `curl -s --max-time 15 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { encoding: "utf-8", timeout: 20000 }
    );

    const tweets: RawTweet[] = [];
    // Parse timeline items — each tweet-body block contains content + metadata
    const tweetBlocks = html.split(/class="timeline-item\b/).slice(1);

    for (const block of tweetBlocks.slice(0, limit)) {
      // Extract tweet ID from status link
      const idMatch = block.match(new RegExp(`/${handle}/status/(\\d+)`));
      if (!idMatch) continue;

      // Extract content
      const contentMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!contentMatch) continue;
      const text = contentMatch[1]
        .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/g, " $1 ")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Extract date
      const dateMatch = block.match(/title="([A-Z][a-z]{2} \d{1,2}, \d{4})/);
      const created = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

      // Extract stats
      const statsMatch = [...block.matchAll(/icon-(comment|retweet|heart|play)[^<]*<\/span>\s*([\d,]+)/g)];
      const stats: Record<string, number> = {};
      for (const s of statsMatch) stats[s[1]] = parseInt(s[2].replace(/,/g, ""));

      tweets.push({
        id: idMatch[1],
        text,
        username: handle,
        created_at: created,
        url: `https://x.com/${handle}/status/${idMatch[1]}`,
        likes: stats.heart ?? 0,
        retweets: stats.retweet ?? 0,
        replies: stats.comment ?? 0,
      });
    }
    return tweets;
  } catch (e: any) {
    console.error(`Failed to scrape xcancel profile @${handle}: ${e.message}`);
    return [];
  }
}

// ── URL resolver (tries xcancel profile match, then Scweet) ───────────
function resolveUrl(twitterUrl: string): RawTweet | null {
  const m = twitterUrl.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
  if (!m) { console.error(`Invalid Twitter URL: ${twitterUrl}`); return null; }
  const [, handle, tweetId] = m;

  // Try xcancel profile (may contain the tweet if recent)
  const profileTweets = scrapeXcancelProfile(handle, 30);
  const match = profileTweets.find(t => t.id === tweetId);
  if (match) return match;

  // Fallback: try Scweet (needs account)
  console.log(`  Tweet not in recent timeline, trying Scweet...`);
  const result = callScweet(`search "from:${handle}" --limit 5`);
  if (result.status === "ok" && result.tweets) {
    const scweetMatch = result.tweets.find((t: any) => String(t.id) === tweetId);
    if (scweetMatch) return scweetMatch;
  }

  console.error(`  Could not resolve tweet ${tweetId} from @${handle}`);
  return null;
}

// ── CLI ───────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const dryRun = args.includes("--dry-run");
  const filterArgs = args.filter(a => a !== "--dry-run");

  if (filterArgs.includes("--status")) {
    const result = callScweet("status");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (filterArgs.includes("--setup-cookies")) {
    const idx = filterArgs.indexOf("--setup-cookies");
    const cookiesPath = filterArgs[idx + 1];
    if (!cookiesPath) { console.error("Usage: --setup-cookies <path>"); process.exit(1); }
    const result = callScweet(`setup --cookies "${cookiesPath}"`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const existingIds = getExistingTweetIds();
  let tweets: RawTweet[] = [];
  let source = "";

  if (filterArgs.includes("--search")) {
    // Scweet search mode
    const idx = filterArgs.indexOf("--search");
    const query = filterArgs[idx + 1];
    const sinceIdx = filterArgs.indexOf("--since");
    const limitIdx = filterArgs.indexOf("--limit");
    const since = sinceIdx >= 0 ? filterArgs[sinceIdx + 1] : undefined;
    const limit = limitIdx >= 0 ? parseInt(filterArgs[limitIdx + 1]) : 20;

    let scArgs = `search "${query}" --limit ${limit}`;
    if (since) scArgs += ` --since ${since}`;
    scArgs += " --has-links"; // always prefer tweets with links

    console.log(`Searching: "${query}" (limit=${limit}, since=${since || "any"})...`);
    const result = callScweet(scArgs);
    if (result.status === "error") { console.error(`Scweet error: ${result.error}`); process.exit(1); }
    tweets = result.tweets || [];
    source = `search:"${query}"`;

  } else if (filterArgs.includes("--profile")) {
    // Scweet profile mode
    const idx = filterArgs.indexOf("--profile");
    const handle = filterArgs[idx + 1];
    const limitIdx = filterArgs.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(filterArgs[limitIdx + 1]) : 10;

    console.log(`Fetching @${handle} timeline (limit=${limit})...`);
    const result = callScweet(`profile ${handle} --limit ${limit}`);
    if (result.status === "error") { console.error(`Scweet error: ${result.error}`); process.exit(1); }
    tweets = result.tweets || [];
    source = `profile:@${handle}`;

  } else if (filterArgs.includes("--curated")) {
    // Fetch all curated accounts
    const sinceIdx = filterArgs.indexOf("--since");
    const since = sinceIdx >= 0 ? filterArgs[sinceIdx + 1] : undefined;
    const limitIdx = filterArgs.indexOf("--limit");
    const perAccount = limitIdx >= 0 ? parseInt(filterArgs[limitIdx + 1]) : 5;

    console.log(`Fetching ${config.accounts.length} curated accounts (${perAccount} each)...`);
    for (const account of config.accounts) {
      console.log(`  @${account.handle} (${account.priority})...`);
      const result = callScweet(`profile ${account.handle} --limit ${perAccount}`);
      if (result.status === "ok") tweets.push(...(result.tweets || []));
      else console.error(`  Failed: ${result.error}`);
    }
    source = "curated";

  } else if (filterArgs[0] && (filterArgs[0].includes("twitter.com") || filterArgs[0].includes("x.com"))) {
    // URL mode via xcancel
    const urls = filterArgs.filter(a => a.includes("twitter.com") || a.includes("x.com"));
    console.log(`Resolving ${urls.length} URL(s)...`);
    for (const url of urls) {
      const tweet = resolveUrl(url);
      if (tweet) tweets.push(tweet);
    }
    source = "url";

  } else if (filterArgs.includes("--batch")) {
    // Batch URL mode
    const idx = filterArgs.indexOf("--batch");
    const batchFile = filterArgs[idx + 1];
    if (!batchFile || !existsSync(batchFile)) { console.error(`Batch file not found: ${batchFile}`); process.exit(1); }
    const urls = readFileSync(batchFile, "utf-8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    console.log(`Resolving ${urls.length} URLs from ${batchFile}...`);
    for (const url of urls) {
      const tweet = resolveUrl(url);
      if (tweet) tweets.push(tweet);
    }
    source = `batch:${batchFile}`;

  } else {
    console.log(`Twitter Ingest for NORIA

Usage:
  npx tsx tools/twitter-ingest.ts <url>                              # Parse single tweet via xcancel
  npx tsx tools/twitter-ingest.ts --batch urls.txt                   # Parse multiple URLs
  npx tsx tools/twitter-ingest.ts --search "query" [--since DATE]    # Scweet keyword search
  npx tsx tools/twitter-ingest.ts --profile <handle> [--limit N]     # Scweet user timeline
  npx tsx tools/twitter-ingest.ts --curated [--limit N]              # All curated accounts
  npx tsx tools/twitter-ingest.ts --status                           # Scweet account status
  npx tsx tools/twitter-ingest.ts --setup-cookies <path>             # Import cookies

Flags:
  --dry-run    Preview without saving
  --since      Start date (YYYY-MM-DD)
  --limit      Max tweets per source`);
    return;
  }

  // Deduplicate
  const before = tweets.length;
  tweets = tweets.filter(t => {
    const id = t.id || "";
    return !id || !existingIds.has(id);
  });
  const dupeSkipped = before - tweets.length;

  // Quality filter
  let saved = 0, filtered = 0;
  for (const tweet of tweets) {
    const { pass, quality, reasons } = qualityFilter(tweet, config);
    if (!pass) { filtered++; continue; }
    const filename = saveTweet(tweet, quality, dryRun);
    if (filename) {
      saved++;
      if (!dryRun) console.log(`  ✓ ${filename} (${quality}: ${reasons.join(", ")})`);
    }
  }

  console.log(`\nDone (source=${source}): ${tweets.length} tweets, ${saved} saved, ${filtered} filtered, ${dupeSkipped} dupes skipped`);
}

main();
