import type { DeliveryRecord, NumberRuleRecord, WhatsAppMessageEvent } from "../domain/types.js";
import type { BridgeDeliveryStore, NumberRuleStore } from "./chat-session-router.js";

export interface NumberRuleDecision {
  allowed: boolean;
  reason?: string;
  rule?: NumberRuleRecord;
}

export function evaluateNumberRules(
  store: NumberRuleStore | undefined,
  event: WhatsAppMessageEvent,
): NumberRuleDecision {
  const rules = store?.listNumberRules(event.accountId).filter((rule) => rule.enabled) ?? [];
  if (rules.length === 0) {
    return { allowed: true };
  }

  const candidates = getNumberCandidates(event);
  const allowRules = rules.filter((rule) => rule.action === "allow");
  const allowedBy = allowRules.find((rule) => matchesRule(rule, candidates));
  const deniedBy = rules.find(
    (rule) =>
      rule.action === "deny" &&
      matchesRule(rule, candidates) &&
      !(rule.matchType === "all" && allowedBy),
  );
  if (deniedBy) {
    return {
      allowed: false,
      reason: `Blocked by number rule: ${describeRule(deniedBy)}`,
      rule: deniedBy,
    };
  }

  if (allowRules.length > 0 && !allowedBy) {
    return {
      allowed: false,
      reason: "Blocked by number rules: no allow rule matched",
    };
  }

  return { allowed: true };
}

export function recordBlockedNumberDelivery(
  deliveryStore: BridgeDeliveryStore | undefined,
  event: WhatsAppMessageEvent,
  reason: string,
): DeliveryRecord {
  const now = new Date().toISOString();
  const record: DeliveryRecord = {
    id: `${event.accountId}:${event.chatJid}:${event.messageId}`,
    accountId: event.accountId,
    chatJid: event.chatJid,
    chatType: event.chatType,
    sessionKey: event.sessionKey,
    inboundMessageId: event.messageId,
    inboundText: event.text,
    outboundText: "",
    status: "ignored",
    attempts: 0,
    error: reason,
    createdAt: now,
    updatedAt: now,
  };

  deliveryStore?.saveDelivery(record);
  return record;
}

function matchesRule(rule: NumberRuleRecord, candidates: string[]) {
  if (rule.matchType === "all") {
    return true;
  }

  if (rule.matchType === "exact") {
    const patternCandidates = normalizeCandidates(rule.pattern);
    return candidates.some((candidate) => patternCandidates.includes(candidate));
  }

  try {
    const expression = new RegExp(rule.pattern);
    return candidates.some((candidate) => expression.test(candidate));
  } catch {
    return false;
  }
}

function getNumberCandidates(event: WhatsAppMessageEvent) {
  return [
    event.senderJid,
    event.senderId,
    event.participantJid,
    event.chatJid,
    event.chatId,
    ...(event.alternateJids ?? []),
  ].flatMap((value) => normalizeCandidates(value)).filter(unique);
}

function normalizeCandidates(value: string | undefined) {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  const bareJid = trimmed.split("@")[0] ?? trimmed;
  const withoutDevice = bareJid.split(":")[0] ?? bareJid;
  const digits = withoutDevice.replace(/\D/g, "");

  return [trimmed, bareJid, withoutDevice, digits].filter(Boolean).filter(unique);
}

function describeRule(rule: NumberRuleRecord) {
  if (rule.label?.trim()) {
    return rule.label.trim();
  }

  if (rule.matchType === "all") {
    return `${rule.action} all`;
  }

  return `${rule.action} ${rule.matchType} ${rule.pattern}`;
}

function unique(value: string, index: number, values: string[]) {
  return values.indexOf(value) === index;
}
