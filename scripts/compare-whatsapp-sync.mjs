#!/usr/bin/env node

import { readFileSync } from "node:fs";

const options = parseArgs(process.argv.slice(2));
if (!options.before || !options.after) {
  printUsage();
  process.exit(1);
}

const before = readJson(options.before);
const after = readJson(options.after);
const keys = [
  ["contacts", "Contacts"],
  ["chats", "Chats"],
  ["messages", "Messages"],
  ["messageReceipts", "Message receipts"],
  ["messageUpdates", "Message updates"],
  ["mediaAssets", "Media assets"],
  ["lidMappings", "LID mappings"],
  ["historySyncBatches", "History batches"],
  ["syncEvents", "Sync events"],
];
const rows = keys.map(([key, label]) => {
  const beforeCount = Number(before.summary?.[key] ?? 0);
  const afterCount = Number(after.summary?.[key] ?? 0);
  return {
    key,
    label,
    before: beforeCount,
    after: afterCount,
    delta: afterCount - beforeCount,
    required: !["lidMappings", "messageReceipts", "messageUpdates", "mediaAssets"].includes(key),
  };
});
const missingRequired = rows.filter((row) => row.required && row.after === 0);
const result = {
  beforeFile: options.before,
  afterFile: options.after,
  accountId: after.accountId ?? before.accountId ?? null,
  chatJid: after.chatJid ?? before.chatJid ?? null,
  status: missingRequired.length === 0 ? "ok" : "missing",
  rows,
  missingRequired: missingRequired.map((row) => row.key),
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printMarkdown(result);
}

if (missingRequired.length > 0) {
  process.exitCode = 2;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printMarkdown(resultToPrint) {
  console.log("# WhatsApp Sync Comparison");
  console.log("");
  console.log(`Before: ${resultToPrint.beforeFile}`);
  console.log(`After: ${resultToPrint.afterFile}`);
  console.log(`Account: ${resultToPrint.accountId ?? "(all accounts)"}`);
  if (resultToPrint.chatJid) {
    console.log(`Chat: ${resultToPrint.chatJid}`);
  }
  console.log(`Status: ${resultToPrint.status}`);
  console.log("");
  console.log("| Area | Before | After | Delta | Status |");
  console.log("| --- | ---: | ---: | ---: | --- |");
  for (const row of resultToPrint.rows) {
    const status = row.after > 0 ? "ok" : row.required ? "missing" : "optional/missing";
    console.log(`| ${row.label} | ${row.before} | ${row.after} | ${formatDelta(row.delta)} | ${status} |`);
  }
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--before") {
      parsed.before = args[index + 1] || "";
      index += 1;
    } else if (arg === "--after") {
      parsed.after = args[index + 1] || "";
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
  node scripts/compare-whatsapp-sync.mjs --before <before.json> --after <after.json> [--json]

Inputs must be JSON artifacts produced by:
  pnpm sync:corroborate -- --account <accountId> --json`);
}
