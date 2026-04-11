#!/usr/bin/env python3

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def template_root() -> Path:
    return repo_root() / "templates" / "llm-wiki-agent"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Copy the llm-wiki-agent starter into a target repo.")
    parser.add_argument("target")
    parser.add_argument("--force", action="store_true")
    return parser


def copy_tree(src: Path, dst: Path, force: bool) -> None:
    for item in sorted(src.rglob("*")):
        relative = item.relative_to(src)
        target = dst / relative
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not force:
            raise SystemExit(f"Refusing to overwrite existing file without --force: {target}")
        shutil.copy2(item, target)


def main() -> int:
    args = build_parser().parse_args()
    dst = Path(args.target).expanduser().resolve()
    dst.mkdir(parents=True, exist_ok=True)
    copy_tree(template_root(), dst, args.force)
    print(f"Copied llm-wiki-agent starter into {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
