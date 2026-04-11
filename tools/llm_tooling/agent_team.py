#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def agent_manifest() -> dict:
    return load_json(repo_root() / ".llm" / "agent-team.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect and plan the repo-local multi-model agent team.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor", help="Show the configured agent team.")
    subparsers.add_parser("list-projects", help="List project ids and labels.")
    plan_parser = subparsers.add_parser("plan-batch", help="Render a batch plan for a project and goal.")
    plan_parser.add_argument("--project", required=True)
    plan_parser.add_argument("--goal", required=True)
    return parser


def print_doctor() -> int:
    manifest = agent_manifest()
    print(f"Control plane: {manifest['controlPlane']['agent']} ({manifest['controlPlane']['policy']})")
    print("")
    print("Projects:")
    for project_id, project in manifest.get("projects", {}).items():
        print(f"- {project_id}: {project['label']}")
    return 0


def print_batch(project_id: str, goal: str) -> int:
    manifest = agent_manifest()
    project = manifest["projects"][project_id]
    print(f"# Agent Team Batch Plan: {project['label']}")
    print("")
    print(f"- Goal: `{goal}`")
    print(f"- Collections: {', '.join(project.get('collections', []))}")
    print(f"- Lead: `{manifest['taskRouting'][goal]['lead']}`")
    support = manifest["taskRouting"][goal].get("support", [])
    print(f"- Support: {', '.join(f'`{item}`' for item in support) or 'none'}")
    return 0


def main() -> int:
    args = build_parser().parse_args()
    manifest = agent_manifest()
    if args.command == "doctor":
        return print_doctor()
    if args.command == "list-projects":
        for project_id, project in manifest.get("projects", {}).items():
            print(f"{project_id}\t{project['label']}")
        return 0
    return print_batch(args.project, args.goal)


if __name__ == "__main__":
    raise SystemExit(main())
