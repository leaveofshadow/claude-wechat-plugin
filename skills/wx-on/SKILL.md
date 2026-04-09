---
name: wx-on
description: 连接微信到当前窗口（注册 cron 轮询）
---

# 连接微信到当前窗口

注册微信轮询 cron，让当前 session 接管微信通信。

## 前提
- 确保没有其他窗口在运行微信 cron（如果不确定，先在那个窗口运行 `/wx-off`）
- 确保微信 Bot 已登录（可运行 `/wx-status` 检查）

## 步骤

### 1. 检查是否有残留 cron
调用 `CronList`，检查是否已有微信轮询 cron。
如果有，先调用 `CronDelete` 删除（可能是旧窗口的残留）。

### 2. 读取当前项目
```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/scan-projects.js"
```
确认当前活跃项目是用户想要的。

### 3. 注册新 cron
用 `CronCreate` 创建：
- **cron**: `*/2 * * * *`（每 2 分钟轮询，hooks 独立处理审批无需高频）
- **recurring**: true
- **durable**: true
- **prompt**:
  ```
  WX poll. If ~/.claude/wechat-plugin/pending.json has "type" field → say NO_MSG (hooks handle approvals at 3s). Else: run node "$CLAUDE_PLUGIN_ROOT/scripts/wechat-api.js" poll 5000 → if message_count=0 → say NO_MSG. If >0: read projects.json for active workDir, process latest msg as instruction. "切换 <key>" → switch active project.
  ```

### 4. 确保审批配置为免审状态
```bash
node -e "const fs=require('fs');const f='~/.claude/wechat-plugin/approval.json';const c=JSON.parse(fs.readFileSync(f,'utf-8'));c.enabled=false;fs.writeFileSync(f,JSON.stringify(c,null,2))"
```
`wx-on` 默认免审，用户可通过 `/wx-approve` 开启审批。

### 5. 发送微信确认
```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/wechat-api.js" send "[ProjectName] 微信已连接。发送指令即可操作。"
```

### 5. 输出确认
```
微信已连接到当前窗口。
Cron ID: xxx
活跃项目: ProjectName
7天后需运行 /wx-cron 续期
```

## 注意事项
- 一个微信账号同一时刻只能被一个窗口的 cron 轮询
- 如果两个窗口同时有 cron，消息会被随机消费
- 切换窗口流程：旧窗口 `/wx-off` → 新窗口 `cd <项目目录> && claude` → `/wx-on`
