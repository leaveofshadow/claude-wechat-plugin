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

### 2. 扫描并注册当前项目
```bash
node "$HOME/.claude/wechat-plugin/scripts/scan-projects.js"
```
扫描完成后，检查 `~/.claude/wechat-plugin/projects.json` 中的 `active` 字段：
- 如果 `active` 为空或当前 CWD 不是活跃项目，**必须**将当前 CWD 注册为活跃项目
- 读取 projects.json，找到 `workDir` 与当前 CWD 匹配的项目 key
- 如果没找到匹配项，创建一个新条目：

```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  const f = path.join(require('os').homedir(), '.claude', 'wechat-plugin', 'projects.json');
  let cfg = { active: '', projects: {} };
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch {}
  const cwd = process.cwd();
  const normalize = p => p.replace(/\\\\/g, '/').toLowerCase().replace(/\\/+$/, '');
  const normCwd = normalize(cwd);
  // Find matching project
  let found = null;
  for (const [key, proj] of Object.entries(cfg.projects)) {
    if (normalize(proj.workDir) === normCwd) { found = key; break; }
  }
  if (!found) {
    // Create new entry from CWD
    const segs = cwd.replace(/\\\\/g, '/').split('/').filter(Boolean);
    const name = segs[segs.length - 1] || 'project';
    found = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    cfg.projects[found] = { name, workDir: cwd, description: '' };
  }
  cfg.active = found;
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
  console.log('Active project: ' + found + ' (' + cwd + ')');
"
```

确认当前活跃项目是用户想要的。

### 3. 注册新 cron
用 `CronCreate` 创建：
- **cron**: `*/2 * * * *`（每 2 分钟轮询，hooks 独立处理审批无需高频）
- **recurring**: true
- **durable**: true
- **prompt**:
  ```
  WX poll. If ~/.claude/wechat-plugin/pending.json has "type" field → say NO_MSG (hooks handle approvals at 3s). Else: run node "$HOME/.claude/wechat-plugin/scripts/wechat-api.js" poll 5000 → if message_count=0 → say NO_MSG. If >0: read projects.json for active workDir, process latest msg as instruction. "切换 <key>" → switch active project.
  ```

### 4. 确保审批配置为免审状态
```bash
node -e "const fs=require('fs');const f='~/.claude/wechat-plugin/approval.json';const c=JSON.parse(fs.readFileSync(f,'utf-8'));c.enabled=false;fs.writeFileSync(f,JSON.stringify(c,null,2))"
```
`wx-on` 默认免审，用户可通过 `/wx-approve` 开启审批。

### 5. 发送微信确认
```bash
node "$HOME/.claude/wechat-plugin/scripts/wechat-api.js" send "[ProjectName] 微信已连接。发送指令即可操作。"
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
