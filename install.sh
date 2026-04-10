#!/usr/bin/env bash
set -euo pipefail

PLUGIN_URL="https://github.com/leaveofshadow/claude-wechat-plugin"
MARKETPLACE_NAME="wechat-plugin-marketplace"
PLUGIN_NAME="wechat-plugin"
MCP_NAME="wechat"
SETTINGS_FILE="$HOME/.claude/settings.json"
DATA_DIR="$HOME/.claude/wechat-plugin"

# --- Helper: ask user yes/no ---
confirm() {
  local msg="$1"
  while true; do
    echo ""
    echo "  >>> $msg"
    read -r -p "  确认继续? [y/N] " answer
    case "$answer" in
      [yY][eE][sS]|[yY]) return 0 ;;
      *) echo "  跳过此步骤。"; return 1 ;;
    esac
  done
}

echo "=== claude-wechat-plugin installer ==="
echo ""
echo "本脚本将执行以下操作:"
echo "  1. 检查前置条件 (Node.js 18+, Claude Code CLI)"
echo "  2. 在 settings.json 中配置 MCP Server (mcp-wechat-server)"
echo "  3. 安装插件 (marketplace 或 fallback)"
echo "  4. 创建数据目录 ~/.claude/wechat-plugin/"
echo "  5. 链接 scripts/ 并注册 hooks 到 settings.json"
echo ""
echo "将修改的文件:"
echo "  - $SETTINGS_FILE (添加 MCP Server + Hooks)"
echo "  - ~/.claude/skills/ (添加 8 个技能符号链接)"
echo "  - $DATA_DIR/ (创建数据目录)"
echo ""

if ! confirm "开始安装?"; then
  echo "安装已取消。"
  exit 0
fi

# --- Step 1: Check prerequisites ---
echo ""
echo "[1/6] 检查前置条件..."

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js 未找到，需要 Node.js 18+。"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required, found v$(node -v)"
  exit 1
fi
echo "  Node.js $(node -v) OK"

if ! command -v claude &>/dev/null; then
  echo "ERROR: Claude Code CLI 未找到，请先安装 https://claude.ai/code"
  exit 1
fi
echo "  Claude Code CLI OK"

# --- Step 2: Configure MCP Server ---
echo ""
echo "[2/6] 配置 MCP Server (mcp-wechat-server)..."

mkdir -p "$(dirname "$SETTINGS_FILE")"

NEED_MCP=true
if [ -f "$SETTINGS_FILE" ]; then
  if grep -q "\"$MCP_NAME\"" "$SETTINGS_FILE" 2>/dev/null; then
    echo "  MCP server '$MCP_NAME' 已配置，跳过。"
    NEED_MCP=false
  fi
fi

if $NEED_MCP; then
  echo ""
  echo "  将在 settings.json 中添加:"
  echo "    MCP Server: $MCP_NAME"
  echo "    Command: npx -y mcp-wechat-server"
  if confirm "写入 MCP Server 配置到 settings.json?"; then
    if claude mcp add "$MCP_NAME" -- npx -y mcp-wechat-server 2>/dev/null; then
      echo "  已通过 'claude mcp add' 添加。"
    else
      node -e "
        const fs = require('fs');
        const f = '$SETTINGS_FILE';
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers['$MCP_NAME'] = { command: 'npx', args: ['-y', 'mcp-wechat-server'] };
        fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
      "
      echo "  已写入 settings.json。"
    fi
  fi
fi

# --- Step 3: Install plugin ---
echo ""
echo "[3/6] 安装插件..."

PLUGIN_INSTALLED=false

if command -v claude &>/dev/null; then
  if claude plugin marketplace add "$PLUGIN_URL" 2>/dev/null; then
    echo "  Marketplace 已添加。"
    if claude plugin install "$PLUGIN_NAME" 2>/dev/null; then
      echo "  通过官方插件系统安装成功。"
      PLUGIN_INSTALLED=true
    else
      echo "  'claude plugin install' 失败，尝试回退方案..."
    fi
  else
    echo "  'claude plugin marketplace add' 失败，尝试回退方案..."
  fi
fi

if [ "$PLUGIN_INSTALLED" = "false" ]; then
  echo ""
  echo "  回退方案: 将仓库克隆到 $DATA_DIR/src/"
  echo "  并将技能符号链接到 ~/.claude/skills/"
  if confirm "执行克隆和技能安装?"; then
    PLUGIN_SRC_DIR="$DATA_DIR/src"
    SKILLS_DIR="$HOME/.claude/skills"

    if [ -d "$PLUGIN_SRC_DIR" ]; then
      echo "  更新已有克隆..."
      git -C "$PLUGIN_SRC_DIR" pull --ff-only 2>/dev/null || {
        echo "  WARNING: 更新失败，使用已有版本。"
      }
    else
      echo "  克隆仓库..."
      if git clone --depth 1 "$PLUGIN_URL" "$PLUGIN_SRC_DIR" 2>/dev/null; then
        echo "  克隆完成。"
      else
        echo "  ERROR: 克隆失败，技能将不可用。"
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
          echo "  WARNING: $skill_name 已存在，跳过。"
          continue
        fi
        ln -s "$skill_dir" "$target"
        SKILL_COUNT=$((SKILL_COUNT + 1))
      done
      echo "  已安装 $SKILL_COUNT 个技能到 ~/.claude/skills/"
    fi
  fi
fi

# --- Step 4: Create data directory ---
echo ""
echo "[4/6] 创建数据目录..."
mkdir -p "$DATA_DIR"

APPROVAL_FILE="$DATA_DIR/approval.json"
if [ ! -f "$APPROVAL_FILE" ]; then
  echo '{"enabled":false,"tools":["Bash","Edit","Write","Agent"]}' > "$APPROVAL_FILE"
  echo "  创建 approval.json (默认免审批)。"
else
  echo "  approval.json 已存在，保留。"
fi

PROJECTS_FILE="$DATA_DIR/projects.json"
if [ ! -f "$PROJECTS_FILE" ]; then
  echo '{"active":"","projects":{}}' > "$PROJECTS_FILE"
  echo "  创建 projects.json。"
else
  echo "  projects.json 已存在，保留。"
fi

# --- Step 5: Link scripts & register hooks ---
echo ""
echo "[5/6] 链接脚本并注册 Hooks..."

# Find the plugin source directory
PLUGIN_SRC=""
if [ "$PLUGIN_INSTALLED" = "true" ] && [ -d "$HOME/.claude/plugins/marketplaces/$MARKETPLACE_NAME" ]; then
  PLUGIN_SRC="$HOME/.claude/plugins/marketplaces/$MARKETPLACE_NAME"
fi
if [ -z "$PLUGIN_SRC" ] && [ -d "$DATA_DIR/src" ]; then
  PLUGIN_SRC="$DATA_DIR/src"
fi
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
  echo "  Scripts 链接: $SCRIPTS_LINK → $PLUGIN_SRC/scripts"
else
  echo "  WARNING: 未找到插件 scripts 目录，部分技能可能不可用。"
fi

# Register hooks into settings.json
if [ -n "$PLUGIN_SRC" ] && [ -f "$PLUGIN_SRC/hooks/hooks.json" ]; then
  echo ""
  echo "  将在 settings.json 中注册以下 Hooks:"
  echo "    - PreToolUse → AskUserQuestion (提问审批)"
  echo "    - PreToolUse → ExitPlanMode (方案审批)"
  echo "    - PreToolUse → Bash|Edit|Write|Agent (工具审批)"
  echo "    - PostToolUse → AskUserQuestion (提问确认)"
  echo "    - Stop (完成通知)"
  if confirm "写入 Hooks 配置到 settings.json?"; then
    node -e "
      const fs = require('fs');
      const f = '$SETTINGS_FILE';
      const pluginSrc = '$PLUGIN_SRC';
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}

      const pluginHooks = JSON.parse(fs.readFileSync(pluginSrc + '/hooks/hooks.json', 'utf-8'));
      const hooksDef = pluginHooks.hooks || {};

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

      // Merge: remove old wechat-plugin hooks first, then append new ones
      cfg.hooks = cfg.hooks || {};
      for (const [event, newEntries] of Object.entries(hooksDef)) {
        // Remove any existing wechat-plugin hook entries for this event
        if (Array.isArray(cfg.hooks[event])) {
          cfg.hooks[event] = cfg.hooks[event].filter(e => {
            const cmds = (e.hooks || []).map(h => h.command || '').join(' ');
            return !cmds.includes('wechat-plugin/scripts') && !cmds.includes('wechat-api.js');
          });
        } else {
          cfg.hooks[event] = [];
        }
        // Append new hooks
        cfg.hooks[event] = cfg.hooks[event].concat(fixHooks(newEntries));
      }

      fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
    "
    echo "  Hooks 已注册到 settings.json。"
  fi
else
  echo "  WARNING: 未找到 hooks/hooks.json，Hooks 未注册。"
fi

# --- Done ---
echo ""
echo "[6/6] 安装完成!"
echo ""
echo "=== 下一步 ==="
echo "1. 重启 Claude Code (或打开新会话)"
echo "2. 运行: /wx-login"
echo "3. 用微信扫码登录"
echo "4. 运行: /wx-on"
echo ""
echo "卸载: bash uninstall.sh"
echo "文档: https://github.com/leaveofshadow/claude-wechat-plugin"
