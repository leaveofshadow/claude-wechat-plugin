#!/usr/bin/env node
// notify.js — Claude Code Stop hook
// Sends the last assistant response as a WeChat notification.
// Triggered when Claude stops generating (finish / need-approval).
//
// Input (stdin): JSON with { "stop_reason": string, "transcript_path": string }

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), ".claude", "wechat-plugin");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const API_SCRIPT = path.join(__dirname, "wechat-api.js");
const MAX_MSG_LEN = 800;

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function formatToolDetail(toolInfo) {
  const name = toolInfo.name || "unknown";
  const inp = toolInfo.input || {};
  // Show key fields based on tool type
  if (name === "Bash" && inp.command) {
    return `Bash: ${inp.command.slice(0, 200)}`;
  }
  if ((name === "Edit" || name === "Write") && inp.file_path) {
    return `${name}: ${inp.file_path}`;
  }
  if (name === "Agent" && inp.description) {
    return `Agent: ${inp.description}`;
  }
  return `${name}: ${JSON.stringify(inp).slice(0, 200)}`;
}

function writeApprovalPending(toolInfo) {
  const pendingFile = path.join(DATA_DIR, "pending.json");
  const pending = {
    timestamp: Date.now(),
    sentAt: new Date().toISOString(),
    type: "approval",
    toolInfo: toolInfo ? { name: toolInfo.name, input: toolInfo.input } : null,
    questions: [{
      question: "是否批准此操作？",
      options: [
        { label: "y", index: 0 },
        { label: "n", index: 1 }
      ]
    }]
  };
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2), "utf-8");
  } catch {}
}

function writeEndTurnPending() {
  const pendingFile = path.join(DATA_DIR, "endturn.json");
  const pending = {
    timestamp: Date.now(),
    sentAt: new Date().toISOString(),
    type: "end_turn",
    questions: [] // no structured options — free-form reply
  };
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2), "utf-8");
  } catch {}
}

const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

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

const DEBUG_LOG = path.join(DATA_DIR, "debug.log");

function debugLog(msg) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
  } catch {}
}

async function main() {
  // Only send notifications for the active project session (the one bound via /wx-on)
  if (!isActiveProject(process.cwd())) return;

  // Read stdin (hook input from Claude Code)
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

  debugLog(`RAW INPUT: ${input.slice(0, 500)}`);

  // Extract last assistant message text from transcript JSONL file
  let lastText = "";
  let stopReason = "end_turn";
  let lastToolInfo = null;
  try {
    const data = JSON.parse(input);
    stopReason = data.stop_reason || "end_turn";
    const transcriptPath = data.transcript_path;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        let entry;
        try { entry = JSON.parse(lines[i]); } catch { continue; }
        const msg = entry.message;
        if (!msg || msg.role !== "assistant") continue;
        const content = msg.content;
        if (Array.isArray(content)) {
          // Extract tool_use info for approval notifications
          if (!lastToolInfo) {
            const toolParts = content.filter((c) => c.type === "tool_use");
            if (toolParts.length) {
              const t = toolParts[toolParts.length - 1];
              lastToolInfo = { name: t.name || "", input: t.input || {} };
            }
          }
          const textParts = content.filter((c) => c.type === "text").map((c) => c.text);
          if (textParts.length) { lastText = textParts.join("\n"); break; }
        } else if (typeof content === "string" && content.trim()) {
          lastText = content; break;
        }
      }
    }
  } catch {
    lastText = input || "";
  }

  // Skip notifications for cron poll with no messages
  if (lastText.trim() === "NO_MSG") return;

  debugLog(`stopReason=${stopReason} lastToolInfo=${lastToolInfo ? JSON.stringify(lastToolInfo) : "null"} lastText=${lastText ? lastText.slice(0,100) : "(empty)"}`);

  // Build notification message with project prefix
  const prefix = getProjectPrefix();
  let message;
  if (stopReason === "tool_use" && lastToolInfo) {
    // Tool approval — may have no text, only tool_use blocks
    const toolDetail = formatToolDetail(lastToolInfo);
    message = prefix + "[Claude 需要审批] " + toolDetail + "\n\n回复 y 批准 / n 拒绝";
    writeApprovalPending(lastToolInfo);
    debugLog(`SENDING approval: ${message.slice(0, 200)}`);
  } else if (stopReason === "tool_use") {
    if (!lastText.trim()) return; // no info at all, skip
    message = prefix + "[Claude 需要审批] " + truncate(lastText.replace(/\n{2,}/g, "\n"), MAX_MSG_LEN);
    writeApprovalPending(null);
  } else {
    // Normal end_turn — need text to send
    if (!lastText.trim()) return;
    message = prefix + "[Claude 已完成] " + truncate(lastText.replace(/\n{2,}/g, "\n"), MAX_MSG_LEN);
    // Write pending state for end_turn — user can reply with next command
    writeEndTurnPending();
  }

  try {
    execFileSync("node", [API_SCRIPT, "send", message], {
      timeout: 10000,
      windowsHide: true,
    });
  } catch (err) {
    process.stderr.write(`notify: ${err.message}\n`);
  }

  // Clean up reply file (already consumed)
  try { fs.unlinkSync(path.join(DATA_DIR, "reply.json")); } catch {}
}

main();
