#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="wechat-plugin"
MARKETPLACE_NAME="wechat-plugin-marketplace"
MCP_NAME="wechat"
SETTINGS_FILE="$HOME/.claude/settings.json"
DATA_DIR="$HOME/.claude/wechat-plugin"
SKILLS_DIR="$HOME/.claude/skills"

echo "=== claude-wechat-plugin uninstaller ==="
echo ""

# --- Step 1: Remove plugin from plugin system ---
echo "[1/5] Removing plugin..."
if command -v claude &>/dev/null; then
  claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null && echo "  Plugin uninstalled." || echo "  Plugin not installed via plugin system, skipping."
  claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null && echo "  Marketplace removed." || echo "  Marketplace not found, skipping."
else
  echo "  Claude CLI not found, skipping plugin removal."
fi
echo ""

# --- Step 2: Remove symlinked skills ---
echo "[2/5] Removing skills..."
SKILL_NAMES="wx-login wx-on wx-off wx-status wx-switch wx-projects wx-approve wx-cron"
REMOVED=0
for skill in $SKILL_NAMES; do
  target="$SKILLS_DIR/$skill"
  if [ -L "$target" ]; then
    rm "$target"
    REMOVED=$((REMOVED + 1))
  elif [ -d "$target" ]; then
    # Check if it looks like our skill (has SKILL.md with wx- prefix)
    if [ -f "$target/SKILL.md" ]; then
      rm -rf "$target"
      REMOVED=$((REMOVED + 1))
    fi
  fi
done
echo "  Removed $REMOVED skills."
echo ""

# --- Step 3: Remove data directory ---
echo "[3/5] Removing data directory..."
if [ -d "$DATA_DIR" ]; then
  rm -rf "$DATA_DIR"
  echo "  Removed $DATA_DIR"
else
  echo "  Data directory not found, skipping."
fi
echo ""

# --- Step 4: Remove hooks from settings.json ---
echo "[4/5] Removing hooks from settings.json..."
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { process.exit(0); }

    let changed = false;

    // Remove hooks that reference wechat-plugin scripts
    if (cfg.hooks) {
      for (const [event, entries] of Object.entries(cfg.hooks)) {
        if (!Array.isArray(entries)) continue;
        const filtered = entries.filter(e => {
          const cmds = (e.hooks || []).map(h => h.command || '').join(' ');
          return !cmds.includes('wechat-plugin/scripts') && !cmds.includes('wechat-notify') && !cmds.includes('wechat-api');
        });
        if (filtered.length !== entries.length) {
          if (filtered.length === 0) {
            delete cfg.hooks[event];
          } else {
            cfg.hooks[event] = filtered;
          }
          changed = true;
        }
      }
      // Clean up empty hooks object
      if (Object.keys(cfg.hooks).length === 0) {
        delete cfg.hooks;
      }
    }

    if (changed) {
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
      console.log('  Hooks removed from settings.json.');
    } else {
      console.log('  No wechat hooks found in settings.json.');
    }
  "
else
  echo "  settings.json not found, skipping."
fi
echo ""

# --- Step 5: Remove MCP server from settings.json ---
echo "[5/5] Removing MCP server from settings.json..."
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { process.exit(0); }

    if (cfg.mcpServers && cfg.mcpServers['$MCP_NAME']) {
      delete cfg.mcpServers['$MCP_NAME'];
      if (Object.keys(cfg.mcpServers).length === 0) {
        delete cfg.mcpServers;
      }
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
      console.log('  MCP server removed from settings.json.');
    } else {
      console.log('  MCP server not found in settings.json.');
    }
  "
else
  echo "  settings.json not found, skipping."
fi
echo ""

echo "=== Uninstallation complete! ==="
echo "Please restart Claude Code to apply changes."
