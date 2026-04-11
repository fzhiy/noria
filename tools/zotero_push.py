#!/usr/bin/env python3
"""
zotero_push.py — Push papers to Zotero + download PDFs to OneDrive.

Two-path approach:
  1. Metadata → Zotero Web API (create item + add to collection)
  2. PDF → OneDrive directory (direct download, Zotero-style filename)

Usage:
  python3 tools/zotero_push.py --from-raw raw/arxiv/liu2025-webcoach.md
  python3 tools/zotero_push.py --from-raw raw/arxiv/*.md
  python3 tools/zotero_push.py --test
  python3 tools/zotero_push.py --list-collections

Environment (.env):
  ZOTERO_API_KEY, ZOTERO_LIBRARY_ID, ZOTERO_COLLECTION_KEY
  ZOTERO_PDF_DIR  — OneDrive PDF directory (auto-detected if not set)
"""

import argparse, json, os, sys, time
from pathlib import Path

# Load .env
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

try:
    from pyzotero import zotero
except ImportError:
    print("ERROR: pip install pyzotero"); sys.exit(1)
try:
    import requests
except ImportError:
    print("ERROR: pip install requests"); sys.exit(1)

API_KEY = os.environ.get("ZOTERO_API_KEY", "")
LIBRARY_ID = os.environ.get("ZOTERO_LIBRARY_ID", "")
COLLECTION_KEY = os.environ.get("ZOTERO_COLLECTION_KEY", "")
MAX_BATCH = 20

# Auto-detect OneDrive PDF directory
DEFAULT_PDF_DIR = "/path/to/pdf/storage"
PDF_DIR = os.environ.get("ZOTERO_PDF_DIR", DEFAULT_PDF_DIR)


def get_zot():
    if not API_KEY or not LIBRARY_ID:
        print("ERROR: Set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID in .env"); sys.exit(1)
    return zotero.Zotero(LIBRARY_ID, "user", API_KEY)


def make_zotero_filename(paper: dict) -> str:
    """Generate Zotero-style filename: 'Author et al. - Year - Title.pdf'"""
    authors = paper.get("authors", [])
    if not authors:
        author_part = "Unknown"
    elif len(authors) == 1:
        last = authors[0].strip().split()[-1] if authors[0].strip() else "Unknown"
        author_part = last
    else:
        last = authors[0].strip().split()[-1] if authors[0].strip() else "Unknown"
        author_part = f"{last} et al."

    year = paper.get("year", "")
    title = paper.get("title", "Untitled")
    # Clean title for filename
    title_clean = title.replace(":", " -").replace("/", "-").replace("\\", "-")
    title_clean = title_clean.replace('"', '').replace("?", "").replace("*", "")
    title_clean = title_clean[:120]  # Limit length

    return f"{author_part} - {year} - {title_clean}.pdf"


def push_paper(zot, paper: dict, collection_key: str, pdf_dir: str) -> dict:
    """Push one paper: metadata → Zotero API, PDF → OneDrive directory."""
    # Determine item type
    venue = paper.get("venue", "")
    is_preprint = "arxiv" in venue.lower() or paper.get("source_type") == "arxiv"
    item_type = "preprint" if is_preprint else "journalArticle"
    try:
        template = zot.item_template(item_type)
    except Exception:
        template = zot.item_template("journalArticle")

    # Fill metadata
    template["title"] = paper.get("title", "Untitled")
    template["abstractNote"] = paper.get("abstract", "")
    template["date"] = str(paper.get("year", ""))
    template["DOI"] = paper.get("doi", "")
    template["url"] = paper.get("url", "")
    if paper.get("venue") and paper["venue"] != "arXiv.org":
        template["publicationTitle"] = paper["venue"]

    # Authors
    creators = []
    for author in paper.get("authors", []):
        parts = author.strip().split()
        if len(parts) >= 2:
            creators.append({"creatorType": "author", "firstName": " ".join(parts[:-1]), "lastName": parts[-1]})
        elif parts:
            creators.append({"creatorType": "author", "name": parts[0]})
    if creators:
        template["creators"] = creators

    # Tags
    tags = [{"tag": f"noria:{paper.get('citekey', '')}"}]
    if paper.get("source_type"):
        tags.append({"tag": f"source:{paper['source_type']}"})
    template["tags"] = tags
    template["collections"] = [collection_key]

    # === Step 1: Create Zotero item (metadata only) ===
    resp = zot.create_items([template])
    if "successful" not in resp or "0" not in resp["successful"]:
        err = resp.get("failed", {}).get("0", {}).get("message", "Unknown error")
        print(f"  ✗ Failed: {paper.get('title', '')[:50]}... — {err}")
        return {"key": None, "title": paper.get("title", ""), "pdf_saved": False}

    item_key = resp["successful"]["0"]["key"]
    print(f"  ✓ Zotero item created: {paper.get('citekey', '')} → {item_key}")

    # === Step 2: Download PDF to OneDrive directory ===
    pdf_saved = False
    pdf_url = paper.get("pdf_url", "")
    if not pdf_url and paper.get("arxiv_id"):
        pdf_url = f"https://arxiv.org/pdf/{paper['arxiv_id']}"

    if pdf_url and pdf_dir and os.path.isdir(pdf_dir):
        filename = make_zotero_filename(paper)
        pdf_path = os.path.join(pdf_dir, filename)

        if os.path.exists(pdf_path):
            print(f"    PDF already exists: {filename}")
            pdf_saved = True
        else:
            try:
                print(f"    Downloading PDF → {filename}")
                r = requests.get(pdf_url, timeout=120, stream=True)
                r.raise_for_status()
                size = 0
                with open(pdf_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                        size += len(chunk)
                pdf_saved = True
                print(f"    ✓ Saved {size / 1024 / 1024:.1f} MB → OneDrive")
            except Exception as e:
                print(f"    ⚠ PDF download failed: {e}")
                if os.path.exists(pdf_path):
                    os.unlink(pdf_path)
    elif not os.path.isdir(pdf_dir):
        print(f"    ⚠ PDF dir not found: {pdf_dir}")

    # === Step 3: Create linked_file attachment in Zotero ===
    if pdf_saved and item_key:
        filename = make_zotero_filename(paper)
        # Convert WSL path to Windows path for Zotero desktop
        wsl_pdf_path = os.path.join(pdf_dir, filename)
        win_pdf_path = wsl_pdf_path  # Adjust path conversion for your OS
        
        attach_data = {
            "itemType": "attachment",
            "parentItem": item_key,
            "linkMode": "linked_file",
            "title": filename,
            "path": win_pdf_path,
            "contentType": "application/pdf",
            "tags": [],
            "relations": {},
        }
        try:
            zot.create_items([attach_data])
            print(f"    ✓ Linked file attachment created in Zotero")
        except Exception as e:
            print(f"    ⚠ Linked attachment failed: {e}")

    return {"key": item_key, "title": paper.get("title", ""), "pdf_saved": pdf_saved}


def push_batch(papers: list, collection_key: str = None, pdf_dir: str = None):
    """Push a batch of papers."""
    ck = collection_key or COLLECTION_KEY
    pd = pdf_dir or PDF_DIR
    if not ck:
        print("ERROR: No collection key."); sys.exit(1)
    if len(papers) > MAX_BATCH:
        print(f"ERROR: Batch {len(papers)} > limit {MAX_BATCH}."); sys.exit(1)

    est_mb = len(papers) * 3
    print(f"\n{'='*60}")
    print(f"Pushing {len(papers)} papers to Zotero")
    print(f"  Collection: {ck}")
    print(f"  PDF dir: {pd}")
    print(f"  Est. PDF storage: ~{est_mb} MB")
    print(f"{'='*60}\n")

    zot = get_zot()
    results = []
    for i, paper in enumerate(papers):
        print(f"[{i+1}/{len(papers)}] {paper.get('citekey', 'unknown')}")
        result = push_paper(zot, paper, ck, pd)
        results.append(result)
        if i < len(papers) - 1:
            time.sleep(1)

    ok = sum(1 for r in results if r["key"])
    pdfs = sum(1 for r in results if r["pdf_saved"])
    print(f"\n{'='*60}")
    print(f"Done: {ok}/{len(papers)} items created, {pdfs} PDFs saved to OneDrive")
    print(f"{'='*60}")
    print(f"\nNext steps:")
    print(f"  1. Open Zotero → collection 'web-agent_arxiv-s2' → verify items + PDFs")
    print(f"  2. /kb-sync → /kb-compile → /kb-deepen")
    return results


def parse_raw_file(path: str) -> dict:
    """Parse a raw/ markdown file into a paper dict."""
    text = Path(path).read_text()
    parts = text.split("---")
    if len(parts) < 3:
        return {}
    fm = parts[1]
    paper = {}
    for line in fm.splitlines():
        if ":" not in line: continue
        key, val = line.split(":", 1)
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key == "title": paper["title"] = val
        elif key == "citekey": paper["citekey"] = val
        elif key == "authors": paper["authors"] = [a.strip() for a in val.strip("[]").split(",")]
        elif key == "year": paper["year"] = val
        elif key == "doi": paper["doi"] = val
        elif key == "arxiv_id": paper["arxiv_id"] = val
        elif key == "url": paper["url"] = val
        elif key == "pdf_url": paper["pdf_url"] = val
        elif key in ("venue", "venue_name"): paper["venue"] = val
        elif key == "source_type": paper["source_type"] = val
    # Abstract
    for section in ("## Abstract", "## TLDR"):
        if section in text:
            paper["abstract"] = text.split(section)[1].strip().split("\n\n")[0].strip()
            break
    return paper


def main():
    parser = argparse.ArgumentParser(description="Push papers to Zotero + OneDrive")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--list-collections", action="store_true")
    parser.add_argument("--from-json", type=str)
    parser.add_argument("--from-raw", type=str, nargs="+")
    parser.add_argument("--collection", type=str, default=COLLECTION_KEY)
    parser.add_argument("--pdf-dir", type=str, default=PDF_DIR)
    args = parser.parse_args()

    if args.test:
        zot = get_zot()
        cols = zot.collections()
        target = [c for c in cols if c["key"] == args.collection]
        if target:
            print(f"✅ API connected. Collection: {target[0]['data']['name']} ({target[0]['meta']['numItems']} items)")
        else:
            print(f"✅ API connected. {len(cols)} collections (target key not found)")
        pdf_ok = os.path.isdir(args.pdf_dir)
        print(f"{'✅' if pdf_ok else '❌'} PDF dir: {args.pdf_dir}")
        return

    if args.list_collections:
        zot = get_zot()
        for c in sorted(zot.collections(), key=lambda x: x["data"]["name"]):
            print(f"  {c['data']['name']:40s}  [{c['key']}]  ({c['meta']['numItems']} items)")
        return

    if args.from_json:
        papers = json.loads(Path(args.from_json).read_text())
        push_batch(papers, args.collection, args.pdf_dir)
        return

    if args.from_raw:
        papers = [parse_raw_file(p) for p in args.from_raw if os.path.isfile(p)]
        papers = [p for p in papers if p.get("title")]
        if not papers:
            print("No valid papers found"); return
        push_batch(papers, args.collection, args.pdf_dir)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
