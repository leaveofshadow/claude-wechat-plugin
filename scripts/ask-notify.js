#!/usr/bin/env node
// ask-notify.js — PreToolUse hook for AskUserQuestion
// Blocking approach: sends notification, polls for WeChat reply,
// matches to options, copies to clipboard. Same pattern as tool/plan approval.
// No separate daemon needed.

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(os.homedir(), ".claude", "wechat-plugin");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const API_SCRIPT = path.join(__dirname, "wechat-api.js");
const PENDING_FILE = path.join(DATA_DIR, "pending.json");
const REPLY_FILE = path.join(DATA_DIR, "reply.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const APPROVE_WAIT_MS = 120_000; // 2 minutes max wait
const POLL_INTERVAL_MS = 3000;

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

function formatQuestion(q) {
  let text = q.question;
  if (q.options && q.options.length) {
    const opts = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.label}`).join("\n");
    text += "\n" + opts;
  }
  return text;
}

function matchOption(text, questions) {
  if (!questions || !questions.length) return { matchedOption: null, matchedIndex: -1, rawText: text.trim() };

  const q = questions[0];
  const options = q.options || [];
  const cleaned = text.trim().toLowerCase();

  // Approval keywords (y/n)
  const approvalYes = ["y", "yes", "是", "同意", "批准", "确认", "ok", "好", "可以"];
  const approvalNo = ["n", "no", "否", "拒绝", "取消", "cancel", "不"];
  if (options.some((o) => o.label === "y") && options.some((o) => o.label === "n")) {
    if (approvalYes.includes(cleaned)) {
      const idx = options.findIndex((o) => o.label === "y");
      return { matchedOption: "y", matchedIndex: idx, rawText: text.trim() };
    }
    if (approvalNo.includes(cleaned)) {
      const idx = options.findIndex((o) => o.label === "n");
      return { matchedOption: "n", matchedIndex: idx, rawText: text.trim() };
    }
  }

  // 1. Letter match (A, B, C, D)
  const letterMatch = cleaned.toUpperCase().match(/^[ABCD]$/);
  if (letterMatch) {
    const idx = letterMatch[0].charCodeAt(0) - 65;
    if (options[idx]) return { matchedOption: options[idx].label, matchedIndex: idx, rawText: text.trim() };
  }

  // 2. Number match (1, 2, 3, 4)
  const numMatch = cleaned.match(/^[1-4]$/);
  if (numMatch) {
    const idx = parseInt(numMatch[0]) - 1;
    if (options[idx]) return { matchedOption: options[idx].label, matchedIndex: idx, rawText: text.trim() };
  }

  // 3. Text match (contains option label)
  for (let i = 0; i < options.length; i++) {
    if (cleaned.includes(options[i].label.toLowerCase()) || options[i].label.toLowerCase().includes(cleaned)) {
      return { matchedOption: options[i].label, matchedIndex: i, rawText: text.trim() };
    }
  }

  // 4. No match — return raw text
  return { matchedOption: null, matchedIndex: -1, rawText: text.trim() };
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

function copyToClipboard(text) {
  try {
    const escaped = text.replace(/'/g, "''");
    const ps = `Set-Clipboard -Value '${escaped}'`;
    execFileSync("powershell", ["-NoProfile", "-Command", ps], {
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function autoType(optionIndex) {
  try {
    // Use arrow keys to navigate to the option, then Enter to select
    // optionIndex is 0-based; first option needs no navigation, just Enter
    const downPresses = optionIndex; // number of DOWN arrow presses needed
    let keySequence = "";
    for (let i = 0; i < downPresses; i++) {
      keySequence += "{DOWN}";
    }
    keySequence += "{ENTER}";
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 3000
      [System.Windows.Forms.SendKeys]::SendWait('${keySequence}')
    `.trim();
    const child = spawn("powershell", ["-NoProfile", "-Command", ps], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Only trigger if CWD matches the active project (wx-switch/wx-on bound)
  if (!isActiveProject(process.cwd())) process.exit(0);

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

  let questions = [];
  let hookEvent = "unknown";
  try {
    const data = JSON.parse(input);
    hookEvent = data.hook_event_name || "unknown";
    if (data.tool_input && data.tool_input.questions) {
      questions = data.tool_input.questions;
    }
  } catch {}

  if (!questions.length) process.exit(0);

  const isPre = hookEvent.includes("Pre");
  const questionText = questions.map(formatQuestion).join("\n\n");

  // Only block on PreToolUse
  if (!isPre) {
    // PostToolUse: just send a brief acknowledgment
    const label = "[Claude 提问已回答] ";
    try {
      execFileSync("node", [API_SCRIPT, "send", label + questionText.slice(0, 200)], {
        timeout: 10000,
        windowsHide: true,
      });
    } catch {}
    process.exit(0);
  }

  // --- PreToolUse: blocking poll for WeChat reply ---

  const notifyTimestamp = Date.now();
  const prefix = getProjectPrefix();
  const message = prefix + "[Claude 提问] " + questionText.slice(0, 800) + "\n\n回复选项字母(A/B/C/D)或数字(1/2/3/4)\n(2分钟无回复继续等待终端操作)";

  // Write pending state
  const pending = {
    timestamp: notifyTimestamp,
    sentAt: new Date().toISOString(),
    type: "question",
    questions: questions.map((q) => ({
      question: q.question,
      options: (q.options || []).map((o, i) => ({ label: o.label, index: i })),
    })),
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
    process.stderr.write(`ask-notify: send failed: ${err.message}\n`);
  }

  // Poll for WeChat reply (blocking)
  const deadline = notifyTimestamp + APPROVE_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const messages = pollWeChat(notifyTimestamp);
    if (messages.length > 0) {
      const latest = messages[messages.length - 1];
      const match = matchOption(latest.text, pending.questions);

      // Write reply file
      try {
        fs.writeFileSync(REPLY_FILE, JSON.stringify({
          ...match,
          type: "question",
          receivedAt: latest.create_time || new Date().toISOString(),
        }, null, 2), "utf-8");
      } catch {}

      // Auto-type the option index number (1-based) instead of Chinese text
      // SendKeys doesn't support Chinese characters, and UI expects number selection
      let typed = false;
      if (match.matchedIndex >= 0) {
        typed = autoType(match.matchedIndex);
      } else {
        // Fallback: copy raw text to clipboard
        const replyText = match.rawText || latest.text;
        copyToClipboard(replyText);
      }

      // Clean up pending
      try { fs.unlinkSync(PENDING_FILE); } catch {}

      // Send confirmation
      const confirmMsg = match.matchedOption
        ? `[已收到] 你的选择: ${match.matchedOption}${typed ? " (已自动输入)" : " (已复制到剪贴板)"}`
        : `[已收到] "${latest.text}"${typed ? " (已自动输入)" : " (未匹配到选项)"}`;
      reliableSend(confirmMsg);

      // Output permissionDecision with updatedInput to bypass CLI UI
      if (match.matchedOption && questions.length > 0) {
        const answers = {};
        for (const q of questions) {
          answers[q.question] = match.matchedOption;
        }
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: {
              questions: questions,
              answers: answers
            }
          }
        }));
      }

      process.exit(0);
    }
  }

  // Timeout — clean up, proceed without reply
  try { fs.unlinkSync(PENDING_FILE); } catch {}
  reliableSend("[超时] 未收到微信回复，请终端操作");
  process.exit(0);
}

main();
