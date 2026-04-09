#!/usr/bin/env node
// wechat-api.js — Standalone WeChat API helper for Claude Code hooks
// Usage:
//   node wechat-api.js send "message text"
//   node wechat-api.js poll [timeout_ms]

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME,
  ".mcp-wechat-server"
);
const ACCOUNT_FILE = path.join(DATA_DIR, "account.json");
const STATE_FILE = path.join(DATA_DIR, "state.json");

// ── Account & State helpers ──────────────────────────────────────

function loadAccount() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {
      updatesBuf: "",
      contextTokens: {},
      lastMessageId: 0,
    };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ── HTTP helpers ──────────────────────────────────────────────────

const BASE_URL = "https://ilinkai.weixin.qq.com/";
const CHANNEL_VERSION = "1.0.0";

function randomUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

async function apiFetch(endpoint, bodyObj, token, timeoutMs = 15000) {
  const body = JSON.stringify(bodyObj);
  const url = new URL(endpoint, BASE_URL);
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    "X-WECHAT-UIN": randomUin(),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text}`);
    return text;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Send message ─────────────────────────────────────────────────

async function sendMessage(text) {
  const account = loadAccount();
  if (!account?.botToken) {
    process.stderr.write("Not logged in. No account.json or botToken found.\n");
    process.exit(1);
  }
  const state = loadState();
  const userId = account.userId;
  const contextToken = state.contextTokens[`${account.botId}:${userId}`] || "";

  const clientId = `hook-wechat:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await apiFetch(
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: userId,
        client_id: clientId,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: { channel_version: CHANNEL_VERSION },
    },
    account.botToken
  );

  process.stdout.write("sent\n");
}

// ── Poll messages ────────────────────────────────────────────────

async function pollMessages(timeoutMs = 25000) {
  const account = loadAccount();
  if (!account?.botToken) {
    process.stderr.write("Not logged in.\n");
    process.exit(1);
  }

  let state = loadState();
  const deadline = Date.now() + (timeoutMs + 5000);

  while (true) {
    if (Date.now() > deadline) {
      process.stdout.write(JSON.stringify({ message_count: 0, messages: [] }));
      return;
    }

    let respText;
    try {
      respText = await apiFetch(
        "ilink/bot/getupdates",
        {
          get_updates_buf: state.updatesBuf || "",
          base_info: { channel_version: CHANNEL_VERSION },
        },
        account.botToken,
        timeoutMs
      );
    } catch (err) {
      if (err.name === "AbortError") {
        process.stdout.write(JSON.stringify({ message_count: 0, messages: [] }));
        return;
      }
      throw err;
    }

    const resp = JSON.parse(respText);
    if (resp.errcode) {
      process.stderr.write(`Server error: ${resp.errcode} ${resp.errmsg}\n`);
      process.exit(1);
    }

    if (resp.get_updates_buf) {
      state.updatesBuf = resp.get_updates_buf;
    }

    const newMsgs = (resp.msgs || []).filter(
      (m) => m.message_type === 1 && m.message_id && m.message_id > state.lastMessageId
    );

    if (newMsgs.length > 0) {
      state.lastMessageId = Math.max(...newMsgs.map((m) => m.message_id));
      for (const msg of newMsgs) {
        const key = `${account.botId}:${msg.from_user_id}`;
        if (msg.context_token) {
          state.contextTokens[key] = msg.context_token;
        }
      }
      saveState(state);

      const formatted = newMsgs.map((m) => {
        const items = m.item_list || [];
        const textParts = items.map((item) => {
          if (item.type === 1) return item.text_item?.text || "";
          if (item.type === 2) return "[Image]";
          if (item.type === 3) return item.voice_item?.text ? `[Voice: ${item.voice_item.text}]` : "[Voice]";
          return "";
        });
        return {
          from_user_id: m.from_user_id,
          text: textParts.join("\n"),
          create_time: m.create_time_ms ? new Date(m.create_time_ms).toISOString() : undefined,
        };
      });

      process.stdout.write(JSON.stringify({ message_count: formatted.length, messages: formatted }));
      return;
    }

    // No new messages, return empty
    saveState(state);
    process.stdout.write(JSON.stringify({ message_count: 0, messages: [] }));
    return;
  }
}

// ── CLI ──────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

if (cmd === "send") {
  const text = args.join(" ");
  if (!text) {
    process.stderr.write("Usage: node wechat-api.js send \"message text\"\n");
    process.exit(1);
  }
  sendMessage(text).catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
} else if (cmd === "poll") {
  const timeout = parseInt(args[0], 10) || 25000;
  pollMessages(timeout).catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
} else {
  process.stderr.write("Usage:\n  node wechat-api.js send \"message\"\n  node wechat-api.js poll [timeout_ms]\n");
  process.exit(1);
}
