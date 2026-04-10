---
name: wx-projects
description: 查看/扫描微信可切换的项目列表（自动从 ~/.claude/projects/ 检测）
---

# 微信项目管理

项目列表自动从 `~/.claude/projects/` 检测，无需手动添加。

## 参数识别

根据用户输入判断操作：
- `列出` / `列表` / `查看` / 无参数 → 先自动扫描，再显示项目列表
- `扫描` / `scan` / `刷新` → 强制重新扫描

## 操作步骤

### 1. 自动扫描
每次列出项目前，先运行扫描：
```bash
node "~/.claude/wechat-plugin/scripts/scan-projects.js"
```

### 2. 显示项目列表
读取 `projects.json`，显示所有项目：
```
项目列表（* = 当前活跃）：
* skillhub — SkillHub (E:/work/person/vibe_coding/skills/skillhub)
  thesis — 论文助手 (e:/work/person/note/mayuan_lunwen_writer)
  mcp — Mcp (E:/work/person/vibe_coding/mcp)
  ...

总计: N 个项目 | 发送 '切换 <项目名>' 切换
```

## 扫描逻辑

脚本 `scan-projects.js` 自动：
- 读取 `~/.claude/projects/` 下所有子目录
- 从每个目录的最近 JSONL session 文件提取 `cwd` 字段（真实工作路径）
- 过滤最近 30 天内有活动的项目
- 去重（同一路径保留最近的）
- 合并到现有配置（保留已有的 description 等自定义字段）

## 注意事项
- 项目列表完全自动，不需要手动添加或删除
- 如果项目不活跃了（30天无 session），会自动从列表消失
- `description` 字段可以手动编辑 `projects.json` 补充
