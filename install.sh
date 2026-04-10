#!/usr/bin/env bash
set -euo pipefail

PLUGIN_URL="https://github.com/leaveofshadow/claude-wechat-plugin"
MARKETPLACE_NAME="wechat-plugin-marketplace"
PLUGIN_NAME="wechat-plugin"
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

PLUGIN_INSTALLED=false

# Method 1: Official plugin system (marketplace + install)
if command -v claude &>/dev/null; then
  echo "  Adding plugin marketplace..."
  if claude plugin marketplace add "$PLUGIN_URL" 2>/dev/null; then
    echo "  Marketplace added."
    if claude plugin install "$PLUGIN_NAME" 2>/dev/null; then
      echo "  Plugin installed via 'claude plugin install'."
      PLUGIN_INSTALLED=true
    else
      echo "  'claude plugin install' failed, trying fallback..."
    fi
  else
    echo "  'claude plugin marketplace add' failed, trying fallback..."
  fi
fi

# Method 2: Fallback — clone repo and symlink skills into ~/.claude/skills/
if [ "$PLUGIN_INSTALLED" = "false" ]; then
  echo "  Falling back to manual skill installation..."
  PLUGIN_SRC_DIR="$DATA_DIR/src"
  SKILLS_DIR="$HOME/.claude/skills"

  if [ -d "$PLUGIN_SRC_DIR" ]; then
    echo "  Updating existing clone..."
    git -C "$PLUGIN_SRC_DIR" pull --ff-only 2>/dev/null || {
      echo "  WARNING: Could not update clone, using existing version."
    }
  else
    echo "  Cloning plugin repository..."
    if git clone --depth 1 "$PLUGIN_URL" "$PLUGIN_SRC_DIR" 2>/dev/null; then
      echo "  Repository cloned."
    else
      echo "  ERROR: Failed to clone repository. Skills will not be available."
    fi
  fi

  if [ -d "$PLUGIN_SRC_DIR/skills" ]; then
    mkdir -p "$SKILLS_DIR"
    SKILL_COUNT=0
    for skill_dir in "$PLUGIN_SRC_DIR"/skills/*/; do
      skill_name=$(basename "$skill_dir")
      target="$SKILLS_DIR/$skill_name"
      if [ -L "$target" ]; then
        rm "$target"
      elif [ -d "$target" ]; then
        echo "  WARNING: $skill_name already exists in skills/, skipping."
        continue
      fi
      ln -s "$skill_dir" "$target"
      SKILL_COUNT=$((SKILL_COUNT + 1))
    done
    echo "  Installed $SKILL_COUNT skills into ~/.claude/skills/"
  fi
fi

echo ""

# --- Create data directory ---
echo "[4/6] Creating data directory..."
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

# --- Link scripts to data dir ---
echo "[5/6] Linking scripts to data directory..."

# Find the plugin source directory
PLUGIN_SRC=""
if [ "$PLUGIN_INSTALLED" = "true" ] && [ -d "$HOME/.claude/plugins/marketplaces/$MARKETPLACE_NAME" ]; then
  PLUGIN_SRC="$HOME/.claude/plugins/marketplaces/$MARKETPLACE_NAME"
fi
if [ -z "$PLUGIN_SRC" ] && [ -d "$DATA_DIR/src" ]; then
  PLUGIN_SRC="$DATA_DIR/src"
fi
# Search cache directories as last resort
if [ -z "$PLUGIN_SRC" ]; then
  for cached in "$HOME/.claude/plugins/cache/"*/"$PLUGIN_NAME"/*/; do
    if [ -d "${cached}scripts" ]; then
      PLUGIN_SRC="$cached"
      break
    fi
  done
fi

if [ -n "$PLUGIN_SRC" ] && [ -d "$PLUGIN_SRC/scripts" ]; then
  SCRIPTS_LINK="$DATA_DIR/scripts"
  if [ -L "$SCRIPTS_LINK" ]; then
    rm "$SCRIPTS_LINK"
  elif [ -d "$SCRIPTS_LINK" ]; then
    rm -rf "$SCRIPTS_LINK"
  fi
  ln -s "$PLUGIN_SRC/scripts" "$SCRIPTS_LINK"
  echo "  Scripts linked: $SCRIPTS_LINK → $PLUGIN_SRC/scripts"
else
  echo "  WARNING: Could not find plugin scripts directory."
  echo "  Skills that run scripts may not work."
fi

# --- Merge hooks into settings.json ---
echo ""
echo "  Registering hooks in settings.json..."

if [ -n "$PLUGIN_SRC" ] && [ -f "$PLUGIN_SRC/hooks/hooks.json" ]; then
  node -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    const pluginSrc = '$PLUGIN_SRC';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}

    // Read plugin hooks
    const pluginHooks = JSON.parse(fs.readFileSync(pluginSrc + '/hooks/hooks.json', 'utf-8'));
    const hooksDef = pluginHooks.hooks || {};

    // Replace \$CLAUDE_PLUGIN_ROOT with actual path in hook commands
    function fixCmd(cmd) {
      return cmd.replace(/\\\$CLAUDE_PLUGIN_ROOT/g, pluginSrc);
    }

    function fixHooks(list) {
      if (!list) return list;
      return list.map(h => ({
        ...h,
        hooks: h.hooks ? h.hooks.map(hh => ({
          ...hh,
          command: hh.command ? fixCmd(hh.command) : hh.command
        })) : undefined
      }));
    }

    // Merge hooks into settings
    cfg.hooks = cfg.hooks || {};
    for (const [event, entries] of Object.entries(hooksDef)) {
      cfg.hooks[event] = fixHooks(entries);
    }

    fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  "
  echo "  Hooks registered in settings.json."
else
  echo "  WARNING: Could not find hooks/hooks.json. Hooks not registered."
fi

echo ""

# --- Done ---
echo "[6/6] Installation complete!"
echo ""
echo "=== Next steps ==="
echo "1. Restart Claude Code (or open a new session)"
echo "2. Run:  /wx-login"
echo "3. Scan QR code with WeChat"
echo "4. Run:  /wx-on"
echo ""
echo "For more info: https://github.com/leaveofshadow/claude-wechat-plugin"
