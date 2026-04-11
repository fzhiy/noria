# Juggl Graph Visual Guide

> Visual styling scheme and usage instructions for NORIA's knowledge graph.
> CSS file: `wiki/.obsidian/plugins/juggl/graph.css`

---

## Color Legend

### Layer 1: Page Type (background color + shape)

| Type | Color | Shape | Description |
|------|-------|-------|-------------|
| **Source** | Blue `#4a90d9` | Ellipse | Paper source pages (most numerous) |
| **Concept** | Green `#50b848` | Rounded rectangle | Concept pages (middle layer, linking multiple sources) |
| **Synthesis** | Orange `#f5834b` | Diamond (enlarged) | Synthesis pages (top layer, cross-concept bridges) |

### Layer 2: Provenance Trust Level (border)

| Provenance | Border Color | Style | Meaning |
|------------|-------------|-------|---------|
| **user-verified** | Gold `#f1c40f` | Solid 3px | Manually confirmed by user, highest trust |
| **source-derived** | Green `#2d8a4e` | Solid 2px | Directly extracted from academic papers |
| **llm-derived** | Gray `#888888` | Solid 2px | LLM-synthesized across multiple sources |
| **social-lead** | Red `#e74c3c` | Dashed 3px | Social media / grey literature, low trust |

### Layer 3: Research Domain (source page color tint)

| Domain | Color | Description |
|--------|-------|-------------|
| **agent** | Blue `#4a90d9` | Web/GUI agents (default blue) |
| **benchmark** | Light blue `#3498db` | Evaluation benchmarks |
| **drift** | Purple `#8e44ad` | UI/workflow drift |
| **peft** | Teal `#1abc9c` | Parameter-efficient fine-tuning |
| **foundational** | Gray `#95a5a6` | Foundational theory (continual learning, etc.) |

### Layer 4: Venue Tier (label style)

| Venue Tier | Effect |
|------------|--------|
| **top-conf** / **top-journal** | Bold label text |
| Other | Default style |

### Special States

| State | Color | Shape | Description |
|-------|-------|-------|-------------|
| **Dangling** | Light gray `#bdc3c7` | Tag shape + dotted border | Unresolved reference (target page does not exist) |
| **MOC** | Dark orange `#e67e22` | Enlarged rounded rectangle | Map of Content navigation page |

---

## Quick Reading Guide

When viewing a node, decode in this order:

1. **Shape** — Identify page type (ellipse = paper, rectangle = concept, diamond = synthesis)
2. **Border** — Assess trust level (gold = human-verified, green = source-derived, red dashed = social media)
3. **Background tint** — Identify research domain (purple = drift, teal = PEFT, blue = agent)
4. **Label weight** — Check venue tier (bold = top-conf/top-journal)

---

## Layout Switching

Juggl supports multiple layouts, selectable from the graph view toolbar:

| Layout | Best For |
|--------|----------|
| **fdgd** (default) | Exploring overall structure, discovering community clusters |
| **dagre** | Viewing synthesis → concept → source hierarchy |
| **circle** | Highlighting hub nodes (highly-connected concepts) |
| **grid** | Flat browsing of all nodes |

### Embedding Local Graphs in Markdown

Use a Juggl code block in any `.md` file to create a local graph:

````markdown
```juggl
layout: dagre
local: true
depth: 2
```
````

This shows a 2-depth neighborhood centered on the current page, using the Dagre hierarchical layout.

---

## Customization

The CSS file is at `wiki/.obsidian/plugins/juggl/graph.css`. Changes take effect immediately in Juggl (no Obsidian restart needed).

Syntax reference: [Cytoscape.js Style](https://js.cytoscape.org/#style) | [Juggl CSS Styling](https://juggl.io/features/styling/css-styling)

Common selectors:
- `node[type = "source"]` — match by frontmatter field
- `node.tag-xxx` — match by tag value
- `node.dangling` — Juggl built-in class
- `edge` — all edges
