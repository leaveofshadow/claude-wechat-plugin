---
name: wx-login
description: 微信 Bot 重新登录（显示二维码、检查扫码状态、验证登录成功）
---

# 微信 Bot 登录

重新登录微信 Bot 或检查当前登录状态。

## 步骤

### 1. 检查当前登录状态
```bash
cat ~/.mcp-wechat-server/account.json 2>/dev/null
```
- 如果有 `botToken`，提示用户已登录，询问是否需要重新登录
- 如果没有，直接进入登录流程

### 2. 清理旧账号数据（如需重新登录）
```bash
rm -f ~/.mcp-wechat-server/account.json
rm -f ~/.mcp-wechat-server/state.json
```

### 3. 获取登录二维码
调用 MCP 工具 `mcp__wechat__login_qrcode`，获取二维码 URL。

### 4. 显示二维码
将二维码 URL 输出给用户，提示用微信扫码。

### 5. 轮询扫码状态
调用 MCP 工具 `mcp__wechat__check_qrcode_status`，每隔 3-5 秒检查一次，最多等待 120 秒。

状态可能值：
- `waiting` — 等待扫码
- `scanned` — 已扫码，等待确认
- `confirmed` — 已确认，登录成功
- `expired` — 二维码过期，需重新获取

### 6. 验证登录
登录成功后，发送测试消息确认：
```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/wechat-api.js" send "微信 Bot 重新登录成功 ✓"
```

### 7. 重启 Cron（如需要）
如果之前有微信轮询 cron，建议重新注册：
提示用户运行 `/wx-cron` 重新创建 cron 任务。

## 注意事项
- 二维码有效期约 2 分钟，过期需重新获取
- 登录成功后 state.json 会自动创建
- 如果反复登录失败，可能是微信风控，建议间隔一段时间再试
