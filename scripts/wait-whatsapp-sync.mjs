#!/usr/bin/env node

const options = parseArgs(process.argv.slice(2));
const apiUrl = (options.apiUrl || process.env.WHATSAPP_MANAGER_API_URL || `http://127.0.0.1:${process.env.WHATSAPP_MANAGER_API_PORT || "3000"}`).replace(/\/+$/, "");
const apiToken = options.token || process.env.WHATSAPP_MANAGER_API_TOKEN || "local-dev-token";
const accountId = options.account || process.env.WHATSAPP_ACCOUNT_ID || "";
const intervalMs = Number(options.intervalMs || process.env.WHATSAPP_SYNC_WAIT_INTERVAL_MS || 5000);
const timeoutMs = Number(options.timeoutMs || process.env.WHATSAPP_SYNC_WAIT_TIMEOUT_MS || 120000);
const stableSamples = Number(options.stableSamples || process.env.WHATSAPP_SYNC_WAIT_STABLE_SAMPLES || 3);
const startedAt = Date.now();
const history = [];

while (Date.now() - startedAt <= timeoutMs) {
  const summary = await request(withAccount("/whatsapp/sync/summary"));
  const snapshot = normalizeSummary(summary);
  history.push(snapshot);
  if (history.length > stableSamples) {
    history.shift();
  }

  printProgress(snapshot);
  if (hasRequiredRows(snapshot) && isStable(history, stableSamples)) {
    console.log("");
    console.log("WhatsApp sync counts are populated and stable.");
    console.log(JSON.stringify(snapshot, null, 2));
    process.exit(0);
  }

  await sleep(intervalMs);
}

console.error("");
console.error(`Timed out after ${timeoutMs}ms waiting for WhatsApp sync counts to populate and stabilize.`);
process.exit(2);

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

function normalizeSummary(summary) {
  return {
    contacts: Number(summary.contacts ?? 0),
    chats: Number(summary.chats ?? 0),
    messages: Number(summary.messages ?? 0),
    lidMappings: Number(summary.lidMappings ?? 0),
    historySyncBatches: Number(summary.historySyncBatches ?? 0),
    syncEvents: Number(summary.syncEvents ?? 0),
  };
}

function hasRequiredRows(summary) {
  return summary.contacts > 0 &&
    summary.chats > 0 &&
    summary.messages > 0 &&
    summary.historySyncBatches > 0 &&
    summary.syncEvents > 0;
}

function isStable(summaries, sampleCount) {
  if (summaries.length < sampleCount) {
    return false;
  }

  const latest = JSON.stringify(summaries[summaries.length - 1]);
  return summaries.every((summary) => JSON.stringify(summary) === latest);
}

function printProgress(summary) {
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[${elapsedSeconds}s] contacts=${summary.contacts} chats=${summary.chats} messages=${summary.messages} history=${summary.historySyncBatches} events=${summary.syncEvents} lidMappings=${summary.lidMappings}`);
}

function withAccount(path) {
  if (!accountId) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}accountId=${encodeURIComponent(accountId)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--account") {
      parsed.account = args[index + 1] || "";
      index += 1;
    } else if (arg === "--api-url") {
      parsed.apiUrl = args[index + 1] || "";
      index += 1;
    } else if (arg === "--token") {
      parsed.token = args[index + 1] || "";
      index += 1;
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = args[index + 1] || "";
      index += 1;
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = args[index + 1] || "";
      index += 1;
    } else if (arg === "--stable-samples") {
      parsed.stableSamples = args[index + 1] || "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/wait-whatsapp-sync.mjs [--account <accountId>] [--timeout-ms 120000] [--interval-ms 5000] [--stable-samples 3]

Waits until contacts, chats, messages, history sync batches, and sync events are nonzero and stable.
LID mappings are observed but optional.`);
}
