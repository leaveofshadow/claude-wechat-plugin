---
name: wx-off
description: 断开微信连接（停止 cron 轮询，释放给其他窗口）
---

# 断开微信连接

停止当前 session 的微信轮询 cron，让其他窗口可以接管微信通信。

## 步骤

### 1. 查找并删除所有微信轮询 cron
调用 `CronList`，找到所有包含 "Poll WeChat" 或 "wechat" 的 cron 任务。
逐个调用 `CronDelete` 删除。

### 2. 发送微信通知
```bash
node "~/.claude/wechat-plugin/scripts/wechat-api.js" send "微信已断开当前窗口。在新窗口运行 /wx-on 重新连接。"
```

### 3. 输出提示
```
微信已断开。
在新窗口（目标项目目录）运行: /wx-on
```

## 注意事项
- 断开后，当前窗口不再收到微信消息
- 如果忘记断开直接开新窗口，两个 cron 会竞争消息
- 审批 hooks（PreToolUse）仍然生效，只是没有 cron 轮询来接收新指令
