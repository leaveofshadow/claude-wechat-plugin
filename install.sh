#!/usr/bin/env bash
set -euo pipefail

PLUGIN_URL="https://github.com/leaveofshadow/claude-wechat-plugin"
MCP_NAME="wechat"
SETTINGS_FILE="$HOME/.claude/settings.json"
DATA_DIR="$HOME/.claude/wechat-plugin"

echo "=== claude-wechat-plugin installer ==="
echo ""

# --- Check prerequisites ---
echo "[1/5] Checking prerequisites..."

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required but not found. Install Node.js 18+ first."
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required, found v$(node -v)"
  exit 1
fi
echo "  Node.js $(node -v) OK"

if ! command -v claude &>/dev/null; then
  echo "ERROR: Claude Code CLI not found. Install from https://claude.ai/code"
  exit 1
fi
echo "  Claude Code CLI OK"

echo ""

# --- Configure mcp-wechat-server ---
echo "[2/5] Configuring mcp-wechat-server..."

mkdir -p "$(dirname "$SETTINGS_FILE")"

NEED_MCP=true
if [ -f "$SETTINGS_FILE" ]; then
  if grep -q "\"$MCP_NAME\"" "$SETTINGS_FILE" 2>/dev/null; then
    echo "  MCP server '$MCP_NAME' already configured, skipping."
    NEED_MCP=false
  fi
fi

if $NEED_MCP; then
  # Try claude mcp add first
  if claude mcp add "$MCP_NAME" -- npx -y mcp-wechat-server 2>/dev/null; then
    echo "  Added via 'claude mcp add'."
  else
    # Fallback: merge into settings.json
    echo "  'claude mcp add' not available, writing settings.json directly..."
    node -e "
      const fs = require('fs');
      const f = '$SETTINGS_FILE';
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers['$MCP_NAME'] = { command: 'npx', args: ['-y', 'mcp-wechat-server'] };
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
    "
    echo "  Written to settings.json."
  fi
fi

echo ""

# --- Install plugin ---
echo "[3/5] Installing claude-wechat-plugin..."

if command -v claude &>/dev/null; then
  claude plugin add --url "$PLUGIN_URL" 2>/dev/null && echo "  Plugin installed via 'claude plugin add'." || {
    echo "  Could not install via CLI. Install manually:"
    echo "    claude plugin add --url $PLUGIN_URL"
  }
else
  echo "  Install manually: claude plugin add --url $PLUGIN_URL"
fi

echo ""

# --- Create data directory ---
echo "[4/5] Creating data directory..."
mkdir -p "$DATA_DIR"

# Write default config files if not exist
APPROVAL_FILE="$DATA_DIR/approval.json"
if [ ! -f "$APPROVAL_FILE" ]; then
  echo '{"enabled":false,"tools":["Bash","Edit","Write","Agent"]}' > "$APPROVAL_FILE"
  echo "  Created approval.json (approval disabled by default)."
else
  echo "  approval.json already exists, keeping current config."
fi

PROJECTS_FILE="$DATA_DIR/projects.json"
if [ ! -f "$PROJECTS_FILE" ]; then
  echo '{"active":"","projects":{}}' > "$PROJECTS_FILE"
  echo "  Created projects.json."
else
  echo "  projects.json already exists, keeping current config."
fi

echo ""

# --- Done ---
echo "[5/5] Installation complete!"
echo ""
echo "=== Next steps ==="
echo "1. Restart Claude Code (or open a new session)"
echo "2. Run:  /wx-login"
echo "3. Scan QR code with WeChat"
echo "4. Run:  /wx-on"
echo ""
echo "For more info: https://github.com/leaveofshadow/claude-wechat-plugin"
