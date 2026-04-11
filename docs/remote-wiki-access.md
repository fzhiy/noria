# Remote Wiki Access — NORIA MCP Server

This document explains how to give remote Claude Code instances real-time
search access to the NORIA knowledge base, and how remote feedback flows
back for triage.

## Canonical Serving Path

**`tools/noria-mcp-server.py`** — lightweight Python HTTP server, zero ML
dependencies. Chosen over QMD MCP because QMD's CPU-mode embedding model
causes 4+ minute startup timeouts on remote connections.

The server exposes three MCP tools:

| Tool | Description |
|------|-------------|
| `search` | Keyword search across all wiki sources, concepts, and syntheses |
| `get` | Retrieve full wiki page by relative path |
| `submit_feedback` | Append-only feedback ingestion (gap/accuracy/insight) |

**Security**: Server binds `127.0.0.1` only. Remote access via SSH reverse
tunnel. `submit_feedback` is append-only — writes only to `outputs/queries/`,
never to `wiki/`, `raw/`, or `.kb/`.

## Feedback Flow

```
Remote query → search/get → answer
    ↓ (if feedback)
submit_feedback → outputs/queries/<timestamp>-remote-<slug>.md
    ↓ (periodic)
kb-feedback-triage.ts → outputs/reviews/<date>-feedback-triage.md
    ↓ (human review)
Claude updates wiki/ based on raw/ (provenance preserved)
```

Feedback is `query-derived` — it NEVER enters `wiki/` directly. See
`docs/feedback-loop-design.md` for architectural rationale.

## Setup

### On the wiki host (WSL2)

```bash
cd /path/to/noria

# Start server + SSH reverse tunnel
./tools/serve-remote.sh [remote-user@host] [port]

# Or manually:
python3 tools/noria-mcp-server.py 3849 wiki &
ssh -R 3849:localhost:3849 -N -o ServerAliveInterval=60 user@your-remote-host
```

### On the remote machine

Configure `.mcp.json` in the remote project:

```json
{
  "mcpServers": {
    "noria": {
      "command": "bash",
      "args": [
        "-c",
        "source ~/.nvm/nvm.sh && nvm use 22 && npx -y mcp-remote http://localhost:3849/mcp"
      ]
    }
  }
}
```

**Note**: Remote defaults to Node.js v12 — the `nvm use 22` wrapper is
required for `npx` to work.

## Verifying the Setup

```bash
# On wiki host — test server directly
curl -s http://localhost:3849/
# → "NORIA MCP server running"

# Test search
curl -s -X POST http://localhost:3849/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"example query"}}}'

# Test feedback submission
curl -s -X POST http://localhost:3849/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"submit_feedback","arguments":{"query_summary":"test feedback","feedback_kind":"gap"}}}'
# → should create file in outputs/queries/

# On remote — verify MCP tools visible
# Start new Claude Code session, check for mcp__noria__search
```

## Port Allocation

| Port | Status | Notes |
|------|--------|-------|
| 3847 | Occupied | Old QMD process (may need cleanup) |
| 3848 | Occupied | Old QMD process |
| 3849 | **Active** | Current noria-mcp-server.py |

Before starting, check: `ss -tlnp | grep 384`

## Legacy: QMD MCP (deprecated for remote)

QMD is still used locally for hybrid search (BM25 + vector) via `.mcp.json`,
but it is **not used for remote access** due to CPU-mode startup latency.
The local QMD configuration remains in `.mcp.json` for same-machine use.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| MCP tools not visible | `.mcp.json` not at project root | Move file, restart Claude Code |
| Connection refused on remote | SSH tunnel dropped | Reconnect; consider `autossh` |
| "npx: command not found" on remote | Node.js v12 default | Use `nvm use 22` wrapper in .mcp.json |
| Feedback file not created | `outputs/queries/` missing | Server auto-creates; check permissions |
| Port conflict | Old process on 3849 | `ss -tlnp | grep 3849`, kill stale process |
