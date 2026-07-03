import type { AuditLogFilter, AuditLogOutcome, AuditLogRecord } from "./models";

export interface AuditLogDisplay {
  icon: string;
  title: string;
  description: string;
}

export function auditLogMatchesFilters(entry: AuditLogRecord, outcomeFilter: AuditLogFilter, search: string) {
  if (outcomeFilter !== "all" && entry.outcome !== outcomeFilter) {
    return false;
  }

  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  const display = getAuditLogDisplay(entry);

  return [
    display.title,
    display.description,
    entry.action,
    entry.actor,
    entry.outcome,
    entry.resourceType ?? "",
    entry.resourceId ?? "",
    entry.details ? JSON.stringify(entry.details) : "",
  ].some((value) => value.toLowerCase().includes(query));
}

export function getAuditLogCounts(auditLogs: AuditLogRecord[]) {
  return auditLogs.reduce(
    (counts, entry) => ({
      ...counts,
      [entry.outcome]: counts[entry.outcome] + 1,
    }),
    { success: 0, failure: 0, ignored: 0 } satisfies Record<AuditLogOutcome, number>,
  );
}

export function getAuditLogDisplay(entry: AuditLogRecord): AuditLogDisplay {
  const accountId = detailString(entry, "accountId") ?? entry.resourceId ?? "the account";
  const chatJid = detailString(entry, "chatJid") ?? "the chat";
  const status = detailString(entry, "status");
  const reason = detailString(entry, "reason");

  switch (entry.action) {
    case "whatsapp.connect": {
      const requestedAccountId = detailString(entry, "requestedAccountId");
      const createdDefaultRule = detailBoolean(entry, "createdDefaultRule");
      return {
        icon: "mdi:link-plus",
        title: `Link request opened for ${entry.resourceId ?? requestedAccountId ?? "a WhatsApp account"}`,
        description: [
          status ? `WhatsApp reported the account as ${status}.` : "A WhatsApp link session was requested.",
          createdDefaultRule ? "A default deny-all number rule was created for the account." : "",
        ].filter(Boolean).join(" "),
      };
    }
    case "whatsapp.status-change":
      return {
        icon: getStatusChangeIcon(status),
        title: `WhatsApp account ${entry.resourceId ?? accountId} changed status`,
        description: [
          status ? `The account is now ${status}.` : "The account connection state changed.",
          detailBoolean(entry, "hadError") ? "The status update included an error." : "",
          detailBoolean(entry, "createdDefaultRule") ? "A default deny-all number rule was added after connection." : "",
        ].filter(Boolean).join(" "),
      };
    case "whatsapp.disconnect":
      return {
        icon: "mdi:link-off",
        title: `WhatsApp account ${entry.resourceId ?? accountId} was disconnected`,
        description: detailBoolean(entry, "hadError")
          ? "The local disconnect completed, but WhatsApp returned an error while logging out."
          : "The account session was removed locally and marked disconnected.",
      };
    case "whatsapp-account.alias-update": {
      const alias = detailString(entry, "alias");
      return {
        icon: "mdi:pencil-outline",
        title: `Display name changed for ${entry.resourceId ?? accountId}`,
        description: alias ? `The account is now shown as "${alias}".` : "The account display name was cleared.",
      };
    }
    case "session.create":
      return {
        icon: "mdi:plus-box-outline",
        title: `Hermes session created for ${chatJid}`,
        description: `Messages for account ${accountId} now route through session ${entry.resourceId ?? detailString(entry, "hermesSessionId") ?? "unknown"}.`,
      };
    case "session.reset":
      return {
        icon: "mdi:restore",
        title: `Hermes session reset for ${chatJid}`,
        description: `The routed conversation for account ${accountId} was reset in Hermes.`,
      };
    case "session.remap":
      return {
        icon: "mdi:swap-horizontal",
        title: `Chat route remapped for ${chatJid}`,
        description: `The chat session now points to Hermes session ${detailString(entry, "hermesSessionId") ?? entry.resourceId ?? "unknown"}.`,
      };
    case "number-rule.create":
      return {
        icon: "mdi:shield-plus-outline",
        title: `Number rule created for ${accountId}`,
        description: describeRuleChange(entry, "A new"),
      };
    case "number-rule.update":
      return {
        icon: "mdi:shield-edit-outline",
        title: `Number rule updated for ${describeRuleAccount(entry)}`,
        description: "The rule configuration changed. Expand the row to compare the previous and current JSON values.",
      };
    case "number-rule.delete":
      return {
        icon: "mdi:shield-remove-outline",
        title: `Number rule deleted for ${accountId}`,
        description: describeRuleChange(entry, "The removed"),
      };
    case "delivery.retry": {
      const attempts = detailNumber(entry, "attempts");
      return {
        icon: entry.outcome === "ignored" ? "mdi:debug-step-over" : "mdi:refresh",
        title: entry.outcome === "ignored" ? `Delivery retry skipped for ${chatJid}` : `Delivery retried for ${chatJid}`,
        description: reason ?? `The delivery was retried${attempts ? ` after ${attempts} attempts` : ""}.`,
      };
    }
    case "message.outbound":
      return {
        icon: "mdi:send-outline",
        title: `Outbound WhatsApp message queued for ${detailString(entry, "chatId") ?? entry.resourceId ?? "a chat"}`,
        description: `A manual outbound message${detailNumber(entry, "textLength") ? ` with ${detailNumber(entry, "textLength")} characters` : ""} was handed to WhatsApp.`,
      };
    case "message.inbound":
      return describeInboundMessage(entry);
    case "ui-branding.update":
      return {
        icon: "mdi:image-edit-outline",
        title: "App branding was updated",
        description: `The UI title is now "${detailString(entry, "title") ?? "custom"}"${detailBoolean(entry, "customIcon") ? " with a custom icon." : "."}`,
      };
    case "ui-branding.reset":
      return {
        icon: "mdi:restore",
        title: "App branding was reset",
        description: "The default title and icon were restored.",
      };
    default:
      return {
        icon: fallbackIcon(entry),
        title: humanizeAction(entry.action),
        description: describeFallback(entry),
      };
  }
}

function describeInboundMessage(entry: AuditLogRecord): AuditLogDisplay {
  const accountId = detailString(entry, "accountId") ?? "the account";
  const chatJid = detailString(entry, "chatJid") ?? entry.resourceId ?? "the chat";
  const reason = detailString(entry, "reason");

  if (entry.outcome === "ignored") {
    return {
      icon: "mdi:debug-step-over",
      title: `Inbound message from ${chatJid} was ignored`,
      description: reason ?? "The message matched a rule or policy that skips routing.",
    };
  }

  if (entry.outcome === "failure") {
    return {
      icon: "mdi:message-alert-outline",
      title: "Inbound WhatsApp message could not be routed",
      description: reason ?? "The inbound payload could not be normalized or routed.",
    };
  }

  const hermesSessionId = detailString(entry, "hermesSessionId");
  const duplicate = detailBoolean(entry, "duplicate");
  return {
    icon: duplicate ? "mdi:content-duplicate" : "mdi:message-arrow-right-outline",
    title: duplicate ? `Duplicate inbound message skipped for ${chatJid}` : `Inbound message routed for ${chatJid}`,
    description: duplicate
      ? `The message for account ${accountId} was already processed.`
      : `The message for account ${accountId} was routed${hermesSessionId ? ` to Hermes session ${hermesSessionId}` : ""}.`,
  };
}

function describeRuleChange(entry: AuditLogRecord, prefix: string) {
  const action = detailString(entry, "action") ?? "rule";
  const matchType = detailString(entry, "matchType") ?? "match";
  const pattern = detailString(entry, "pattern");
  const enabled = detailBoolean(entry, "enabled");
  return `${prefix} ${action} rule uses ${matchType}${pattern ? ` "${pattern}"` : ""}${typeof enabled === "boolean" ? ` and is ${enabled ? "enabled" : "disabled"}` : ""}.`;
}

function describeRuleAccount(entry: AuditLogRecord) {
  const after = detailObject(entry, "after");
  const before = detailObject(entry, "before");
  return stringFromObject(after, "accountId") ?? stringFromObject(before, "accountId") ?? "the account";
}

function describeFallback(entry: AuditLogRecord) {
  if (entry.resourceType) {
    return `${entry.actor} changed ${entry.resourceType}${entry.resourceId ? ` ${entry.resourceId}` : ""}.`;
  }

  return `${entry.actor} recorded this event.`;
}

function fallbackIcon(entry: AuditLogRecord) {
  if (entry.outcome === "failure") {
    return "mdi:alert-circle-outline";
  }

  if (entry.outcome === "ignored") {
    return "mdi:debug-step-over";
  }

  return "mdi:check-circle-outline";
}

function getStatusChangeIcon(status: string | undefined) {
  if (status === "connected") {
    return "mdi:wifi-check";
  }

  if (status === "connecting") {
    return "mdi:wifi-sync";
  }

  if (status === "disconnected") {
    return "mdi:wifi-off";
  }

  return "mdi:sync";
}

function humanizeAction(action: string) {
  return action
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function detailString(entry: AuditLogRecord, key: string) {
  const value = entry.details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function detailBoolean(entry: AuditLogRecord, key: string) {
  const value = entry.details?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function detailNumber(entry: AuditLogRecord, key: string) {
  const value = entry.details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function detailObject(entry: AuditLogRecord, key: string) {
  const value = entry.details?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringFromObject(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}
