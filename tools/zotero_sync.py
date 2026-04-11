#!/usr/bin/env python3
"""
Zotero → raw/zotero/papers/ sync tool.

Two independent paths:
  1. Online: pyzotero local API (Zotero must be running on Windows host)
  2. Offline: import from Better BibTeX JSON / CSL JSON export file

Usage:
  python3 tools/zotero_sync.py                                    # online sync (full library)
  python3 tools/zotero_sync.py --collection "LLM Safety"          # sync one collection
  python3 tools/zotero_sync.py --list-collections                 # list available collections
  python3 tools/zotero_sync.py --offline export.json               # offline import
  python3 tools/zotero_sync.py --offline export.json --tag-collection "My Project"
  python3 tools/zotero_sync.py --status                            # show sync state
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "raw" / "zotero" / "papers"
KB_DIR = PROJECT_ROOT / ".kb"
SYNC_STATE = KB_DIR / "sync_state.json"


def slugify(text: str) -> str:
    """Convert text to kebab-case filename slug."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text[:80].rstrip("-")


def make_citekey(item: dict) -> str:
    """Generate citekey from item metadata: firstauthor+year+keyword."""
    creators = item.get("data", item).get("creators", [])
    first_author = ""
    for c in creators:
        if c.get("creatorType") == "author":
            first_author = c.get("lastName", c.get("name", "")).lower()
            break
    if not first_author and creators:
        first_author = creators[0].get("lastName", creators[0].get("name", "")).lower()

    year = ""
    date_str = item.get("data", item).get("date", "")
    match = re.search(r"(\d{4})", date_str)
    if match:
        year = match.group(1)

    title = item.get("data", item).get("title", "")
    keyword = slugify(title.split(":")[0])[:20].rstrip("-")

    return f"{first_author}{year}-{keyword}" if (first_author or year) else slugify(title)[:40]


def item_to_markdown(item: dict, annotations: list = None, collection_names: list = None) -> str:
    """Convert a Zotero item dict to structured markdown.

    Args:
        item: Zotero item dict (with or without "data" wrapper).
        annotations: Optional list of annotation dicts.
        collection_names: Optional list of human-readable collection names.
    """
    data = item.get("data", item)
    citekey = data.get("citationKey") or data.get("citekey") or make_citekey(item)

    # Extract metadata
    title = data.get("title", "Untitled")
    creators = data.get("creators", [])
    authors = []
    for c in creators:
        name = c.get("name") or f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
        if name:
            authors.append(name)

    year = ""
    date_str = data.get("date", "")
    match = re.search(r"(\d{4})", date_str)
    if match:
        year = match.group(1)

    journal = data.get("publicationTitle") or data.get("proceedingsTitle") or data.get("bookTitle") or ""
    doi = data.get("DOI", "")
    abstract = data.get("abstractNote", "")
    tags = [t.get("tag", "") for t in data.get("tags", []) if t.get("tag")]
    item_type = data.get("itemType", "")
    zotero_key = data.get("key", item.get("key", ""))
    url = data.get("url", "")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Build frontmatter
    lines = [
        "---",
        f'citekey: "{citekey}"',
        f'title: "{title}"',
        f"authors: [{', '.join(authors)}]",
    ]
    if year:
        lines.append(f"year: {year}")
    if journal:
        lines.append(f'journal: "{journal}"')
    if doi:
        lines.append(f'doi: "{doi}"')
    if tags:
        lines.append(f"tags: [{', '.join(tags)}]")
    if collection_names:
        lines.append(f"collections: [{', '.join(collection_names)}]")
    if zotero_key:
        lines.append(f'zotero_key: "{zotero_key}"')
    if item_type:
        lines.append(f'item_type: "{item_type}"')
    if url:
        lines.append(f'url: "{url}"')
    lines.append(f"date_synced: {now}")
    lines.append("---")
    lines.append("")

    # Abstract
    if abstract:
        lines.append("## Abstract")
        lines.append("")
        lines.append(abstract)
        lines.append("")

    # Annotations
    if annotations:
        lines.append("## Annotations")
        lines.append("")
        for ann in annotations:
            ann_data = ann.get("data", ann)
            ann_type = ann_data.get("annotationType", "")
            text = ann_data.get("annotationText", "")
            comment = ann_data.get("annotationComment", "")
            page = ann_data.get("annotationPageLabel", "")
            color = ann_data.get("annotationColor", "")

            if text:
                page_str = f" (p.{page})" if page else ""
                color_str = f", {color}" if color else ""
                lines.append(f"> \"{text}\"{page_str} [{ann_type}{color_str}]")
                if comment:
                    lines.append(f"> **Comment**: {comment}")
                lines.append("")
        lines.append("")

    return "\n".join(lines)


def _update_collections_field(filepath: Path, collection_name: str) -> bool:
    """Add a collection name to an existing raw file's collections: field.

    Returns True if the file was modified, False if already present or error.
    """
    text = filepath.read_text(encoding="utf-8")

    # Check if already has this collection
    coll_match = re.search(r"^collections:\s*\[(.+)\]", text, re.MULTILINE)
    if coll_match:
        existing = [c.strip() for c in coll_match.group(1).split(",")]
        if collection_name in existing:
            return False
        existing.append(collection_name)
        new_line = f"collections: [{', '.join(existing)}]"
        text = text[:coll_match.start()] + new_line + text[coll_match.end():]
    else:
        # Insert collections: line before zotero_key or date_synced
        insert_match = re.search(r"^(zotero_key:|date_synced:)", text, re.MULTILINE)
        if insert_match:
            new_line = f"collections: [{collection_name}]\n"
            text = text[:insert_match.start()] + new_line + text[insert_match.start():]
        else:
            # Fallback: insert before closing ---
            text = text.replace("\n---\n", f"\ncollections: [{collection_name}]\n---\n", 1)

    filepath.write_text(text, encoding="utf-8")
    return True


def detect_wsl2_host_ip() -> str:
    """Detect Windows host IP from WSL2."""
    # Method 1: /etc/resolv.conf (works on default NAT mode)
    try:
        with open("/etc/resolv.conf") as f:
            for line in f:
                if line.strip().startswith("nameserver"):
                    ip = line.strip().split()[-1]
                    if ip and ip != "127.0.0.1":
                        return ip
    except FileNotFoundError:
        pass

    # Method 2: mirrored mode → localhost works
    return "127.0.0.1"


def _create_zotero_client(library_id: str = None, api_key: str = None):
    """Create and configure a pyzotero client. Returns (zot, error_dict)."""
    try:
        from pyzotero import zotero
    except ImportError:
        print("ERROR: pyzotero not installed. Run: pip install pyzotero", file=sys.stderr)
        return None, {"status": "error", "message": "pyzotero not installed"}

    host_ip = detect_wsl2_host_ip()
    print(f"Attempting Zotero local API at {host_ip}:23119 ...")

    try:
        zot = zotero.Zotero(library_id or "0", "user", api_key or "", local=True)
        if host_ip != "127.0.0.1":
            zot.local_base = f"http://{host_ip}:23119/api"
        return zot, None
    except Exception as e:
        print(f"Local API failed: {e}", file=sys.stderr)
        return None, {"status": "error", "message": str(e)}


def list_collections(library_id: str = None, api_key: str = None) -> dict:
    """List all Zotero collections with name, key, and item count."""
    zot, err = _create_zotero_client(library_id, api_key)
    if err:
        return err

    try:
        collections = zot.collections(limit=500)
    except Exception as e:
        print(f"Failed to fetch collections: {e}", file=sys.stderr)
        return {"status": "error", "message": str(e)}

    print(f"\nFound {len(collections)} collections:\n")
    for coll in collections:
        cdata = coll.get("data", coll)
        name = cdata.get("name", "???")
        key = cdata.get("key", "")
        num = cdata.get("numItems", "?")
        print(f"  {name:<40} ({num} items)  [key: {key}]")

    return {"status": "ok", "count": len(collections)}


def resolve_collection(zot, name: str) -> tuple:
    """Resolve a collection name to (key, canonical_name).

    Case-insensitive exact match first, then substring match with suggestions.
    Returns (key, canonical_name) or raises ValueError.
    """
    collections = zot.collections(limit=500)
    name_lower = name.lower()

    # Exact case-insensitive match
    for coll in collections:
        cdata = coll.get("data", coll)
        cname = cdata.get("name", "")
        if cname.lower() == name_lower:
            return cdata["key"], cname

    # Substring match for suggestions
    matches = []
    for coll in collections:
        cdata = coll.get("data", coll)
        cname = cdata.get("name", "")
        if name_lower in cname.lower():
            matches.append(cname)

    if matches:
        suggestions = ", ".join(f'"{m}"' for m in matches[:5])
        raise ValueError(f"Collection \"{name}\" not found. Did you mean: {suggestions}?")
    else:
        raise ValueError(f"Collection \"{name}\" not found. Use --list-collections to see available collections.")


def _load_state() -> dict:
    """Load sync state from disk."""
    if SYNC_STATE.exists():
        return json.loads(SYNC_STATE.read_text())
    return {}


def _save_state(state: dict):
    """Write sync state to disk."""
    KB_DIR.mkdir(parents=True, exist_ok=True)
    SYNC_STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def _update_collection_state(state: dict, collection_name: str, coll_key: str, item_keys: list):
    """Update per-collection tracking in sync state."""
    now = datetime.now(timezone.utc).isoformat()
    collections = state.setdefault("collections", {})
    if collection_name in collections:
        coll_state = collections[collection_name]
        coll_state["last_synced"] = now
        existing_keys = set(coll_state.get("item_keys", []))
        existing_keys.update(item_keys)
        coll_state["item_keys"] = list(existing_keys)
        coll_state["item_count"] = len(coll_state["item_keys"])
    else:
        collections[collection_name] = {
            "zotero_key": coll_key,
            "first_synced": now,
            "last_synced": now,
            "item_keys": item_keys,
            "item_count": len(item_keys),
        }


def _resolve_collections_recursive(zot, coll_key: str, coll_name: str) -> list:
    """Return [(key, name), ...] for a collection and all its sub-collections."""
    result = [(coll_key, coll_name)]
    try:
        subs = zot.collections_sub(coll_key)
        for sub in subs:
            sdata = sub.get("data", sub)
            sub_key = sdata.get("key", "")
            sub_name = sdata.get("name", "")
            if sub_key:
                result.extend(_resolve_collections_recursive(zot, sub_key, sub_name))
    except Exception as e:
        print(f"  Warning: could not fetch sub-collections of \"{coll_name}\": {e}", file=sys.stderr)
    return result


def _sync_collection_items(zot, coll_key: str, coll_name: str,
                           state: dict, synced_keys: set, stats: dict):
    """Sync items from a single collection. Mutates state, synced_keys, stats in place."""
    try:
        items = zot.everything(zot.collection_items_top(coll_key))
        print(f"\n  Collection \"{coll_name}\": {len(items)} items")
    except Exception as e:
        print(f"  ! Failed to fetch \"{coll_name}\": {e}", file=sys.stderr)
        stats["errors"] += 1
        return

    coll_item_keys = []

    for item in items:
        data = item.get("data", item)
        key = data.get("key", "")
        item_type = data.get("itemType", "")

        if item_type in ("attachment", "annotation", "note", "linkMode"):
            continue

        if key in synced_keys:
            citekey = data.get("citationKey") or make_citekey(item)
            filename = f"{slugify(citekey)}.md"
            filepath = RAW_DIR / filename
            if filepath.exists() and _update_collections_field(filepath, coll_name):
                stats["updated"] += 1
                print(f"    ~ {filename} (added to \"{coll_name}\")")
            else:
                stats["skipped"] += 1
            coll_item_keys.append(key)
            continue

        try:
            annotations = []
            try:
                children = zot.children(key)
                for child in children:
                    child_data = child.get("data", child)
                    if child_data.get("itemType") == "attachment":
                        att_key = child_data.get("key", "")
                        if att_key:
                            att_children = zot.children(att_key)
                            annotations.extend(
                                c for c in att_children
                                if c.get("data", c).get("itemType") == "annotation"
                            )
                    elif child_data.get("itemType") == "annotation":
                        annotations.append(child)
            except Exception:
                pass

            md = item_to_markdown(item, annotations, collection_names=[coll_name])
            citekey = data.get("citationKey") or make_citekey(item)
            filename = f"{slugify(citekey)}.md"
            filepath = RAW_DIR / filename
            filepath.write_text(md, encoding="utf-8")

            synced_keys.add(key)
            coll_item_keys.append(key)
            stats["new"] += 1
            print(f"    + {filename}")
        except Exception as e:
            stats["errors"] += 1
            print(f"    ! Error syncing {key}: {e}", file=sys.stderr)

    _update_collection_state(state, coll_name, coll_key, coll_item_keys)


def sync_online(library_id: str = None, api_key: str = None,
                collection_name: str = None, recursive: bool = False) -> dict:
    """Sync via pyzotero local API.

    Args:
        library_id: Zotero library ID.
        api_key: Zotero API key.
        collection_name: If set, sync only items from this collection.
        recursive: If True, also sync all sub-collections.
    """
    zot, err = _create_zotero_client(library_id, api_key)
    if err:
        return err

    # Resolve collection if specified
    if collection_name:
        try:
            coll_key, coll_canonical = resolve_collection(zot, collection_name)
        except ValueError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return {"status": "error", "message": str(e)}

        if recursive:
            targets = _resolve_collections_recursive(zot, coll_key, coll_canonical)
            print(f"Syncing \"{coll_canonical}\" + {len(targets) - 1} sub-collections ({len(targets)} total)")
        else:
            targets = [(coll_key, coll_canonical)]
            print(f"Syncing collection: \"{coll_canonical}\" (key: {coll_key})")

        state = _load_state()
        synced_keys = set(state.get("synced_keys", []))
        stats = {"new": 0, "skipped": 0, "updated": 0, "errors": 0}

        for c_key, c_name in targets:
            _sync_collection_items(zot, c_key, c_name, state, synced_keys, stats)

        state["synced_keys"] = list(synced_keys)
        state["last_sync"] = datetime.now(timezone.utc).isoformat()
        state["last_mode"] = "online"
        _save_state(state)

    else:
        # Full library sync (no collection filter)
        try:
            items = zot.everything(zot.top)
            print(f"Found {len(items)} top-level items in Zotero library.")
        except Exception as e:
            print(f"Local API failed: {e}", file=sys.stderr)
            print("Try offline mode: python3 tools/zotero_sync.py --offline <export.json>", file=sys.stderr)
            return {"status": "error", "message": str(e)}

        state = _load_state()
        synced_keys = set(state.get("synced_keys", []))
        stats = {"new": 0, "skipped": 0, "updated": 0, "errors": 0}

        for item in items:
            data = item.get("data", item)
            key = data.get("key", "")
            item_type = data.get("itemType", "")

            if item_type in ("attachment", "annotation", "note", "linkMode"):
                continue
            if key in synced_keys:
                stats["skipped"] += 1
                continue

            try:
                annotations = []
                try:
                    children = zot.children(key)
                    for child in children:
                        child_data = child.get("data", child)
                        if child_data.get("itemType") == "attachment":
                            att_key = child_data.get("key", "")
                            if att_key:
                                att_children = zot.children(att_key)
                                annotations.extend(
                                    c for c in att_children
                                    if c.get("data", c).get("itemType") == "annotation"
                                )
                        elif child_data.get("itemType") == "annotation":
                            annotations.append(child)
                except Exception:
                    pass

                md = item_to_markdown(item, annotations)
                citekey = data.get("citationKey") or make_citekey(item)
                filename = f"{slugify(citekey)}.md"
                filepath = RAW_DIR / filename
                filepath.write_text(md, encoding="utf-8")

                synced_keys.add(key)
                stats["new"] += 1
                print(f"  + {filename}")
            except Exception as e:
                stats["errors"] += 1
                print(f"  ! Error syncing {key}: {e}", file=sys.stderr)

        state["synced_keys"] = list(synced_keys)
        state["last_sync"] = datetime.now(timezone.utc).isoformat()
        state["last_mode"] = "online"
        _save_state(state)

    parts = [f"{stats['new']} new", f"{stats['skipped']} skipped"]
    if stats["updated"]:
        parts.append(f"{stats['updated']} updated")
    parts.append(f"{stats['errors']} errors")
    print(f"\nSync complete: {', '.join(parts)}")
    return {"status": "ok", **stats}


def sync_offline(json_path: str, collection_name: str = None) -> dict:
    """Import from Better BibTeX JSON / CSL JSON export file.

    Args:
        json_path: Path to the JSON export file.
        collection_name: If set, tag all imported items with this collection name.
    """
    path = Path(json_path)
    if not path.exists():
        print(f"ERROR: File not found: {json_path}", file=sys.stderr)
        return {"status": "error", "message": "file not found"}

    data = json.loads(path.read_text(encoding="utf-8"))

    # Detect format: BBT JSON has "items" array, CSL JSON is an array
    if isinstance(data, list):
        items = data  # CSL JSON
    elif isinstance(data, dict) and "items" in data:
        items = data["items"]  # BBT JSON
    else:
        print("ERROR: Unrecognized JSON format. Expected CSL JSON array or BBT JSON with 'items'.", file=sys.stderr)
        return {"status": "error", "message": "unrecognized format"}

    state = _load_state()
    synced_keys = set(state.get("synced_keys", []))
    stats = {"new": 0, "skipped": 0, "updated": 0, "errors": 0}
    coll_names = [collection_name] if collection_name else None
    coll_item_keys = []

    for item in items:
        # Normalize: CSL JSON uses "id", BBT uses "citationKey" or "citekey"
        key = item.get("id") or item.get("citationKey") or item.get("citekey") or item.get("key", "")
        item_type = item.get("itemType") or item.get("type", "")

        if item_type in ("attachment", "annotation", "note"):
            continue

        str_key = str(key)

        if str_key in synced_keys:
            # Already synced — update collections field if tagging
            if collection_name:
                wrapped = item if "data" in item else {"data": item}
                citekey = item.get("citationKey") or item.get("citekey") or item.get("citation-key") or make_citekey(wrapped)
                filename = f"{slugify(str(citekey))}.md"
                filepath = RAW_DIR / filename
                if filepath.exists() and _update_collections_field(filepath, collection_name):
                    stats["updated"] += 1
                    print(f"  ~ {filename} (added to collection \"{collection_name}\")")
                else:
                    stats["skipped"] += 1
                coll_item_keys.append(str_key)
            else:
                stats["skipped"] += 1
            continue

        try:
            # Wrap in "data" format if needed (CSL JSON is flat)
            wrapped = item if "data" in item else {"data": item}
            md = item_to_markdown(wrapped, collection_names=coll_names)
            citekey = item.get("citationKey") or item.get("citekey") or item.get("citation-key") or make_citekey(wrapped)
            filename = f"{slugify(str(citekey))}.md"
            filepath = RAW_DIR / filename
            filepath.write_text(md, encoding="utf-8")

            synced_keys.add(str_key)
            coll_item_keys.append(str_key)
            stats["new"] += 1
            print(f"  + {filename}")
        except Exception as e:
            stats["errors"] += 1
            print(f"  ! Error importing {key}: {e}", file=sys.stderr)

    state["synced_keys"] = list(synced_keys)
    state["last_sync"] = datetime.now(timezone.utc).isoformat()
    state["last_mode"] = "offline"
    state["last_file"] = str(path.resolve())
    if collection_name:
        # Use empty key for offline collections (no Zotero key available)
        _update_collection_state(state, collection_name, "", coll_item_keys)
    _save_state(state)

    parts = [f"{stats['new']} new", f"{stats['skipped']} skipped"]
    if stats["updated"]:
        parts.append(f"{stats['updated']} updated")
    parts.append(f"{stats['errors']} errors")
    print(f"\nImport complete: {', '.join(parts)}")
    return {"status": "ok", **stats}


ZOTERO_DB = Path("/path/to/your/zotero.sqlite")
ZOTERO_ATTACHMENT_BASE = Path("/path/to/your/zotero/storage")


def show_pdf_paths():
    """Output JSON mapping of citekey -> local PDF path by querying Zotero SQLite."""
    import sqlite3

    if not ZOTERO_DB.exists():
        print(json.dumps({"error": f"Zotero database not found: {ZOTERO_DB}"}))
        return

    db = sqlite3.connect(str(ZOTERO_DB))
    cur = db.cursor()

    # Build mapping: zotero_key (from raw files) -> citekey
    key_to_citekey: dict[str, str] = {}
    if RAW_DIR.exists():
        for f in RAW_DIR.glob("*.md"):
            text = f.read_text(errors="replace")
            m_ck = re.search(r'^citekey:\s*"?([^"\n]+)"?', text, re.MULTILINE)
            m_zk = re.search(r'^zotero_key:\s*"?([^"\n]+)"?', text, re.MULTILINE)
            if m_ck and m_zk:
                key_to_citekey[m_zk.group(1).strip()] = m_ck.group(1).strip()

    result: dict[str, str] = {}
    for zotero_key, citekey in key_to_citekey.items():
        cur.execute("SELECT itemID FROM items WHERE key = ?", (zotero_key,))
        row = cur.fetchone()
        if not row:
            continue
        parent_id = row[0]
        cur.execute(
            "SELECT ia.path FROM itemAttachments ia "
            "JOIN items i ON ia.itemID = i.itemID "
            "WHERE ia.parentItemID = ? AND ia.contentType = 'application/pdf'",
            (parent_id,),
        )
        for (att_path,) in cur.fetchall():
            if att_path and att_path.startswith("attachments:"):
                rel = att_path[len("attachments:"):]
                full = ZOTERO_ATTACHMENT_BASE / rel
                if full.exists():
                    result[citekey] = str(full)
                    break
            elif att_path and att_path.startswith("storage:"):
                rel = att_path[len("storage:"):]
                # Standard Zotero storage layout
                full = Path("/path/to/your/zotero/storage") / zotero_key / rel
                if full.exists():
                    result[citekey] = str(full)
                    break

    db.close()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\n# Found {len(result)} PDFs out of {len(key_to_citekey)} synced papers", file=sys.stderr)


def show_status():
    """Show current sync state, including per-collection stats."""
    if not SYNC_STATE.exists():
        print("No sync state found. Run sync first.")
        return

    state = json.loads(SYNC_STATE.read_text())
    print(f"Last sync: {state.get('last_sync', 'never')}")
    print(f"Mode: {state.get('last_mode', 'unknown')}")
    print(f"Synced items: {len(state.get('synced_keys', []))}")

    paper_count = len(list(RAW_DIR.glob("*.md"))) if RAW_DIR.exists() else 0
    print(f"Papers in raw/zotero/papers/: {paper_count}")

    collections = state.get("collections", {})
    if collections:
        print(f"\nCollections ({len(collections)}):")
        for name, cdata in sorted(collections.items()):
            count = cdata.get("item_count", 0)
            last = cdata.get("last_synced", "never")
            print(f"  {name:<40} {count} items  (last synced: {last})")


def main():
    parser = argparse.ArgumentParser(description="Sync Zotero library to raw/zotero/papers/")
    parser.add_argument("--offline", metavar="JSON_FILE", help="Import from BBT/CSL JSON export file")
    parser.add_argument("--status", action="store_true", help="Show sync state")
    parser.add_argument("--collection", metavar="NAME", help="Sync only items from this Zotero collection (online mode)")
    parser.add_argument("--list-collections", action="store_true", help="List all Zotero collections")
    parser.add_argument("--recursive", action="store_true", help="Include sub-collections when using --collection")
    parser.add_argument("--tag-collection", metavar="NAME", help="Tag offline-imported items with this collection name")
    parser.add_argument("--pdf-paths", action="store_true",
                        help="Output JSON mapping of citekey -> local PDF path (reads Zotero SQLite)")
    parser.add_argument("--library-id", default="0", help="Zotero library ID (default: 0 for local)")
    parser.add_argument("--api-key", default="", help="Zotero API key (not needed for local)")
    args = parser.parse_args()

    # Validate flag combinations
    if args.collection and args.offline:
        parser.error("--collection is for online mode only. Use --tag-collection with --offline.")
    if args.tag_collection and not args.offline:
        parser.error("--tag-collection requires --offline.")
    if args.recursive and not args.collection:
        parser.error("--recursive requires --collection.")

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if args.pdf_paths:
        show_pdf_paths()
    elif args.status:
        show_status()
    elif args.list_collections:
        list_collections(args.library_id, args.api_key)
    elif args.offline:
        sync_offline(args.offline, collection_name=args.tag_collection)
    else:
        sync_online(args.library_id, args.api_key, collection_name=args.collection,
                    recursive=args.recursive)


if __name__ == "__main__":
    main()
