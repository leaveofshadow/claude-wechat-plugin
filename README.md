# claude-wechat-plugin

WeChat remote control plugin for Claude Code — send commands, approve actions, and switch projects via WeChat.

## Features

- **Remote Commands**: Send Claude Code instructions via WeChat messages
- **Approval Control**: Approve/deny tool execution, plans, and questions from your phone
- **Project Switching**: Switch active project context through WeChat
- **Status Notifications**: Auto-push WeChat notifications when Claude completes tasks or needs approval

## Prerequisites

- [Claude Code CLI](https://claude.ai/code) installed
- [mcp-wechat-server](https://github.com/Howardzhangdqs/mcp-wechat-server) — WeChat Bot MCP Server (required for login & QR code)
- WeChat account with access to a WeChat Bot (via ilinkai)
- Node.js 18+

## Installation

### Quick Install (recommended)

```bash
bash <(curl -sL https://raw.githubusercontent.com/leaveofshadow/claude-wechat-plugin/master/install.sh)
```

Or clone and run:

```bash
git clone https://github.com/leaveofshadow/claude-wechat-plugin.git
cd claude-wechat-plugin && bash install.sh
```

### Manual Install

<details>
<summary>Click to expand</summary>

#### Step 1: Install mcp-wechat-server

Add the WeChat Bot MCP server to your Claude Code settings:

```bash
claude mcp add wechat -- npx -y mcp-wechat-server
```

Or manually add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "wechat": {
      "command": "npx",
      "args": ["-y", "mcp-wechat-server"]
    }
  }
}
```

#### Step 2: Install this plugin

```bash
claude plugin add --url https://github.com/leaveofshadow/claude-wechat-plugin
```

</details>

## Quick Start

### 1. Login

```
/wx-login
```

Scan the QR code with WeChat to authenticate.

### 2. Connect

```
/wx-on
```

Registers a polling cron job. The current window starts receiving WeChat messages.

### 3. Send Commands

Send messages to the Bot from your phone:

- "查看当前项目状态"
- "运行测试"
- "修复那个编译错误"

## Skills Reference

| Command | Description |
|---------|-------------|
| `/wx-login` | Login or re-login WeChat Bot |
| `/wx-on` | Connect WeChat to current window |
| `/wx-off` | Disconnect WeChat |
| `/wx-status` | Check system status |
| `/wx-switch [key]` | Switch active project |
| `/wx-projects` | List available projects |
| `/wx-approve [on/off/partial]` | Manage approval mode |
| `/wx-cron [register/renew/view/delete]` | Manage polling cron |

## WeChat Commands

| Message | Action |
|---------|--------|
| Any text | Execute as Claude Code instruction |
| `切换 <project>` | Switch active project |
| `y` / `是` / `ok` | Approve pending action |
| `n` / `否` / `取消` | Deny pending action |
| `A` / `B` / `C` / `D` | Select question option |

## Architecture

```
Claude Code CLI
├── Skills (8 commands)
├── Cron (1min polling)
├── Hooks (approval & notification)
│   ├── PreToolUse  → tool-notify, plan-notify, ask-notify
│   ├── PostToolUse → ask-notify
│   └── Stop        → notify
└── scripts/
    ├── wechat-api.js    (HTTP client)
    ├── notify.js        (Stop hook)
    ├── tool-notify.js   (tool approval)
    ├── plan-notify.js   (plan approval)
    ├── ask-notify.js    (question forwarding)
    └── scan-projects.js (project scanner)
```

Runtime data is stored in `~/.claude/wechat-plugin/`:

| File | Purpose |
|------|---------|
| `approval.json` | Approval mode config |
| `projects.json` | Project registry & active project |
| `pending.json` | Current pending approval state |
| `reply.json` | WeChat reply cache |

## Notes

- **One window at a time**: Only one Claude Code window should run WeChat polling. Use `/wx-off` before switching.
- **Cron fires when idle**: Polling only runs when REPL is idle, won't interrupt operations.
- **Approval timeouts**: Tool approval 2min, Plan approval 3min — auto-approve on timeout.
- **Default: approval disabled**: `/wx-on` and `/wx-switch` default to no-approval mode.

## License

MIT
