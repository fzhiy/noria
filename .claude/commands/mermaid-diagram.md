---
name: mermaid-diagram
description: Generate Mermaid diagrams for this repository's architecture and workflows. Use when documenting KB pipelines, provenance flow, or tool interactions.
argument-hint: [diagram description]
allowed-tools: Bash(*), Read, Grep, Glob, Write, Edit
---

# Mermaid Diagram

Generate a Mermaid diagram for the current repository.

## Repo Defaults

- Save outputs to `outputs/reviews/figures/`
- Prefer architecture, flowchart, sequence, ER, and mindmap diagrams
- Keep diagrams readable in GitHub markdown and Obsidian

## Workflow

1. Understand the requested flow or structure.
2. Read the relevant repo docs and code before drawing.
3. Write both:
   - `outputs/reviews/figures/<name>.mmd`
   - `outputs/reviews/figures/<name>.md`
4. If Mermaid CLI is available, render a PNG for verification.
5. Verify that arrows, labels, and grouping match the repository reality.

## Rules

- Prefer clean left-to-right flow for pipelines.
- Use labels that match repo file names and command names.
- Do not invent components that do not exist.
