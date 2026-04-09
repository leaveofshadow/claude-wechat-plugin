#!/usr/bin/env node
// plan-notify.js — PreToolUse hook for ExitPlanMode
// Sends the plan content via WeChat, then BLOCKS waiting for WeChat reply.
// Exit 0 = approved (y), Exit 2 = denied (n), Timeout = auto-approve.

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), ".claude", "wechat-plugin");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const API_SCRIPT = path.join(__dirname, "wechat-api.js");
const PENDING_FILE = path.join(DATA_DIR, "pending.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const MAX_MSG_LEN = 800;
const APPROVE_WAIT_MS = 180_000; // 3 minutes max wait
const POLL_INTERVAL_MS = 3000;

const APPROVAL_YES = ["y", "yes", "是", "同意", "批准", "确认", "ok", "好", "可以"];
const APPROVAL_NO = ["n", "no", "否", "拒绝", "取消", "cancel", "不"];

// Check if current CWD matches the active project bound via wx-switch/wx-on
function isActiveProject(cwd) {
  try {
    const cfg = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
    const active = cfg.active;
    const project = cfg.projects && cfg.projects[active];
    if (!project || !project.workDir) return false;
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

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + "...";
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

// Fire-and-forget: launch detached PowerShell to press Enter after delay
// This auto-approves the ExitPlanMode CLI UI after the hook exits
function autoApprovePlan() {
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    Start-Sleep -Milliseconds 3000
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  `.trim();
  const child = spawn("powershell", ["-NoProfile", "-Command", ps], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  // Only trigger if CWD matches the active project (wx-switch/wx-on bound)
  if (!isActiveProject(process.cwd())) process.exit(0);

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

  let planPath = "";
  try {
    const data = JSON.parse(input);
    const transcriptPath = data.transcript_path;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
        try {
          const entry = JSON.parse(lines[i]);
          const msg = entry.message;
          if (!msg) continue;
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text" && part.text) {
                const match = part.text.match(/([^\s'"]+\.md)/g);
                if (match) {
                  for (const m of match) {
                    if (m.includes("plans") || m.includes("plan")) {
                      planPath = m;
                      break;
                    }
                  }
                }
              }
              if (planPath) break;
            }
          }
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "tool_use" && part.name === "Write" && part.input && part.input.file_path) {
                if (part.input.file_path.includes("plans")) {
                  planPath = part.input.file_path;
                }
              }
            }
          }
          if (planPath) break;
        } catch { continue; }
      }
    }
  } catch {}

  // Read plan content
  let planContent = "";
  if (planPath && fs.existsSync(planPath)) {
    planContent = fs.readFileSync(planPath, "utf-8");
  }

  const summary = planContent
    ? truncate(planContent.replace(/^---[\s\S]*?---\n?/, "").trim(), MAX_MSG_LEN)
    : "Claude 提交了一个方案，请到终端查看详情。";

  const notifyTimestamp = Date.now();
  const prefix = getProjectPrefix();
  const message = prefix + "[Claude 方案审批]\n" + summary + "\n\n回复 y 批准 / n 拒绝\n(3分钟无回复自动批准)";

  // Write pending state
  const pending = {
    timestamp: notifyTimestamp,
    sentAt: new Date().toISOString(),
    type: "plan_approval",
    planPath: planPath,
    questions: [{
      question: "是否批准此方案？",
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
    process.stderr.write(`plan-notify: send failed: ${err.message}\n`);
  }

  // ── Block and poll for WeChat reply ──────────────────────────────
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
        try {
          execFileSync("node", [API_SCRIPT, "send", "[已拒绝] 方案已取消"], {
            timeout: 5000,
            windowsHide: true,
          });
        } catch {}
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
        autoApprovePlan();
        try {
          execFileSync("node", [API_SCRIPT, "send", "[已批准] 方案执行中..."], {
            timeout: 5000,
            windowsHide: true,
          });
        } catch {}
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: {}
          }
        }));
        process.exit(0);
      }
    }
  }

  // Timeout — auto-approve
  try { fs.unlinkSync(PENDING_FILE); } catch {}
  autoApprovePlan();
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {}
    }
  }));
  process.exit(0);
}

main();
