# WeChat Remote Control System — Architecture Design

## 1. Overview

WeChat Remote Control System (以下简称 WX-RC) 是一套基于 Claude Code Hooks + Cron + WeChat Bot MCP 的远程控制系统，允许用户通过微信消息远程操控 Claude Code 终端，实现移动端开发协作。

### 核心能力

- **远程指令**：微信发消息即执行 Claude Code 指令
- **审批控制**：工具执行、Plan 提交、提问回答均可通过微信审批
- **项目切换**：微信中切换活跃项目，一个 Bot 管理多个项目
- **状态通知**：Claude 完成任务、等待审批时自动推送微信

### 设计原则

- **用户级 Hook**：所有 Hook 配置在 `~/.claude/settings.json`，所有项目共享
- **项目隔离**：通过 `.wechat-projects.json` 的 `active` 字段区分当前项目
- **免审默认**：`wx-on` / `wx-switch` 默认免审，用户按需开启
- **零守护进程**：阻塞式 Hook 直接在 Hook 进程内轮询微信回复

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code CLI                        │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Skills   │  │   Cron   │  │  Hooks   │  │  Config    │  │
│  │ (8 cmds) │  │ (1 task) │  │ (5 files)│  │ (3 files) │  │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬─────┘  │
│        │             │             │              │         │
│        └─────────────┴─────────────┴──────────────┘         │
│                          │                                   │
│                   wechat-api.js                             │
│                   (HTTP client)                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
              ┌────────────────────────┐
              │   WeChat Bot API       │
              │  ilinkai.weixin.qq.com │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   User's WeChat App    │
              │     (Mobile)           │
              └────────────────────────┘
```

---

## 3. Component Details

### 3.1 Scripts (`~/.claude/hooks/`)

| Script | Role | Called By |
|--------|------|-----------|
| `wechat-api.js` | WeChat HTTP API 客户端，提供 `send` 和 `poll` 两个命令 | 所有其他脚本和 Skills |
| `wechat-notify.js` | Stop Hook：Claude 停止时推送通知 | Claude Code Stop event |
| `wechat-tool-notify.js` | PreToolUse Hook：工具执行前请求审批 | Claude Code PreToolUse (Bash/Edit/Write/Agent) |
| `wechat-plan-notify.js` | PreToolUse Hook：Plan 提交前请求审批 | Claude Code PreToolUse (ExitPlanMode) |
| `wechat-ask-notify.js` | PreToolUse Hook：提问时转发微信并等待回复 | Claude Code PreToolUse (AskUserQuestion) |
| `wechat-scan-projects.js` | 扫描 `~/.claude/projects/` 下的活跃项目 | `/wx-projects` Skill |

### 3.2 Hooks Configuration (`~/.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [{
          "type": "command",
          "command": "node wechat-ask-notify.js",
          "timeout": 125
        }]
      },
      {
        "matcher": "ExitPlanMode",
        "hooks": [{
          "type": "command",
          "command": "node wechat-plan-notify.js",
          "timeout": 180
        }]
      },
      {
        "matcher": "Bash|Edit|Write|MultiEdit|Agent",
        "hooks": [{
          "type": "command",
          "command": "node wechat-tool-notify.js",
          "timeout": 125
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [{
          "type": "command",
          "command": "node wechat-ask-notify.js",
          "timeout": 15
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "node wechat-notify.js",
          "timeout": 15
        }]
      }
    ]
  }
}
```

### 3.3 Config Files (`~/.claude/hooks/`)

| File | Purpose | Format |
|------|---------|--------|
| `.wechat-approval.json` | 工具审批开关 | `{"enabled": bool, "tools": [...]}` |
| `.wechat-projects.json` | 项目注册表与活跃项目 | `{"active": "key", "projects": {...}}` |
| `.wechat-pending.json` | 当前等待审批的状态（临时文件） | `{"type": "approval/plan_approval/question", ...}` |
| `.wechat-reply.json` | 微信回复缓存（临时文件） | `{"matchedOption": "...", "rawText": "..."}` |
| `.wechat-debug.log` | Stop Hook 的调试日志 | 自定义格式 |

### 3.4 Skills (`~/.claude/skills/wx-*/`)

| Skill | Command | Description |
|-------|---------|-------------|
| `wx-login` | `/wx-login` | 登录微信 Bot（扫码二维码） |
| `wx-on` | `/wx-on` | 连接微信到当前窗口（注册 Cron） |
| `wx-off` | `/wx-off` | 断开微信连接（删除 Cron） |
| `wx-status` | `/wx-status` | 查看系统全面状态 |
| `wx-switch` | `/wx-switch [key]` | 切换活跃项目 / 查看当前项目 |
| `wx-projects` | `/wx-projects` | 查看/扫描可用项目列表 |
| `wx-approve` | `/wx-approve [on/off/部分]` | 管理审批模式 |
| `wx-cron` | `/wx-cron [注册/续期/删除]` | 管理轮询 Cron 任务 |

### 3.5 Cron Task

一个 durable recurring cron 任务，每分钟触发：

- **Prompt**: "WeChat poll with pending-awareness"
- **STEP 1**: 检查 `.wechat-pending.json`，如有 pending 审批则跳过（Hook 已在轮询）
- **STEP 2**: 无 pending 时 poll 微信，有消息则作为用户指令执行
- **Durable**: 持久化到 `.claude/scheduled_tasks.json`，重启后自动恢复
- **TTL**: 7 天自动过期，需定期 `/wx-cron` 续期

### 3.6 MCP Server

`mcp-wechat-server` 提供 WeChat Bot 的登录能力：

- `login_qrcode` — 获取登录二维码
- `check_qrcode_status` — 检查扫码状态

登录成功后 token 存储在 `~/.mcp-wechat-server/account.json`，供 `wechat-api.js` 使用。

---

## 4. Data Flow

### 4.1 远程指令流程

```
User sends WeChat message
         │
         ▼
   Cron fires (every 1 min)
         │
         ▼
   Check .wechat-pending.json ──exists──▶ NO_MSG (Hook handling it)
         │
         │ not found
         ▼
   wechat-api.js poll 5000
         │
         ├── message_count=0 ──▶ NO_MSG
         │
         └── message_count>0
              │
              ├─ "切换 xxx" ──▶ Update .wechat-projects.json + send confirmation
              │
              └─ other text ──▶ Execute as user instruction in active project's workDir
```

### 4.2 工具审批流程

```
Claude tries to run Bash/Edit/Write/Agent
         │
         ▼
   PreToolUse Hook fires: wechat-tool-notify.js
         │
         ├── CWD ≠ active project ──▶ process.exit(0) (skip)
         │
         ├── approval disabled ──▶ process.exit(0) (skip)
         │
         └── approval enabled
              │
              ▼
         Send WeChat: "[ProjectName] [Claude 需要审批] Tool: detail"
         Write .wechat-pending.json
              │
              ▼
         Poll WeChat (3s interval, 2min max)
              │
              ├── Reply "y" ──▶ permissionDecision: "allow" + delete pending
              ├── Reply "n" ──▶ permissionDecision: "deny" + delete pending
              └── Timeout ──▶ permissionDecision: "allow" (auto-approve)
```

### 4.3 通知流程

```
Claude stops (end_turn / tool_use)
         │
         ▼
   Stop Hook fires: wechat-notify.js
         │
         ├── lastText = "NO_MSG" ──▶ skip (cron poll, no action)
         │
         ├── stopReason = "tool_use" ──▶ "[Claude 需要审批] ..." + write pending
         │
         └── stopReason = "end_turn" ──▶ "[Claude 已完成] ..." + write endturn pending
```

---

## 5. Security Model

### 5.1 项目隔离

- 所有 Hook 通过 `isActiveProject(cwd)` 检查当前工作目录
- 只有匹配 `.wechat-projects.json` 中 `active` 项目的窗口才触发审批
- 其他项目窗口的 Hook 直接 `process.exit(0)` 跳过

### 5.2 审批层级

| 层级 | 触发条件 | 超时 | 默认状态 |
|------|---------|------|---------|
| 工具审批 | `enabled: true` + 工具在 `tools` 列表 + CWD 匹配活跃项目 | 2 分钟自动批准 | 免审 |
| Plan 审批 | ExitPlanMode + CWD 匹配活跃项目 | 3 分钟自动批准 | 始终生效 |
| 提问审批 | AskUserQuestion (Pre) + CWD 匹配活跃项目 | 2 分钟超时 | 始终生效 |

### 5.3 免审豁免

- `wechat-api.js` 和 `wechat-` 开头的脚本自动跳过审批
- 避免 Hook 死锁（审批 Hook 本身调用 API 不需要再审批）

---

## 6. WeChat API Protocol

`wechat-api.js` 使用企业微信 Bot HTTP API：

- **Base URL**: `https://ilinkai.weixin.qq.com/`
- **Auth**: `Authorization: Bearer <botToken>`
- **Send**: `POST ilink/bot/sendmessage`
- **Poll**: `POST ilink/bot/getupdates`
- **State**: `~/.mcp-wechat-server/state.json` 维护 `updatesBuf` 和 `contextTokens`

### 消息格式

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<userId>",
    "client_id": "hook-wechat:<timestamp>-<random>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{"type": 1, "text_item": {"text": "message content"}}],
    "context_token": "<token>"
  }
}
```

---

## 7. File Inventory

```
~/.claude/
├── settings.json                          # Hook 配置（用户级）
├── hooks/
│   ├── wechat-api.js                      # WeChat HTTP 客户端
│   ├── wechat-notify.js                   # Stop Hook（通知）
│   ├── wechat-tool-notify.js              # PreToolUse（工具审批）
│   ├── wechat-plan-notify.js              # PreToolUse（Plan 审批）
│   ├── wechat-ask-notify.js               # PreToolUse/PostToolUse（提问）
│   ├── wechat-scan-projects.js            # 项目扫描脚本
│   ├── .wechat-approval.json              # 审批配置
│   ├── .wechat-projects.json              # 项目注册表
│   ├── .wechat-pending.json               # 临时：当前审批状态
│   ├── .wechat-reply.json                 # 临时：回复缓存
│   ├── .wechat-approval.json              # 审批配置
│   └── .wechat-debug.log                  # 调试日志
├── skills/
│   ├── wx-login/SKILL.md
│   ├── wx-on/skill.md
│   ├── wx-off/skill.md
│   ├── wx-status/skill.md
│   ├── wx-switch/skill.md
│   ├── wx-projects/skill.md
│   ├── wx-approve/SKILL.md
│   └── wx-cron/skill.md
└── scheduled_tasks.json                   # Durable cron 存储

~/.mcp-wechat-server/
├── account.json                           # Bot token + userId
└── state.json                             # API 轮询状态
```
