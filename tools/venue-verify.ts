/**
 * venue-verify.ts — Multi-source venue verification for wiki source pages
 *
 * Verification sources (tried in order):
 *   1. Semantic Scholar API: publicationVenue field (covers most published papers)
 *   2. OpenReview API v2: ICLR/NeurIPS acceptance status (direct confirmation)
 *   3. DBLP API: comprehensive venue database (fallback)
 *
 * Design: any single source confirming = verified (OR-gate, same as relevance-filter)
 *
 * Usage:
 *   npx tsx tools/venue-verify.ts <citekey>            # verify single paper
 *   npx tsx tools/venue-verify.ts --batch              # verify all top-tier pages
 *   npx tsx tools/venue-verify.ts --batch --dry-run    # preview without updating
 *   npx tsx tools/venue-verify.ts --stats              # show verification status
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";

// ── Setup ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(__dirname, "..");
const WIKI_SRC = resolve(PROJECT_ROOT, "wiki", "sources");

// Load .env
const envPath = resolve(PROJECT_ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const S2_API = "https://api.semanticscholar.org/graph/v1";
const S2_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY ?? "";
const OPENREVIEW_API = "https://api2.openreview.net";
const DBLP_API = "https://dblp.org/search/publ/api";

// ── Venue name mapping ─────────────────────────────────────────────────

/** Short name → known full names (lowercase). Used for fuzzy matching. */
const VENUE_ALIASES: Record<string, string[]> = {
  iclr: ["international conference on learning representations"],
  neurips: ["neural information processing systems", "advances in neural information processing systems", "conference on neural information processing systems"],
  nips: ["neural information processing systems", "advances in neural information processing systems"],
  icml: ["international conference on machine learning"],
  acl: ["association for computational linguistics", "annual meeting of the association for computational linguistics"],
  emnlp: ["empirical methods in natural language processing", "conference on empirical methods in natural language processing"],
  naacl: ["north american chapter of the association for computational linguistics"],
  cvpr: ["computer vision and pattern recognition", "ieee/cvf conference on computer vision and pattern recognition"],
  iccv: ["international conference on computer vision"],
  eccv: ["european conference on computer vision"],
  aaai: ["aaai conference on artificial intelligence"],
  ijcai: ["international joint conference on artificial intelligence"],
  www: ["the web conference", "world wide web"],
  kdd: ["knowledge discovery and data mining"],
  sigir: ["research and development in information retrieval"],
  chi: ["human factors in computing systems"],
  // Journals
  tpami: ["ieee transactions on pattern analysis and machine intelligence"],
  jmlr: ["journal of machine learning research"],
  tmlr: ["transactions on machine learning research"],
  pnas: ["proceedings of the national academy of sciences"],
};

/** Venues that can be verified on OpenReview */
const OPENREVIEW_VENUES = new Set(["iclr", "neurips", "nips"]);

// ── Types ──────────────────────────────────────────────────────────────

interface SourceMeta {
  title: string;
  venue: string;
  venue_tier: string;
  venue_verified?: boolean;
  year: number;
  doi?: string;
}

export interface VerifyResult {
  citekey: string;
  status: "verified" | "unverified" | "skipped";
  source?: "s2" | "openreview" | "dblp" | "manual";
  url?: string;
  reason: string;
  s2_venue?: string;
  manualCheckUrl?: string;
}

/** Generate a URL where the user can manually verify the venue */
function manualVerifyUrl(venue: string, title: string): string {
  const short = extractVenueShort(venue);
  const q = encodeURIComponent(title.slice(0, 100));
  if (OPENREVIEW_VENUES.has(short)) return `https://openreview.net/search?term=${q}`;
  if (["acl", "emnlp", "naacl"].includes(short)) return `https://aclanthology.org/search/?q=${q}`;
  if (["cvpr", "iccv"].includes(short)) return `https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${q}`;
  if (short === "icml") return `https://proceedings.mlr.press/search-page.html?query=${q}`;
  return `https://dblp.org/search?q=${q}`;
}

// ── Frontmatter parsing ────────────────────────────────────────────────

function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?\n)---/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}

function readSourceMeta(citekey: string): SourceMeta | null {
  const path = resolve(WIKI_SRC, `${citekey}.md`);
  if (!existsSync(path)) return null;
  const fm = parseFrontmatter(readFileSync(path, "utf-8"));
  return {
    title: fm.title || "",
    venue: fm.venue || "",
    venue_tier: fm.venue_tier || "",
    venue_verified: fm.venue_verified === "true" ? true : fm.venue_verified === "false" ? false : undefined,
    year: parseInt(fm.year) || 0,
    doi: fm.doi,
  };
}

function updateFrontmatter(citekey: string, verified: boolean, source: string): void {
  const path = resolve(WIKI_SRC, `${citekey}.md`);
  let content = readFileSync(path, "utf-8");

  // Remove existing venue_verified / venue_verification_source lines
  content = content.replace(/\nvenue_verified:.*\n/g, "\n");
  content = content.replace(/\nvenue_verification_source:.*\n/g, "\n");

  // Insert after venue_tier line
  const tierMatch = content.match(/(venue_tier:\s*.+\n)/);
  if (tierMatch) {
    const insert = `venue_verified: ${verified}\nvenue_verification_source: "${source}"\n`;
    content = content.replace(tierMatch[0], tierMatch[0] + insert);
  }

  writeFileSync(path, content, "utf-8");
}

// ── Venue matching ─────────────────────────────────────────────────────

/** Extract short venue name from a claimed venue string like "ICLR 2026" */
function extractVenueShort(venue: string): string {
  // Remove year and extra text
  return venue.replace(/\d{4}/g, "").replace(/[^a-zA-Z]/g, "").toLowerCase().trim();
}

/** Normalize venue string for comparison: lowercase, strip year/punctuation, collapse whitespace */
function normalizeVenue(v: string): string {
  return v.toLowerCase().replace(/\d{4}/g, "").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Check if an API-returned venue name matches the claimed venue */
function venueMatches(claimed: string, returned: string): boolean {
  if (!claimed || !returned) return false;
  const cl = normalizeVenue(claimed);
  const rl = normalizeVenue(returned);

  // Direct match after normalization
  if (cl === rl) return true;

  // Substring containment (either direction)
  if (cl.length >= 5 && rl.includes(cl)) return true;
  if (rl.length >= 5 && cl.includes(rl)) return true;

  // Short acronym matching
  const shortClaimed = extractVenueShort(claimed);
  const shortReturned = extractVenueShort(returned);

  // Check aliases for the claimed short name
  const aliases = VENUE_ALIASES[shortClaimed] || [];
  for (const alias of aliases) {
    if (rl.includes(alias) || alias.includes(rl)) return true;
  }

  // Check aliases for the returned short name
  const returnedAliases = VENUE_ALIASES[shortReturned] || [];
  for (const alias of returnedAliases) {
    if (cl.includes(alias) || alias.includes(cl)) return true;
  }

  // Short name cross-match (e.g., "ICML" in "International Conference on Machine Learning")
  if (shortClaimed.length >= 3 && shortClaimed.length <= 10) {
    if (rl.split(/\s+/).some((w) => w === shortClaimed)) return true;
  }
  if (shortReturned.length >= 3 && shortReturned.length <= 10) {
    if (cl.split(/\s+/).some((w) => w === shortReturned)) return true;
  }

  return false;
}

// ── API helpers ────────────────────────────────────────────────────────

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const h: Record<string, string> = { "User-Agent": "NORIA-VenueVerify/1.0", ...headers };
  const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Source 1: Semantic Scholar ──────────────────────────────────────────

async function verifyViaS2(meta: SourceMeta): Promise<{ verified: boolean; venue?: string; url?: string }> {
  const fields = "publicationVenue,venue,year,externalIds,title";
  const query = encodeURIComponent(meta.title.slice(0, 200));
  const url = `${S2_API}/paper/search?query=${query}&fields=${fields}&limit=3`;
  const headers: Record<string, string> = {};
  if (S2_API_KEY) headers["x-api-key"] = S2_API_KEY;

  const data = await fetchJson(url, headers);
  if (!data?.data?.length) return { verified: false };

  for (const paper of data.data) {
    // Title similarity check (basic)
    const titleSim = titleOverlap(meta.title, paper.title || "");
    if (titleSim < 0.6) continue;

    const pubVenue = paper.publicationVenue?.name || "";
    const venueField = paper.venue || "";
    const s2Url = `https://www.semanticscholar.org/paper/${paper.paperId}`;

    if (venueMatches(meta.venue, pubVenue) || venueMatches(meta.venue, venueField)) {
      return { verified: true, venue: pubVenue || venueField, url: s2Url };
    }

    // Return what S2 thinks even if no match
    if (pubVenue || venueField) {
      return { verified: false, venue: pubVenue || venueField, url: s2Url };
    }
  }

  return { verified: false };
}

/** Simple word overlap ratio for title matching */
function titleOverlap(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size);
}

// ── Source 2: OpenReview ───────────────────────────────────────────────

async function verifyViaOpenReview(meta: SourceMeta): Promise<{ verified: boolean; venue?: string; url?: string }> {
  const short = extractVenueShort(meta.venue);
  if (!OPENREVIEW_VENUES.has(short)) return { verified: false };

  const query = encodeURIComponent(meta.title.slice(0, 200));
  const url = `${OPENREVIEW_API}/notes/search?query=${query}&limit=3`;

  const data = await fetchJson(url);
  if (!data?.notes?.length) return { verified: false };

  for (const note of data.notes) {
    const noteTitle = note.content?.title?.value || note.content?.title || "";
    if (titleOverlap(meta.title, noteTitle) < 0.6) continue;

    // Check venue/venueid
    const noteVenue = note.content?.venue?.value || note.content?.venue || "";
    const noteVenueId = note.content?.venueid?.value || note.content?.venueid || "";
    const noteUrl = `https://openreview.net/forum?id=${note.id}`;

    // Check if accepted (not just submitted)
    const isAccepted = noteVenue && !noteVenue.toLowerCase().includes("submitted") && !noteVenue.toLowerCase().includes("withdraw");
    if (isAccepted && venueMatches(meta.venue, noteVenue)) {
      return { verified: true, venue: noteVenue, url: noteUrl };
    }

    // Check invitation field for acceptance
    const invitations = note.invitations || [];
    for (const inv of invitations) {
      if (typeof inv === "string" && inv.toLowerCase().includes(short)) {
        // Has a venue-related invitation
        if (!inv.toLowerCase().includes("submission")) {
          return { verified: true, venue: noteVenueId || noteVenue || inv, url: noteUrl };
        }
      }
    }
  }

  return { verified: false };
}

// ── Source 3: DBLP ─────────────────────────────────────────────────────

async function verifyViaDblp(meta: SourceMeta): Promise<{ verified: boolean; venue?: string; url?: string }> {
  const query = encodeURIComponent(meta.title.slice(0, 200));
  const url = `${DBLP_API}?q=${query}&format=json&h=3`;

  const data = await fetchJson(url);
  const hits = data?.result?.hits?.hit;
  if (!hits?.length) return { verified: false };

  for (const hit of hits) {
    const info = hit.info;
    if (!info) continue;

    const hitTitle = info.title || "";
    if (titleOverlap(meta.title, hitTitle.replace(/\.$/, "")) < 0.6) continue;

    const dblpVenue = info.venue || "";
    const dblpUrl = info.url || "";

    if (venueMatches(meta.venue, dblpVenue)) {
      return { verified: true, venue: dblpVenue, url: dblpUrl };
    }

    if (dblpVenue) {
      return { verified: false, venue: dblpVenue, url: dblpUrl };
    }
  }

  return { verified: false };
}

// ── Main verification ──────────────────────────────────────────────────

async function verify(citekey: string, dryRun: boolean, force = false): Promise<VerifyResult> {
  const meta = readSourceMeta(citekey);
  if (!meta) return { citekey, status: "skipped", reason: "source page not found" };
  if (!meta.venue_tier || !["top-conf", "top-journal"].includes(meta.venue_tier)) {
    return { citekey, status: "skipped", reason: `venue_tier=${meta.venue_tier || "none"}, not top-tier` };
  }
  if (meta.venue_verified === true && !force) {
    return { citekey, status: "verified", source: "manual", reason: "already verified (use --force to re-check)" };
  }

  // Source 1: Semantic Scholar
  const s2 = await verifyViaS2(meta);
  if (s2.verified) {
    if (!dryRun) updateFrontmatter(citekey, true, "s2");
    return { citekey, status: "verified", source: "s2", url: s2.url, reason: `S2 venue: ${s2.venue}` };
  }

  await sleep(500);

  // Source 2: OpenReview (ICLR/NeurIPS only)
  const or = await verifyViaOpenReview(meta);
  if (or.verified) {
    if (!dryRun) updateFrontmatter(citekey, true, "openreview");
    return { citekey, status: "verified", source: "openreview", url: or.url, reason: `OpenReview: ${or.venue}` };
  }

  await sleep(500);

  // Source 3: DBLP
  const dblp = await verifyViaDblp(meta);
  if (dblp.verified) {
    if (!dryRun) updateFrontmatter(citekey, true, "dblp");
    return { citekey, status: "verified", source: "dblp", url: dblp.url, reason: `DBLP: ${dblp.venue}` };
  }

  // Unverified — report what sources found + manual check URL
  const s2Note = s2.venue ? `S2 says: "${s2.venue}"` : "S2: no match";
  const dblpNote = dblp.venue ? `DBLP says: "${dblp.venue}"` : "DBLP: no match";
  if (!dryRun) updateFrontmatter(citekey, false, "auto-unverified");
  return {
    citekey,
    status: "unverified",
    reason: `Claimed "${meta.venue}" — ${s2Note}, ${dblpNote}`,
    s2_venue: s2.venue,
    manualCheckUrl: manualVerifyUrl(meta.venue, meta.title),
  };
}

// ── Batch helpers ──────────────────────────────────────────────────────

function findTopTierPages(): string[] {
  const files = readdirSync(WIKI_SRC).filter((f) => f.endsWith(".md"));
  const results: string[] = [];
  for (const f of files) {
    const citekey = f.replace(/\.md$/, "");
    const fm = parseFrontmatter(readFileSync(resolve(WIKI_SRC, f), "utf-8"));
    if (fm.venue_tier === "top-conf" || fm.venue_tier === "top-journal") {
      results.push(citekey);
    }
  }
  return results.sort();
}

function showStats(): void {
  const files = readdirSync(WIKI_SRC).filter((f) => f.endsWith(".md"));
  let total = 0, topTier = 0, verified = 0, unverified = 0, pending = 0;
  for (const f of files) {
    total++;
    const fm = parseFrontmatter(readFileSync(resolve(WIKI_SRC, f), "utf-8"));
    if (fm.venue_tier === "top-conf" || fm.venue_tier === "top-journal") {
      topTier++;
      if (fm.venue_verified === "true") verified++;
      else if (fm.venue_verified === "false") unverified++;
      else pending++;
    }
  }
  console.log(`\n📊 Venue Verification Status`);
  console.log(`   Total source pages: ${total}`);
  console.log(`   Top-tier (need verification): ${topTier}`);
  console.log(`   ✅ Verified: ${verified}`);
  console.log(`   ❌ Unverified: ${unverified}`);
  console.log(`   ⏳ Pending: ${pending}\n`);
}

// ── CLI ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const batch = args.includes("--batch");
  const stats = args.includes("--stats");
  const force = args.includes("--force");

  if (stats) {
    showStats();
    return;
  }

  if (batch) {
    const pages = findTopTierPages();
    console.log(`\n🔍 Batch venue verification: ${pages.length} top-tier pages${dryRun ? " (dry-run)" : ""}\n`);

    const results: VerifyResult[] = [];
    for (const citekey of pages) {
      const r = await verify(citekey, dryRun, force);
      const icon = r.status === "verified" ? "✅" : r.status === "unverified" ? "❌" : "⏭️";
      console.log(`${icon} ${citekey}: ${r.reason}`);
      results.push(r);
      if (r.status !== "skipped") await sleep(1000); // rate limit
    }

    const v = results.filter((r) => r.status === "verified").length;
    const u = results.filter((r) => r.status === "unverified").length;
    const s = results.filter((r) => r.status === "skipped").length;
    console.log(`\n── Summary ──`);
    console.log(`✅ Verified: ${v}  ❌ Unverified: ${u}  ⏭️ Skipped: ${s}`);
    if (u > 0) {
      console.log(`\n⚠️  Unverified papers — manual check URLs:`);
      for (const r of results.filter((r) => r.status === "unverified")) {
        if (r.manualCheckUrl) console.log(`   ${r.citekey}: ${r.manualCheckUrl}`);
      }
    }
    return;
  }

  // Single citekey mode
  const citekey = args.find((a) => !a.startsWith("--"));
  if (!citekey) {
    console.log("Usage: npx tsx tools/venue-verify.ts <citekey> [--dry-run]");
    console.log("       npx tsx tools/venue-verify.ts --batch [--dry-run]");
    console.log("       npx tsx tools/venue-verify.ts --stats");
    process.exit(1);
  }

  const r = await verify(citekey, dryRun, force);
  const icon = r.status === "verified" ? "✅" : r.status === "unverified" ? "❌" : "⏭️";
  console.log(`\n${icon} ${r.citekey}: ${r.reason}`);
  if (r.url) console.log(`   🔗 ${r.url}`);
  if (r.status === "unverified") {
    console.log(`   ⚠️  Manual verification needed.`);
    if (r.manualCheckUrl) console.log(`   🔍 Check here: ${r.manualCheckUrl}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
