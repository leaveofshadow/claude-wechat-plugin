#!/usr/bin/env node
// tool-notify.js — PreToolUse hook for tool approval via WeChat
// Sends notification, then polls for WeChat reply to approve/deny the tool.
// Exit 0 = approved, Exit 2 = denied, Exit 0 after timeout = auto-approved.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), ".claude", "wechat-plugin");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const API_SCRIPT = path.join(__dirname, "wechat-api.js");
const PENDING_FILE = path.join(DATA_DIR, "pending.json");
const REPLY_FILE = path.join(DATA_DIR, "reply.json");
const CONFIG_FILE = path.join(DATA_DIR, "approval.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const APPROVE_WAIT_MS = 120_000; // 2 minutes max wait
const POLL_INTERVAL_MS = 3000;

const APPROVAL_YES = ["y", "yes", "是", "同意", "批准", "确认", "ok", "好", "可以"];
const APPROVAL_NO = ["n", "no", "否", "拒绝", "取消", "cancel", "不"];

// Load approval config — controls which tools need approval
// { enabled: true, tools: ["Bash","Edit","Write","Agent"] }
// enabled:false = skip all approval, tools:[] = skip all tools
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return { enabled: true, tools: ["Bash", "Edit", "Write", "Agent"] };
  }
}

// Check if current CWD matches the active project bound via wx-switch/wx-on
// Only the active project should trigger WeChat approval
function isActiveProject(cwd) {
  try {
    const cfg = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
    const active = cfg.active;
    const project = cfg.projects && cfg.projects[active];
    if (!project || !project.workDir) return false;
    // Normalize paths for comparison (case-insensitive on Windows, handle slashes)
    const normalize = (p) => p.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
    return normalize(cwd) === normalize(project.workDir);
  } catch {}
  return false;
}

function getProjectPrefix() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
    const active = cfg.active;
    const project = cfg.projects && cfg.projects[active];
    if (project && project.name) return `[${project.name}] `;
  } catch {}
  return "";
}

function formatToolDetail(toolName, toolInput) {
  const inp = toolInput || {};
  if (toolName === "Bash" && inp.command) {
    return `Bash: ${inp.command.slice(0, 200)}`;
  }
  if ((toolName === "Edit" || toolName === "Write") && inp.file_path) {
    return `${toolName}: ${inp.file_path}`;
  }
  if (toolName === "Agent" && inp.description) {
    return `Agent: ${inp.description}`;
  }
  return `${toolName}: ${JSON.stringify(inp).slice(0, 200)}`;
}

function pollWeChat(sinceTimestamp) {
  try {
    const result = execFileSync("node", [API_SCRIPT, "poll", "5000"], {
      timeout: 10000,
      windowsHide: true,
      encoding: "utf-8",
    });
    const data = JSON.parse(result.trim());
    const messages = data.messages || [];
    return messages.filter((m) => {
      const t = m.create_time ? new Date(m.create_time).getTime() : 0;
      return t > sinceTimestamp;
    });
  } catch {
    return [];
  }
}

function matchReply(text) {
  const cleaned = text.trim().toLowerCase();
  if (APPROVAL_YES.some((w) => cleaned.includes(w))) return "y";
  if (APPROVAL_NO.some((w) => cleaned.includes(w))) return "n";
  return null;
}

function reliableSend(text) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync("node", [API_SCRIPT, "send", text], {
        timeout: 10000,
        windowsHide: true,
      });
      return true;
    } catch (err) {
      if (attempt < 3) {
        const sync = require("child_process").execSync;
        sync("timeout /t 1 /nobreak >nul 2>&1 || sleep 1", { windowsHide: true });
      }
    }
  }
  return false;
}

async function main() {
  // Read stdin
  let input = "";
  const chunks = [];
  const stdinDone = new Promise((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", resolve);
    process.stdin.on("error", resolve);
    setTimeout(resolve, 3000);
  });
  await stdinDone;
  input = chunks.join("");

  let toolName = "";
  let toolInput = {};
  try {
    const data = JSON.parse(input);
    toolName = data.tool_name || "";
    toolInput = data.tool_input || {};
  } catch {}

  if (!toolName) process.exit(0);

  // Skip wechat-related scripts (cron polls, notifications) — no approval needed
  if (toolName === "Bash" && toolInput.command) {
    const cmd = toolInput.command;
    if (cmd.includes("wechat-api.js") || cmd.includes("wechat-")) {
      process.exit(0); // auto-approve
    }
  }

  // Only trigger approval if CWD matches the active project (wx-switch/wx-on bound)
  if (!isActiveProject(process.cwd())) process.exit(0);

  // Check approval config — skip if disabled or tool not in list
  const config = loadConfig();
  if (!config.enabled) process.exit(0); // approval disabled
  if (config.tools && config.tools.length > 0 && !config.tools.includes(toolName)) {
    process.exit(0); // tool not in approval list
  }

  const notifyTimestamp = Date.now();
  const detail = formatToolDetail(toolName, toolInput);
  const prefix = getProjectPrefix();
  const message = prefix + "[Claude 需要审批] " + detail + "\n\n回复 y 批准 / n 拒绝\n(2分钟无回复自动批准)";

  // Write pending state
  const pending = {
    timestamp: notifyTimestamp,
    sentAt: new Date().toISOString(),
    type: "approval",
    toolName: toolName,
    toolInfo: { name: toolName, input: toolInput },
    questions: [{
      question: "是否允许执行此工具？",
      options: [
        { label: "y", index: 0 },
        { label: "n", index: 1 }
      ]
    }]
  };
  try {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), "utf-8");
  } catch {}

  // Send WeChat notification
  try {
    execFileSync("node", [API_SCRIPT, "send", message], {
      timeout: 10000,
      windowsHide: true,
    });
  } catch (err) {
    process.stderr.write(`tool-notify: send failed: ${err.message}\n`);
  }

  // Poll for WeChat reply
  const deadline = notifyTimestamp + APPROVE_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const messages = pollWeChat(notifyTimestamp);
    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      const reply = matchReply(latest.text);
      if (reply === "n") {
        // Denied
        try { fs.unlinkSync(PENDING_FILE); } catch {}
        reliableSend("[已拒绝] 工具已取消");
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "微信审批已拒绝"
          }
        }));
        process.exit(0);
      }
      if (reply === "y") {
        // Approved via WeChat
        try { fs.unlinkSync(PENDING_FILE); } catch {}
        reliableSend("[已批准] 工具执行中...");
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow"
          }
        }));
        process.exit(0);
      }
      // Reply didn't match y/n, continue waiting
    }
  }

  // Timeout — auto-approve
  try { fs.unlinkSync(PENDING_FILE); } catch {}
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow"
    }
  }));
  process.exit(0);
}

main();
