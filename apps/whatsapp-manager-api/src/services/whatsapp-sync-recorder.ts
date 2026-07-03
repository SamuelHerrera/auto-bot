import { createHash } from "node:crypto";
import type {
  WhatsAppChatRecord,
  WhatsAppChatType,
  WhatsAppContactRecord,
  WhatsAppHistorySyncBatchRecord,
  WhatsAppLidMappingRecord,
  WhatsAppMediaAssetRecord,
  WhatsAppMessageReceiptRecord,
  WhatsAppMessageUpdateRecord,
  WhatsAppStoredMessageRecord,
  WhatsAppSyncEventRecord,
} from "../domain/types.js";
import { getWhatsAppChatType } from "../domain/types.js";
import type { WhatsAppSyncStore } from "./chat-session-router.js";
import type { WhatsAppSyncEvent } from "./whatsapp-service.js";

export function recordWhatsAppSyncEvent(store: WhatsAppSyncStore | undefined, event: WhatsAppSyncEvent): void {
  if (!store) {
    return;
  }

  const rawJson = safeJsonStringify(event.payload);
  const payloadHash = hashPayload(rawJson);
  store.saveWhatsAppSyncEvent({
    id: `${event.accountId}:${event.eventType}:${payloadHash}`,
    accountId: event.accountId,
    eventType: event.eventType,
    payloadHash,
    rawJson,
    receivedAt: event.receivedAt,
  });

  for (const contact of extractContacts(event)) {
    store.saveWhatsAppContact(contact);
  }
  for (const chat of extractChats(event)) {
    store.saveWhatsAppChat(chat);
  }
  for (const message of extractMessages(event)) {
    store.saveWhatsAppMessage(message);
  }
  for (const receipt of extractMessageReceipts(event)) {
    store.saveWhatsAppMessageReceipt(receipt);
  }
  for (const update of extractMessageUpdates(event, payloadHash)) {
    store.saveWhatsAppMessageUpdate(update);
  }
  for (const mediaAsset of extractMediaAssets(event)) {
    store.saveWhatsAppMediaAsset(mediaAsset);
  }
  for (const mapping of extractLidMappings(event)) {
    store.saveWhatsAppLidMapping(mapping);
  }
  const batch = extractHistorySyncBatch(event, rawJson);
  if (batch) {
    store.saveWhatsAppHistorySyncBatch(batch);
  }
}

function extractContacts(event: WhatsAppSyncEvent): WhatsAppContactRecord[] {
  const contacts =
    event.eventType === "contacts.upsert" || event.eventType === "contacts.update"
      ? readPayloadArray(event.payload)
      : readArray(event.payload, "contacts");
  return contacts.flatMap((item) => {
    const value = asRecord(item);
    const contactJid = readString(value.id) ?? readString(value.jid) ?? readString(value.lid) ?? readString(value.phoneNumber);
    if (!contactJid) {
      return [];
    }

    const now = event.receivedAt;
    const phoneNumber = readString(value.phoneNumber);
    const lidJid = readString(value.lid);
    const name = readString(value.name);
    const notifyName = readString(value.notify) ?? readString(value.notifyName);
    const verifiedName = readString(value.verifiedName);
    return [{
      accountId: event.accountId,
      contactJid,
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(lidJid ? { lidJid } : {}),
      ...(name ? { name } : {}),
      ...(notifyName ? { notifyName } : {}),
      ...(verifiedName ? { verifiedName } : {}),
      rawJson: safeJsonStringify(value),
      firstSeenAt: now,
      lastSeenAt: now,
    }];
  });
}

function extractChats(event: WhatsAppSyncEvent): WhatsAppChatRecord[] {
  const chats =
    event.eventType === "chats.upsert" || event.eventType === "chats.update" || event.eventType === "groups.upsert" || event.eventType === "groups.update"
      ? readPayloadArray(event.payload)
      : readArray(event.payload, "chats");
  return chats.flatMap((item) => {
    const value = asRecord(item);
    const chatJid = readString(value.id) ?? readString(value.jid);
    if (!chatJid) {
      return [];
    }

    const lastMessageAt = normalizeTimestamp(value.conversationTimestamp ?? value.t ?? value.lastMessageTimestamp);
    const mutedUntil = normalizeTimestamp(value.muteEndTime);
    const displayName = readString(value.name) ?? readString(value.subject);
    const unreadCount = readNumber(value.unreadCount);
    const now = event.receivedAt;
    return [{
      accountId: event.accountId,
      chatJid,
      chatType: getWhatsAppChatType(chatJid),
      ...(displayName ? { displayName } : {}),
      ...(unreadCount !== undefined ? { unreadCount } : {}),
      ...(lastMessageAt ? { lastMessageAt } : {}),
      ...(typeof value.archived === "boolean" ? { archived: value.archived } : {}),
      ...(typeof value.pinned === "boolean" ? { pinned: value.pinned } : {}),
      ...(mutedUntil ? { mutedUntil } : {}),
      rawJson: safeJsonStringify(value),
      firstSeenAt: now,
      lastSeenAt: now,
    }];
  });
}

function extractMessages(event: WhatsAppSyncEvent): WhatsAppStoredMessageRecord[] {
  const messages = readArray(event.payload, "messages");
  return messages.flatMap((item) => {
    const message = asRecord(item);
    const key = asRecord(message.key);
    const chatJid = readString(key.remoteJid);
    const messageId = readString(key.id);
    if (!chatJid || !messageId) {
      return [];
    }

    const content = asRecord(message.message);
    const messageType = Object.keys(content)[0];
    const text = extractMessageText(content);
    const media = extractMessageMedia(content);
    const reaction = extractReaction(content);
    return [{
      accountId: event.accountId,
      chatJid,
      messageId,
      ...(readString(key.participant) ?? chatJid ? { senderJid: readString(key.participant) ?? chatJid } : {}),
      fromMe: Boolean(key.fromMe),
      timestamp: normalizeTimestamp(message.messageTimestamp) ?? event.receivedAt,
      ...(messageType ? { messageType } : {}),
      ...(text ? { text } : {}),
      ...(media.length ? { mediaJson: safeJsonStringify(media) } : {}),
      ...(reaction ? { reactionJson: safeJsonStringify(reaction) } : {}),
      rawJson: safeJsonStringify(message),
      receivedAt: event.receivedAt,
    }];
  });
}

function extractMessageReceipts(event: WhatsAppSyncEvent): WhatsAppMessageReceiptRecord[] {
  if (event.eventType !== "message-receipt.update") {
    return [];
  }

  return readPayloadArray(event.payload).flatMap((item, index) => {
    const value = asRecord(item);
    const key = asRecord(value.key);
    const chatJid = readString(key.remoteJid) ?? readString(value.remoteJid) ?? readString(value.chatJid);
    const messageId = readString(key.id) ?? readString(value.messageId) ?? readString(value.id);
    if (!chatJid || !messageId) {
      return [];
    }

    const participantJid = readString(value.userJid) ?? readString(value.participant) ?? readString(key.participant);
    const receiptType = readString(value.receipt) ?? readString(value.type) ?? readString(value.status);
    const timestamp = normalizeTimestamp(value.t ?? value.timestamp ?? value.receiptTimestamp);
    return [{
      id: `${event.accountId}:${chatJid}:${messageId}:${participantJid ?? "unknown"}:${receiptType ?? "receipt"}:${index}`,
      accountId: event.accountId,
      chatJid,
      messageId,
      ...(participantJid ? { participantJid } : {}),
      ...(receiptType ? { receiptType } : {}),
      ...(timestamp ? { timestamp } : {}),
      rawJson: safeJsonStringify(value),
      receivedAt: event.receivedAt,
    }];
  });
}

function extractMessageUpdates(event: WhatsAppSyncEvent, payloadHash: string): WhatsAppMessageUpdateRecord[] {
  const updateTypes = new Set([
    "messages.update",
    "messages.delete",
    "messages.media-update",
    "messages.reaction",
  ]);
  if (!updateTypes.has(event.eventType)) {
    return [];
  }

  const items = event.eventType === "messages.delete"
    ? readDeleteItems(event.payload)
    : readPayloadArray(event.payload);
  return items.flatMap((item, index) => {
    const value = asRecord(item);
    const key = asRecord(value.key);
    const chatJid = readString(key.remoteJid) ?? readString(value.jid) ?? readString(value.chatJid);
    const messageId = readString(key.id) ?? readString(value.messageId) ?? readString(value.id);
    return [{
      id: `${event.accountId}:${event.eventType}:${chatJid ?? "unknown"}:${messageId ?? payloadHash}:${index}`,
      accountId: event.accountId,
      ...(chatJid ? { chatJid } : {}),
      ...(messageId ? { messageId } : {}),
      updateType: event.eventType,
      rawJson: safeJsonStringify(value),
      receivedAt: event.receivedAt,
    }];
  });
}

function extractMediaAssets(event: WhatsAppSyncEvent): WhatsAppMediaAssetRecord[] {
  const messages = readArray(event.payload, "messages");
  return messages.flatMap((item) => {
    const message = asRecord(item);
    const key = asRecord(message.key);
    const chatJid = readString(key.remoteJid);
    const messageId = readString(key.id);
    if (!chatJid || !messageId) {
      return [];
    }

    return extractMessageMediaRecords(asRecord(message.message)).map((media, index) => ({
      id: `${event.accountId}:${chatJid}:${messageId}:${media.mediaType}:${index}`,
      accountId: event.accountId,
      chatJid,
      messageId,
      ...media,
      receivedAt: event.receivedAt,
    }));
  });
}

function extractLidMappings(event: WhatsAppSyncEvent): WhatsAppLidMappingRecord[] {
  const candidates = [
    ...readArray(event.payload, "mapping"),
    ...readArray(event.payload, "mappings"),
    ...readArray(event.payload, "lidMappings"),
    ...readArray(event.payload, "lidPnMappings"),
  ];
  const payloadRecord = asRecord(event.payload);
  if (readString(payloadRecord.lid) && readString(payloadRecord.pn)) {
    candidates.push(payloadRecord);
  }

  return candidates.flatMap((item) => {
    const value = asRecord(item);
    const lidJid = readString(value.lid) ?? readString(value.lidJid);
    const pnJid = readString(value.pn) ?? readString(value.pnJid) ?? readString(value.phoneNumber);
    if (!lidJid || !pnJid) {
      return [];
    }

    return [{
      accountId: event.accountId,
      lidJid,
      pnJid,
      source: event.eventType,
      rawJson: safeJsonStringify(value),
      firstSeenAt: event.receivedAt,
      lastSeenAt: event.receivedAt,
    }];
  });
}

function extractHistorySyncBatch(event: WhatsAppSyncEvent, rawJson: string): WhatsAppHistorySyncBatchRecord | null {
  if (event.eventType !== "messaging-history.set") {
    return null;
  }

  const syncType = readString(asRecord(event.payload).syncType) ?? readFiniteNumberString(asRecord(event.payload).syncType);
  return {
    id: `${event.accountId}:${event.eventType}:${hashPayload(rawJson)}`,
    accountId: event.accountId,
    ...(syncType ? { syncType } : {}),
    chatCount: readArray(event.payload, "chats").length,
    contactCount: readArray(event.payload, "contacts").length,
    messageCount: readArray(event.payload, "messages").length,
    rawJson,
    receivedAt: event.receivedAt,
  };
}

function extractMessageText(message: Record<string, unknown>): string | undefined {
  if (Object.keys(message).length === 0) {
    return undefined;
  }

  return (
    readString(message.conversation) ??
    readString(asRecord(message.extendedTextMessage).text) ??
    readString(asRecord(message.imageMessage).caption) ??
    readString(asRecord(message.videoMessage).caption) ??
    readString(asRecord(message.documentMessage).caption) ??
    readString(asRecord(message.buttonsResponseMessage).selectedDisplayText) ??
    readString(asRecord(message.templateButtonReplyMessage).selectedDisplayText) ??
    readString(asRecord(message.listResponseMessage).title) ??
    extractMessageText(asRecord(asRecord(message.ephemeralMessage).message)) ??
    extractMessageText(asRecord(asRecord(message.viewOnceMessage).message)) ??
    extractMessageText(asRecord(asRecord(message.viewOnceMessageV2).message)) ??
    extractMessageText(asRecord(asRecord(message.documentWithCaptionMessage).message))
  )?.trim();
}

function extractMessageMedia(message: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Object.keys(message).length === 0) {
    return [];
  }

  const entries: Array<[string, Record<string, unknown>]> = [
    ["image", asRecord(message.imageMessage)],
    ["video", asRecord(message.videoMessage)],
    ["audio", asRecord(message.audioMessage)],
    ["document", asRecord(message.documentMessage)],
  ];
  const direct = entries.flatMap(([type, value]) => Object.keys(value).length ? [{
    type,
    ...(readString(value.mimetype) ? { mimetype: readString(value.mimetype) } : {}),
    ...(readString(value.caption) ? { caption: readString(value.caption) } : {}),
    ...(readString(value.fileName) ? { fileName: readString(value.fileName) } : {}),
  }] : []);

  return direct.length
    ? direct
    : [
      ...extractMessageMedia(asRecord(asRecord(message.ephemeralMessage).message)),
      ...extractMessageMedia(asRecord(asRecord(message.viewOnceMessage).message)),
      ...extractMessageMedia(asRecord(asRecord(message.viewOnceMessageV2).message)),
      ...extractMessageMedia(asRecord(asRecord(message.documentWithCaptionMessage).message)),
    ];
}

function extractMessageMediaRecords(message: Record<string, unknown>): Array<Omit<WhatsAppMediaAssetRecord, "id" | "accountId" | "chatJid" | "messageId" | "receivedAt">> {
  if (Object.keys(message).length === 0) {
    return [];
  }

  const entries: Array<[WhatsAppMediaAssetRecord["mediaType"], Record<string, unknown>]> = [
    ["image", asRecord(message.imageMessage)],
    ["video", asRecord(message.videoMessage)],
    ["audio", asRecord(message.audioMessage)],
    ["document", asRecord(message.documentMessage)],
  ];
  const direct = entries.flatMap(([mediaType, value]) => {
    if (Object.keys(value).length === 0) {
      return [];
    }

    const mimetype = readString(value.mimetype);
    const fileName = readString(value.fileName);
    const caption = readString(value.caption);
    const url = readString(value.url);
    const directPath = readString(value.directPath);
    const localPath = readString(value.localPath);
    return [{
      mediaType,
      ...(mimetype ? { mimetype } : {}),
      ...(fileName ? { fileName } : {}),
      ...(caption ? { caption } : {}),
      ...(url ? { url } : {}),
      ...(directPath ? { directPath } : {}),
      ...(localPath ? { localPath } : {}),
      rawJson: safeJsonStringify(value),
    }];
  });

  return direct.length
    ? direct
    : [
      ...extractMessageMediaRecords(asRecord(asRecord(message.ephemeralMessage).message)),
      ...extractMessageMediaRecords(asRecord(asRecord(message.viewOnceMessage).message)),
      ...extractMessageMediaRecords(asRecord(asRecord(message.viewOnceMessageV2).message)),
      ...extractMessageMediaRecords(asRecord(asRecord(message.documentWithCaptionMessage).message)),
    ];
}

function extractReaction(message: Record<string, unknown>): Record<string, unknown> | undefined {
  const reaction = asRecord(message.reactionMessage);
  const emoji = readString(reaction.text);
  const targetMessageId = readString(asRecord(reaction.key).id);
  if (!emoji || !targetMessageId) {
    return undefined;
  }

  return { emoji, targetMessageId };
}

function normalizeTimestamp(value: unknown): string | undefined {
  const numeric = typeof value === "number" ? value : Number(value?.toString());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return new Date(numeric * 1000).toISOString();
}

function readArray(payload: unknown, key: string): unknown[] {
  const value = asRecord(payload)[key];
  return Array.isArray(value) ? value : [];
}

function readPayloadArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [];
}

function readDeleteItems(payload: unknown): unknown[] {
  const value = asRecord(payload);
  const keys = value.keys;
  if (Array.isArray(keys)) {
    return keys.map((key) => ({ key }));
  }

  if (readString(value.jid) && value.all === true) {
    return [value];
  }

  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readFiniteNumberString(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Payload could not be serialized" });
  }
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}
