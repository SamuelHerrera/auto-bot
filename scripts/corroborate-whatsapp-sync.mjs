#!/usr/bin/env node

const options = parseArgs(process.argv.slice(2));
const apiUrl = (options.apiUrl || process.env.WHATSAPP_MANAGER_API_URL || `http://127.0.0.1:${process.env.WHATSAPP_MANAGER_API_PORT || "3000"}`).replace(/\/+$/, "");
const apiToken = options.token || process.env.WHATSAPP_MANAGER_API_TOKEN || "local-dev-token";
const accountId = options.account || process.env.WHATSAPP_ACCOUNT_ID || "";
const chatJid = options.chat || process.env.WHATSAPP_CHAT_JID || "";

const endpoints = {
  summary: "/whatsapp/sync/summary",
  historyBatches: "/whatsapp/sync/history-batches?limit=20",
  chats: "/whatsapp/sync/chats?limit=20",
  contacts: "/whatsapp/sync/contacts?limit=20",
  lidMappings: "/whatsapp/sync/lid-mappings?limit=50",
  syncEvents: "/whatsapp/sync/events?limit=50",
  messages: chatJid
    ? `/whatsapp/sync/messages?limit=50&chatJid=${encodeURIComponent(chatJid)}`
    : "/whatsapp/sync/messages?limit=50",
};

const data = await loadAll(endpoints);
const summary = data.summary;
const checks = [
  createCheck("Contacts", summary.contacts, true, "Contact rows are persisted"),
  createCheck("Chats", summary.chats, true, "Chat rows are persisted"),
  createCheck("Messages", summary.messages, true, chatJid ? `Messages are persisted for ${chatJid}` : "Message rows are persisted"),
  createCheck("LID mappings", summary.lidMappings, false, "LID to phone mappings are persisted when WhatsApp supplies them"),
  createCheck("History batches", summary.historySyncBatches, true, "History sync batches are journaled"),
  createCheck("Sync events", summary.syncEvents, true, "Raw sync events are journaled"),
];
const result = {
  apiUrl,
  accountId: accountId || null,
  chatJid: chatJid || null,
  checkedAt: new Date().toISOString(),
  status: checks.every((check) => check.status !== "missing") ? "ok" : "missing",
  summary,
  checks,
  latest: {
    historyBatches: rows(data.historyBatches.items),
    chats: rows(data.chats.items),
    contacts: rows(data.contacts.items),
    messages: rows(data.messages.items),
    lidMappings: rows(data.lidMappings.items),
    syncEvents: rows(data.syncEvents.items),
  },
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHeader(result);
  printMatrix(result.checks);
  printLatest("Latest history batches", result.latest.historyBatches, ["syncType", "chatCount", "contactCount", "messageCount", "receivedAt"]);
  printLatest("Latest chats", result.latest.chats, ["chatJid", "displayName", "lastMessageAt", "lastSeenAt"]);
  printLatest("Latest messages", result.latest.messages, ["chatJid", "messageId", "text", "timestamp"]);
  printLatest("Latest LID mappings", result.latest.lidMappings, ["lidJid", "pnJid", "lastSeenAt"]);
  printLatest("Latest sync events", result.latest.syncEvents, ["eventType", "payloadHash", "receivedAt"]);
}

const missingRequired = checks.filter((check) => check.required && Number(check.count) === 0);
if (missingRequired.length > 0) {
  process.exitCode = 2;
}

async function loadAll(paths) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await request(withAccount(path))]),
  );
  return Object.fromEntries(entries);
}

async function request(path) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${path}: ${await response.text()}`);
  }
  return response.json();
}

function withAccount(path) {
  if (!accountId) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}accountId=${encodeURIComponent(accountId)}`;
}

function createCheck(name, count, required, notes) {
  return {
    name,
    count,
    required,
    status: Number(count) > 0 ? "ok" : required ? "missing" : "optional/missing",
    notes,
  };
}

function rows(items) {
  return Array.isArray(items) ? items : [];
}

function printHeader(resultToPrint) {
  console.log("# WhatsApp Sync Corroboration");
  console.log("");
  console.log(`API: ${resultToPrint.apiUrl}`);
  console.log(`Account: ${resultToPrint.accountId || "(all accounts)"}`);
  if (resultToPrint.chatJid) {
    console.log(`Chat: ${resultToPrint.chatJid}`);
  }
  console.log(`Status: ${resultToPrint.status}`);
  console.log("");
}

function printMatrix(checksToPrint) {
  console.log("| Area | Count | Status | Notes |");
  console.log("| --- | ---: | --- | --- |");
  for (const check of checksToPrint) {
    console.log(`| ${check.name} | ${check.count} | ${check.status} | ${check.notes} |`);
  }
  console.log("");
}

function printLatest(title, rows, fields) {
  console.log(`## ${title}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("");
    console.log("No rows.");
    console.log("");
    return;
  }

  console.log("");
  console.log(`| ${fields.join(" | ")} |`);
  console.log(`| ${fields.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(0, 5)) {
    console.log(`| ${fields.map((field) => cleanCell(row[field])).join(" | ")} |`);
  }
  console.log("");
}

function cleanCell(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--account") {
      parsed.account = args[index + 1] || "";
      index += 1;
    } else if (arg === "--chat") {
      parsed.chat = args[index + 1] || "";
      index += 1;
    } else if (arg === "--api-url") {
      parsed.apiUrl = args[index + 1] || "";
      index += 1;
    } else if (arg === "--token") {
      parsed.token = args[index + 1] || "";
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/corroborate-whatsapp-sync.mjs [--account <accountId>] [--chat <chatJid>] [--json]

Environment:
  WHATSAPP_MANAGER_API_URL      Default: http://127.0.0.1:<port>
  WHATSAPP_MANAGER_API_PORT     Default: 3000
  WHATSAPP_MANAGER_API_TOKEN    Default: local-dev-token
  WHATSAPP_ACCOUNT_ID           Optional account filter
  WHATSAPP_CHAT_JID             Optional chat filter for messages`);
}
