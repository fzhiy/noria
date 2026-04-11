#!/usr/bin/env python3
# WARNING: Scweet uses cookie-based authentication to access Twitter/X.
# Users are responsible for complying with Twitter/X Terms of Service.
# Consider using the official Twitter API v2 for production use.

"""Scweet bridge for twitter-ingest.ts — search and profile timeline scraping.

Called as subprocess by TypeScript. Outputs JSON to stdout.

Usage:
  python3 tools/twitter-scweet-bridge.py search "web agent" --since 2026-03-01 --limit 20 --min-likes 10
  python3 tools/twitter-scweet-bridge.py profile karpathy --limit 10
  python3 tools/twitter-scweet-bridge.py setup --cookies tools/.twitter-cookies.txt
  python3 tools/twitter-scweet-bridge.py status
"""
import argparse, json, os, sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = str(PROJECT_ROOT / ".kb" / "scweet_state.db")
CONFIG_PATH = PROJECT_ROOT / "tools" / "twitter-curated-accounts.json"


def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def get_scweet():
    """Create Scweet instance with project config."""
    from Scweet import Scweet, ScweetConfig
    config = load_config()
    sc_cfg = config.get("scweet", {})
    sw_config = ScweetConfig(
        db_path=sc_cfg.get("db_path", DB_PATH),
        daily_tweets_limit=sc_cfg.get("daily_tweets_limit", 600),
        daily_requests_limit=sc_cfg.get("daily_requests_limit", 100),
        min_delay_s=sc_cfg.get("min_delay_s", 3.0),
        save_dir=sc_cfg.get("save_dir", "/tmp/scweet-output"),
        save_format="csv",
    )
    return Scweet(db_path=sc_cfg.get("db_path", DB_PATH), config=sw_config)


def cmd_setup(args):
    """Import account from cookies file."""
    from Scweet.db import ScweetDB
    db = ScweetDB(DB_PATH)
    cookies_path = args.cookies
    if not os.path.exists(cookies_path):
        print(json.dumps({"error": f"Cookies file not found: {cookies_path}"}))
        sys.exit(1)
    db.import_accounts_from_sources(cookies_file=cookies_path)
    accounts = db.list_accounts()
    print(json.dumps({
        "status": "ok",
        "accounts": len(accounts),
        "message": f"Imported from {cookies_path}. {len(accounts)} account(s) available."
    }))


def cmd_status(args):
    """Show account pool status."""
    from Scweet.db import ScweetDB
    if not os.path.exists(DB_PATH):
        print(json.dumps({"status": "no_db", "accounts": 0, "message": "No Scweet DB. Run: python3 tools/twitter-scweet-bridge.py setup --cookies <path>"}))
        return
    db = ScweetDB(DB_PATH)
    accounts = db.list_accounts()
    summary = db.accounts_summary()
    print(json.dumps({
        "status": "ok",
        "accounts": len(accounts),
        "summary": str(summary),
    }))


def tweets_to_json(tweets):
    """Convert Scweet tweet dicts to clean JSON-serializable dicts."""
    results = []
    for t in tweets:
        # Scweet returns plain dicts
        raw = dict(t) if isinstance(t, dict) else (t.__dict__ if hasattr(t, "__dict__") else {"raw": str(t)})

        d = {}
        # Flatten user → username
        user = raw.get("user")
        if isinstance(user, dict):
            d["username"] = user.get("screen_name", user.get("name", "unknown"))
            d["user_display_name"] = user.get("name", "")
        elif isinstance(user, str):
            d["username"] = user

        # Copy standard fields
        d["id"] = str(raw.get("tweet_id", ""))
        d["text"] = raw.get("text", "")
        d["created_at"] = raw.get("timestamp", "")
        d["likes"] = raw.get("likes", 0)
        d["retweets"] = raw.get("retweets", 0)
        d["replies"] = raw.get("comments", 0)
        d["url"] = raw.get("tweet_url", "")
        d["embedded_text"] = raw.get("embedded_text", "")

        # Ensure all values are JSON-safe
        for k, v in d.items():
            if not isinstance(v, (int, float, bool, str, list, type(None))):
                d[k] = str(v)

        results.append(d)
    return results


def cmd_search(args):
    """Search tweets by keyword."""
    sw = get_scweet()
    kwargs = {"query": args.query, "limit": args.limit, "lang": "en"}
    if args.since:
        kwargs["since"] = args.since
    if args.until:
        kwargs["until"] = args.until
    if args.min_likes:
        kwargs["min_likes"] = args.min_likes
    if args.has_links:
        kwargs["has_links"] = True

    try:
        tweets = sw.search(**kwargs)
        results = tweets_to_json(tweets)
        print(json.dumps({"status": "ok", "count": len(results), "tweets": results}))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


def cmd_profile(args):
    """Get recent tweets from a specific user."""
    sw = get_scweet()
    try:
        tweets = sw.get_profile_tweets(users=[args.handle], limit=args.limit)
        results = tweets_to_json(tweets)
        print(json.dumps({"status": "ok", "count": len(results), "tweets": results}))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Scweet bridge for twitter-ingest.ts")
    sub = parser.add_subparsers(dest="command")

    p_setup = sub.add_parser("setup")
    p_setup.add_argument("--cookies", required=True, help="Path to cookies.txt from browser")

    sub.add_parser("status")

    p_search = sub.add_parser("search")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--since", help="Start date YYYY-MM-DD")
    p_search.add_argument("--until", help="End date YYYY-MM-DD")
    p_search.add_argument("--limit", type=int, default=20)
    p_search.add_argument("--min-likes", type=int, default=None)
    p_search.add_argument("--has-links", action="store_true")

    p_profile = sub.add_parser("profile")
    p_profile.add_argument("handle", help="Twitter handle (without @)")
    p_profile.add_argument("--limit", type=int, default=10)

    args = parser.parse_args()
    if args.command == "setup":
        cmd_setup(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "profile":
        cmd_profile(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
