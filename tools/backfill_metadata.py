#!/usr/bin/env python3
"""Backfill bibliographic metadata from raw/ files into wiki/sources/ frontmatter.

Usage:
  python3 tools/backfill_metadata.py              # dry-run (default)
  python3 tools/backfill_metadata.py --apply       # apply changes
  python3 tools/backfill_metadata.py --stats       # show stats only
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIRS = [ROOT / "raw/zotero/papers", ROOT / "raw/arxiv", ROOT / "raw/semantic-scholar"]
WIKI_SRC = ROOT / "wiki/sources"
MANIFEST = ROOT / ".kb/manifest.json"

# Known top-tier venues (CCF-A or equivalent)
TOP_CONF = {
    "neurips", "nips", "icml", "iclr", "aaai", "ijcai", "acl", "emnlp", "naacl",
    "cvpr", "iccv", "eccv", "www", "the web conference", "kdd", "sigir", "chi",
    "sigmod", "vldb", "icse", "fse", "isca", "micro", "osdi", "sosp",
    "web search and data mining",  # WSDM
}
TOP_JOURNAL = {
    "tpami", "ieee transactions on pattern analysis",
    "jmlr", "journal of machine learning research",
    "aij", "artificial intelligence",
    "tmlr", "transactions on machine learning research",
    "nature machine intelligence", "nature",
    "ieee transactions on signal processing",
    "ieee transactions on neural networks",
}


def classify_venue(venue: str, pub_types: list[str] | None = None) -> str:
    """Classify venue into tier."""
    if not venue:
        return "arxiv-preprint"
    vl = venue.lower().strip()
    # Check top conferences
    for tc in TOP_CONF:
        if tc in vl:
            return "top-conf"
    # Check top journals
    for tj in TOP_JOURNAL:
        if tj in vl:
            return "top-journal"
    # Check publication types from S2
    if pub_types:
        pts = [p.lower() for p in pub_types]
        if "conference" in pts:
            return "top-conf"  # S2 marks conference papers; assume relevant if in CS
        if "journalarticle" in pts and "arxiv" not in vl:
            return "top-journal"
    # arXiv check
    if "arxiv" in vl:
        return "arxiv-preprint"
    # Workshop check
    if "workshop" in vl:
        return "workshop"
    # Default for unknown venues with actual names
    if vl and vl != "unknown":
        return "arxiv-preprint"  # conservative default
    return "arxiv-preprint"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter, return (dict, body_after_frontmatter)."""
    m = re.match(r"^---\n(.*?\n)---\n?", text, re.DOTALL)
    if not m:
        return {}, text
    fm_text = m.group(1)
    body = text[m.end():]
    fm: dict = {}
    for line in fm_text.splitlines():
        kv = line.split(":", 1)
        if len(kv) != 2:
            continue
        key = kv[0].strip()
        val = kv[1].strip()
        if val.startswith("[") and val.endswith("]"):
            items = [v.strip().strip('"').strip("'") for v in val[1:-1].split(",") if v.strip()]
            fm[key] = items
        elif val.startswith('"') and val.endswith('"'):
            fm[key] = val[1:-1]
        elif val.startswith("'") and val.endswith("'"):
            fm[key] = val[1:-1]
        else:
            fm[key] = val
    return fm, body


def find_raw_file(citekey: str) -> Path | None:
    """Find raw file by citekey across all raw directories."""
    for d in RAW_DIRS:
        if not d.exists():
            continue
        for f in d.glob("*.md"):
            text = f.read_text(errors="replace")
            fm_match = re.search(r'^citekey:\s*"?([^"\n]+)"?', text, re.MULTILINE)
            if fm_match and fm_match.group(1).strip() == citekey:
                return f
            # Also match by filename
            if f.stem == citekey:
                return f
    return None


def extract_metadata(raw_fm: dict) -> dict:
    """Extract bibliographic metadata from raw file frontmatter."""
    meta = {}

    # Authors
    authors = raw_fm.get("authors")
    if isinstance(authors, list) and authors:
        meta["authors"] = authors
    elif isinstance(authors, str) and authors:
        meta["authors"] = [a.strip() for a in authors.split(",")]

    # Year
    year = raw_fm.get("year", "")
    if year:
        meta["year"] = str(year).strip()

    # Venue
    venue = raw_fm.get("venue", "") or raw_fm.get("venue_name", "")
    if venue:
        meta["venue"] = venue.strip().strip('"')

    # Publication types (from S2)
    pub_types = raw_fm.get("publication_types")
    if isinstance(pub_types, str):
        pub_types = [p.strip() for p in pub_types.split(",")]

    # Venue tier
    meta["venue_tier"] = classify_venue(meta.get("venue", ""), pub_types)

    # DOI
    doi = raw_fm.get("doi", "")
    if doi:
        meta["doi"] = doi.strip().strip('"')

    # Citation count (S2 only)
    cc = raw_fm.get("citation_count", "")
    if cc and str(cc).strip() not in ("", "0"):
        meta["citation_count"] = str(cc).strip()

    # arXiv ID
    arxiv = raw_fm.get("arxiv_id", "")
    if arxiv:
        meta["arxiv_id"] = arxiv.strip().strip('"')

    # Source type
    st = raw_fm.get("source_type", "")
    if st:
        meta["source_type_raw"] = st.strip()

    return meta


def patch_wiki_frontmatter(wiki_path: Path, new_meta: dict, apply: bool) -> tuple[bool, list[str]]:
    """Patch wiki source page frontmatter with new metadata. Returns (changed, changes)."""
    text = wiki_path.read_text(errors="replace")
    fm, body = parse_frontmatter(text)
    changes = []

    # Fields to add/update
    field_map = {
        "authors": new_meta.get("authors"),
        "year": new_meta.get("year"),
        "venue": new_meta.get("venue"),
        "venue_tier": new_meta.get("venue_tier"),
        "doi": new_meta.get("doi"),
        "citation_count": new_meta.get("citation_count"),
    }

    for key, val in field_map.items():
        if val is None:
            continue
        existing = fm.get(key)
        if existing and str(existing) == str(val):
            continue  # already correct
        if existing:
            changes.append(f"  update {key}: {existing} → {val}")
        else:
            changes.append(f"  add {key}: {val}")

    if not changes:
        return False, []

    if not apply:
        return True, changes

    # Rebuild frontmatter
    fm_match = re.match(r"^---\n(.*?\n)---\n?", text, re.DOTALL)
    if not fm_match:
        return False, ["ERROR: no frontmatter found"]

    fm_lines = fm_match.group(1).rstrip().split("\n")
    new_lines = []
    added_keys = set()

    for line in fm_lines:
        kv = line.split(":", 1)
        key = kv[0].strip() if len(kv) == 2 else ""
        if key in field_map and field_map[key] is not None:
            val = field_map[key]
            if isinstance(val, list):
                new_lines.append(f"{key}: [{', '.join(val)}]")
            else:
                new_lines.append(f'{key}: {val}')
            added_keys.add(key)
        else:
            new_lines.append(line)

    # Add fields not yet in frontmatter (insert before last line which is usually updated:)
    insert_pos = len(new_lines)
    # Find position after "updated:" line
    for i, line in enumerate(new_lines):
        if line.startswith("updated:"):
            insert_pos = i + 1
            break

    for key, val in field_map.items():
        if key not in added_keys and val is not None:
            if isinstance(val, list):
                new_lines.insert(insert_pos, f"{key}: [{', '.join(val)}]")
            else:
                new_lines.insert(insert_pos, f'{key}: {val}')
            insert_pos += 1

    new_text = "---\n" + "\n".join(new_lines) + "\n---\n" + body
    wiki_path.write_text(new_text)
    return True, changes


def main():
    parser = argparse.ArgumentParser(description="Backfill bibliographic metadata into wiki source pages")
    parser.add_argument("--apply", action="store_true", help="Apply changes (default is dry-run)")
    parser.add_argument("--stats", action="store_true", help="Show statistics only")
    args = parser.parse_args()

    # Build citekey → raw file index
    raw_index: dict[str, Path] = {}
    for d in RAW_DIRS:
        if not d.exists():
            continue
        for f in d.glob("*.md"):
            text = f.read_text(errors="replace")
            fm_match = re.search(r'^citekey:\s*"?([^"\n]+)"?', text, re.MULTILINE)
            if fm_match:
                raw_index[fm_match.group(1).strip()] = f

    # Process wiki source pages
    if not WIKI_SRC.exists():
        print("ERROR: wiki/sources/ not found")
        sys.exit(1)

    wiki_pages = sorted(WIKI_SRC.glob("*.md"))
    total = len(wiki_pages)
    enriched = 0
    skipped = 0
    already_complete = 0
    no_raw = 0

    tier_counts: dict[str, int] = {}
    has_venue = 0
    has_authors = 0
    has_doi = 0

    for wp in wiki_pages:
        wiki_fm, _ = parse_frontmatter(wp.read_text(errors="replace"))
        citekey = wp.stem

        # Find matching raw file
        raw_path = raw_index.get(citekey)
        if not raw_path:
            # Try source list
            sources = wiki_fm.get("sources", [])
            if isinstance(sources, list) and sources:
                raw_path = raw_index.get(sources[0])
            if not raw_path:
                no_raw += 1
                continue

        raw_fm, _ = parse_frontmatter(raw_path.read_text(errors="replace"))
        meta = extract_metadata(raw_fm)

        if args.stats:
            tier = meta.get("venue_tier", "unknown")
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
            if meta.get("venue"):
                has_venue += 1
            if meta.get("authors"):
                has_authors += 1
            if meta.get("doi"):
                has_doi += 1
            continue

        changed, changes = patch_wiki_frontmatter(wp, meta, apply=args.apply)
        if changed:
            enriched += 1
            action = "PATCHED" if args.apply else "WOULD PATCH"
            print(f"{action}: {wp.name}")
            for c in changes:
                print(c)
        else:
            already_complete += 1

    if args.stats:
        print(f"=== Source Metadata Statistics ===\n")
        print(f"Total source pages: {total}")
        print(f"With raw match: {total - no_raw}")
        print(f"No raw file: {no_raw}")
        print(f"\nVenue tier distribution:")
        for tier, count in sorted(tier_counts.items(), key=lambda x: -x[1]):
            print(f"  {tier}: {count}")
        print(f"\nMetadata availability:")
        print(f"  Has authors: {has_authors}/{total}")
        print(f"  Has venue: {has_venue}/{total}")
        print(f"  Has DOI: {has_doi}/{total}")
        return

    print(f"\n=== Summary ===")
    print(f"Total: {total}")
    print(f"{'Patched' if args.apply else 'Would patch'}: {enriched}")
    print(f"Already complete: {already_complete}")
    print(f"No raw file found: {no_raw}")
    if not args.apply and enriched > 0:
        print(f"\nRe-run with --apply to write changes.")


if __name__ == "__main__":
    main()
