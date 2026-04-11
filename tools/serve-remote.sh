#!/bin/bash
# NORIA Remote Knowledge Service via SSH Reverse Tunnel
#
# Usage: ./tools/serve-remote.sh [remote-user@host] [port]
#
# This script:
# 1. Starts noria-mcp-server.py locally (search + get + submit_feedback)
# 2. Opens SSH reverse tunnel so remote can access via localhost:PORT
#
# On the remote machine, configure .mcp.json:
# {
#   "mcpServers": {
#     "noria": {
#       "command": "bash",
#       "args": ["-c", "source ~/.nvm/nvm.sh && nvm use 22 && npx -y mcp-remote http://localhost:3849/mcp"]
#     }
#   }
# }

set -e

REMOTE="${1:-user@your-remote-host}"
PORT="${2:-3849}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIKI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== NORIA Remote Knowledge Service ==="
echo "Wiki dir: $WIKI_DIR"
echo "Remote: $REMOTE"
echo "Port: $PORT"

# Check port availability
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    echo "WARNING: Port $PORT already in use. Check with: ss -tlnp | grep $PORT"
    echo "Kill stale process or choose a different port."
    exit 1
fi

# Step 1: Start lightweight Python MCP server (background)
echo ""
echo "[1/2] Starting noria-mcp-server.py on port $PORT..."
cd "$WIKI_DIR"
python3 tools/noria-mcp-server.py "$PORT" wiki &
SERVER_PID=$!
sleep 1

# Verify it's running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "ERROR: MCP server failed to start"
    exit 1
fi
echo "MCP server running (PID: $SERVER_PID)"
echo "  Tools: search, get, submit_feedback"

# Step 2: Open SSH reverse tunnel
echo ""
echo "[2/2] Opening SSH reverse tunnel ($REMOTE:$PORT -> localhost:$PORT)..."
echo "  Remote can now access NORIA via http://localhost:$PORT/"
echo "  Press Ctrl+C to stop."
echo ""

# Trap to cleanup on exit
trap "kill $SERVER_PID 2>/dev/null; echo 'Stopped.'" EXIT

# -R: reverse tunnel (remote port → local port)
# -N: no remote command
# -o ServerAliveInterval: keep connection alive
ssh -R "$PORT:localhost:$PORT" -N -o ServerAliveInterval=60 "$REMOTE"
