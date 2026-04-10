---
name: wx-cron
description: 管理微信轮询 Cron 任务（注册、续期、查看、删除）
---

# 微信轮询 Cron 管理

管理微信消息轮询的 Cron 定时任务。Cron 会在会话空闲时自动轮询微信消息。

## 参数识别

根据用户输入判断操作：
- `注册` / `创建` / `启动` → 注册新 cron
- `续期` / `刷新` / `更新` → 删除旧 cron 并重新创建
- `查看` / `状态` / `列表` → 查看当前 cron
- `删除` / `取消` / `停止` → 删除 cron

## 注册/续期步骤

### 1. 查看现有 Cron
调用 `CronList` 查看是否有 "Poll WeChat" 相关任务。

### 2. 删除旧任务（续期时）
如果存在旧的微信轮询 cron，用 `CronDelete` 删除。

### 3. 创建新 Cron
用 `CronCreate` 创建：
- **cron**: `*/2 * * * *`（每 2 分钟轮询，hooks 独立处理审批无需高频）
- **recurring**: true
- **durable**: true（持久化，重启后保留）
- **prompt**:
  ```
  WX poll. If ~/.claude/wechat-plugin/pending.json has "type" field → say NO_MSG (hooks handle approvals at 3s). Else: run node "~/.claude/wechat-plugin/scripts/wechat-api.js" poll 5000 → if message_count=0 → say NO_MSG. If >0: read projects.json for active workDir, process latest msg as instruction. "切换 <key>" → switch active project.
  ```

### 4. 确认创建成功
输出新 cron ID，提醒用户：
- Cron 7 天后自动过期
- 过期前运行 `/wx-cron` 续期
- Cron 仅在 REPL 空闲时触发

## 查看步骤

调用 `CronList`，筛选包含 "Poll WeChat" 的任务，显示：
- 任务 ID
- cron 表达式
- 是否 durable
- 下次触发时间

## 删除步骤

调用 `CronList` 找到微信轮询 cron，用 `CronDelete` 删除。

## 注意事项
- Cron 任务 7 天自动过期，需要定期续期
- Cron 仅在 REPL 空闲时触发，不会中断正在执行的操作
- durable 任务存储在 `.claude/scheduled_tasks.json`，重启后自动恢复
- 微信消息会在活跃项目的上下文中执行，可通过 `/wx-switch` 切换
