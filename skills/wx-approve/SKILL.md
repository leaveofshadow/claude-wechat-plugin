---
name: wx-approve
description: 管理微信审批模式（开启/关闭/部分审批），通过配置文件控制，无需重启
---

# 微信审批模式管理

通过修改配置文件 `~/.claude/wechat-plugin/approval.json` 控制审批行为。
**修改后立即生效，不需要重启 Claude Code。**

## 参数识别

根据用户输入判断操作：
- `开启` / `全部` / `on` → 开启全部工具审批
- `关闭` / `免审` / `off` → 关闭所有审批
- `部分` / `selective` → 只审批部分工具
- `查看` / `状态` → 查看当前审批配置

## 配置文件格式

文件路径：`~/.claude/wechat-plugin/approval.json`
```json
{
  "enabled": true,
  "tools": ["Bash", "Edit", "Write", "Agent"]
}
```

- `enabled`: `true` 审批开启，`false` 完全免审
- `tools`: 需要审批的工具列表，可选值：`Bash`, `Edit`, `Write`, `Agent`

## 操作步骤

### 查看状态
1. 读取 `~/.claude/wechat-plugin/approval.json`
2. 显示当前配置：
   - 审批状态：开启/关闭
   - 审批范围：全部/部分/无
   - 审批工具列表

### 开启全部审批
写入配置：
```json
{"enabled": true, "tools": ["Bash", "Edit", "Write", "Agent"]}
```
发送微信通知："工具审批已全部开启"

### 关闭审批（免审模式）
写入配置：
```json
{"enabled": false, "tools": ["Bash", "Edit", "Write", "Agent"]}
```
发送微信通知："工具审批已关闭（免审模式）"

### 部分审批
询问用户要审批哪些工具，然后写入。例如只审批写操作：
```json
{"enabled": true, "tools": ["Edit", "Write"]}
```
只审批 Bash：
```json
{"enabled": true, "tools": ["Bash"]}
```

## 注意事项
- 修改此文件**立即生效**，不需要重启 Claude Code
- Plan 审批和提问审批不受此配置影响
- 工具审批 2 分钟无微信回复自动批准
- wechat 相关脚本始终自动跳过审批（脚本内部硬编码）
