---
name: wx-status
description: 查询微信审批系统全面状态（bot 登录、hook 配置、守护进程、cron 任务）
---

# 微信审批系统状态查询

全面检查微信审批系统的运行状态。

## 步骤

### 1. 检查微信 Bot 登录状态
```bash
cat ~/.mcp-wechat-server/account.json 2>/dev/null | head -5
```
- 如果文件存在且有 `botToken`，说明已登录
- 如果文件不存在或无 `botToken`，提示用户运行 `/wx-login`

### 2. 测试微信 API 连通性
```bash
node "$HOME/.claude/wechat-plugin/scripts/wechat-api.js" poll 5000
```
- 如果返回 JSON 且无报错，说明 API 正常
- 如果报错 "Not logged in"，提示重新登录

### 3. 检查 Hook 配置状态
读取 `~/.claude/settings.json`，检查以下 hook：
- `PreToolUse → AskUserQuestion`（提问审批）：timeout 应为 125
- `PreToolUse → ExitPlanMode`（Plan 审批）：timeout 应为 180
- `PreToolUse → Bash|Edit|Write|Agent`（工具审批）：timeout 应为 125
- `PostToolUse → AskUserQuestion`（提问确认）：timeout 应为 15
- `Stop`（结束通知）：timeout 应为 15

### 4. 检查守护进程状态
```bash
wmic process where "name='node.exe'" get processid,commandline 2>/dev/null | grep -i "wechat-poll"
```
- 如果有输出，说明旧守护进程还在运行（应该杀掉，已改为阻塞式）
- 提示用户：守护进程不再需要，建议用 `taskkill //PID <pid> //F` 杀掉

### 5. 检查 Cron 任务状态
调用 `CronList` 查看微信轮询 cron 是否在运行。

### 6. 检查当前连接项目
读取 `~/.claude/wechat-plugin/projects.json`：
- 查看 `active` 字段获取当前激活的项目 ID
- 从 `projects[active]` 获取项目名称和工作目录
- 在状态表中显示项目名和工作路径

### 7. 检查调试文件
```bash
ls -la ~/.claude/wechat-plugin/*.json 2>/dev/null
```

### 8. 输出状态汇总

以表格形式输出所有检查结果：

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Bot 登录 | ✅/❌ | 是否有有效 token |
| API 连通 | ✅/❌ | poll 是否正常返回 |
| 当前项目 | ✅/❌ | 激活的项目名 + 工作目录 |
| Plan 审批 Hook | ✅/❌ | timeout 值 |
| 工具审批 Hook | ✅/❌ | timeout 值 |
| 提问审批 Hook | ✅/❌ | timeout 值（应为125） |
| 守护进程 | ✅/⚠️ | 不应有残留进程 |
| Cron 任务 | ✅/❌ | 是否在运行 |

如果有异常项，给出修复建议。
