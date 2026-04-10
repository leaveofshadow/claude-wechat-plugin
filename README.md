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

或手动添加到 `~/.claude/settings.json`：

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

#### 第 2 步: 安装本插件

通过官方插件系统：

```bash
claude plugin marketplace add https://github.com/leaveofshadow/claude-wechat-plugin
claude plugin install wechat-plugin
```

或手动克隆并链接技能：

```bash
git clone https://github.com/leaveofshadow/claude-wechat-plugin.git ~/.claude/wechat-plugin/src
ln -s ~/.claude/wechat-plugin/src/skills/* ~/.claude/skills/
```

</details>

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

## 微信指令

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

## 注意事项

- **单窗口限制**: 同一时间只能有一个 Claude Code 窗口运行微信轮询，切换前请先 `/wx-off`
- **空闲轮询**: 定时任务仅在 REPL 空闲时触发，不会中断正在执行的操作。Hooks 以 3 秒间隔独立处理审批回复
- **审批超时**: 工具审批 2 分钟，方案审批 3 分钟，超时自动批准
- **默认关闭审批**: `/wx-on` 和 `/wx-switch` 默认为免审批模式

## 许可证

MIT
