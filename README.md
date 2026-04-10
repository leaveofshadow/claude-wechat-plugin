# claude-wechat-plugin

通过微信远程控制 Claude Code — 发送指令、审批操作、切换项目，随时随地。

## 特性

- **远程指令**: 通过微信消息向 Claude Code 发送任意指令
- **审批控制**: 手机端审批/拒绝工具执行、方案和提问
- **项目切换**: 通过微信切换当前活跃项目
- **状态通知**: Claude 完成任务或需要审批时自动推送微信通知
- **跨平台支持**: 完整支持 Windows、macOS、Linux，安装脚本自动适配

## 前置条件

- [Claude Code CLI](https://claude.ai/code) 已安装
- [mcp-wechat-server](https://github.com/Howardzhangdqs/mcp-wechat-server) — 微信 Bot MCP Server（用于登录和二维码）
- 微信账号（需通过 ilinkai 接入 Bot）
- Node.js 18+
- bun （可选）

## 安装

### 一键安装（推荐）

**macOS / Linux:**

```bash
bash <(curl -sL https://raw.githubusercontent.com/leaveofshadow/claude-wechat-plugin/master/install.sh)
```

**Windows (Git Bash / WSL):**

```bash
git clone https://github.com/leaveofshadow/claude-wechat-plugin.git
cd claude-wechat-plugin && bash install.sh
```

> 安装脚本会自动配置 MCP Server、注册插件/技能，无需手动操作。

### 手动安装

<details>
<summary>点击展开</summary>

#### 第 1 步: 安装 mcp-wechat-server

```bash
claude mcp add wechat -- npx -y mcp-wechat-server
```

#### 第 2 步: 通过官方插件系统安装

```bash
claude plugin marketplace add https://github.com/leaveofshadow/claude-wechat-plugin
claude plugin install wechat-plugin
```

#### 第 3 步: 链接脚本到数据目录

插件系统安装后，需要将脚本链接到固定路径，供技能调用：

```bash
mkdir -p ~/.claude/wechat-plugin
# 找到插件安装目录并链接 scripts
PLUGIN_SRC=$(find ~/.claude/plugins -path "*/wechat-plugin-marketplace/scripts" -type d 2>/dev/null | head -1)
ln -s "$PLUGIN_SRC" ~/.claude/wechat-plugin/scripts
```

#### 第 4 步: 注册 Hooks

将插件的 Hooks 合并到 `settings.json`（不会覆盖已有的其他插件 Hooks）：

```bash
node -e "
  const fs = require('fs');
  const f = process.env.HOME + '/.claude/settings.json';
  const pluginSrc = process.env.HOME + '/.claude/wechat-plugin/scripts/..';
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}
  const hooks = JSON.parse(fs.readFileSync(require('path').resolve(pluginSrc, 'hooks/hooks.json'), 'utf-8')).hooks;
  function fix(c) { return c.replace(/\$CLAUDE_PLUGIN_ROOT/g, require('path').resolve(pluginSrc)); }
  cfg.hooks = cfg.hooks || {};
  for (const [ev, entries] of Object.entries(hooks)) {
    const existing = (cfg.hooks[ev] || []).filter(e => {
      const cmds = (e.hooks||[]).map(h=>h.command||'').join(' ');
      return !cmds.includes('wechat-plugin/scripts') && !cmds.includes('wechat-api');
    });
    cfg.hooks[ev] = existing.concat(entries.map(e => ({
      ...e, hooks: (e.hooks||[]).map(h => ({...h, command: h.command ? fix(h.command) : h.command}))
    })));
  }
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  console.log('Hooks registered.');
"
```

</details>

### 卸载

```bash
bash <(curl -sL https://raw.githubusercontent.com/leaveofshadow/claude-wechat-plugin/master/uninstall.sh)
```

或克隆后运行：

```bash
git clone https://github.com/leaveofshadow/claude-wechat-plugin.git
cd claude-wechat-plugin && bash uninstall.sh
```

## 快速开始

### 1. 登录

```
/wx-login
```

用微信扫描二维码完成认证。

### 2. 连接

```
/wx-on
```

注册轮询定时任务，当前窗口开始接收微信消息。

### 3. 发送指令

在手机上向 Bot 发送消息：

- "查看当前项目状态"
- "运行测试"
- "修复那个编译错误"

## 技能列表

| 命令 | 说明 |
|------|------|
| `/wx-login` | 登录或重新登录微信 Bot |
| `/wx-on` | 连接微信到当前窗口 |
| `/wx-off` | 断开微信连接 |
| `/wx-status` | 查看系统状态 |
| `/wx-switch [key]` | 切换活跃项目 |
| `/wx-projects` | 列出可用项目 |
| `/wx-approve [on/off/partial]` | 管理审批模式 |
| `/wx-cron [register/renew/view/delete]` | 管理轮询定时任务 |

## 注意事项

- **安装插件**: 本插件会修改用户级的Claude Code配置文件，可以提前备份 ~/.claude/settings.json。
- **微信登录**: 微信当前版本暂不支持扫码登录，请使用链接登录，并使用最新的微信版本。
- **微信连通测试**: 插件安装后，手机微信手动发送一个文本消息给 Bot，以测试微信连通性。插件使用轮询机制，非即时消息，请保持耐心。
- **Cron 任务**: 插件使用微信轮询，轮询间隔为 2分钟，如果轮询间隔过短会导致Claude 上下文爆炸。
- **微信消息**: 仅支持文本消息，不支持图片、文件、视频等。
- **单窗口限制**: 同一时间只能有一个 Claude Code 窗口运行微信轮询，切换前请先 `/wx-off`
- **空闲轮询**: 定时任务仅在 REPL 空闲时触发，不会中断正在执行的操作。Hooks 以 3 秒间隔独立处理审批回复
- **审批超时**: 工具审批 2 分钟，方案审批 3 分钟，超时自动批准
- **默认关闭审批**: `/wx-on` 和 `/wx-switch` 默认为免审批模式
- **手机远程遥控**: 手机远程遥控Claude时，可以开启 --dangerously-skip-permissions，减少消息通知。

## 在微信中的使用事例

| 消息 | 动作 |
|------|------|
| 任意文本 | 作为 Claude Code 指令执行 |
| `切换 <project>` | 切换活跃项目 |
| `y` / `是` / `ok` | 批准待审批操作 |
| `n` / `否` / `取消` | 拒绝待审批操作 |
| `A` / `B` / `C` / `D` | 选择问题选项 |

## 架构

```
Claude Code CLI
├── Skills (8 个命令)
├── Cron (2 分钟轮询，hooks 以 3 秒间隔处理审批)
├── Hooks (审批 & 通知)
│   ├── PreToolUse  → tool-notify, plan-notify, ask-notify
│   ├── PostToolUse → ask-notify
│   └── Stop        → notify
└── scripts/
    ├── wechat-api.js    (HTTP 客户端)
    ├── notify.js        (Stop hook)
    ├── tool-notify.js   (工具审批)
    ├── plan-notify.js   (方案审批)
    ├── ask-notify.js    (问题转发)
    └── scan-projects.js (项目扫描)
```

运行数据存储在 `~/.claude/wechat-plugin/`：

| 文件 | 用途 |
|------|------|
| `approval.json` | 审批模式配置 |
| `projects.json` | 项目注册表和活跃项目 |
| `pending.json` | 当前待审批状态 |
| `reply.json` | 微信回复缓存 |


## 许可证

MIT
