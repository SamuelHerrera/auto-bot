import type {
  ChatMessage,
  ChatSummary,
  DeliveryRecord,
  ManagerChatMetadata,
  SessionMapping,
  WhatsAppContact,
  WhatsAppLidMapping,
  WhatsAppMediaAsset,
  WhatsAppMessageReceipt,
  WhatsAppMessageUpdate,
  WhatsAppSyncedChat,
  WhatsAppSyncedMessage,
} from "./models";

export type ContactDisplayIndex = Map<string, Pick<ChatSummary, "displayName" | "phoneNumber" | "lidJid" | "pnJid">>;

export function buildChatSummaries(
  accountId: string,
  mappings: SessionMapping[],
  deliveries: DeliveryRecord[],
  syncedChats: WhatsAppSyncedChat[] = [],
  syncedMessages: WhatsAppSyncedMessage[] = [],
  contactDisplayIndex: ContactDisplayIndex = new Map(),
  managerChatMetadata: ManagerChatMetadata[] = [],
  mediaAssets: WhatsAppMediaAsset[] = [],
): ChatSummary[] {
  if (!accountId) {
    return [];
  }

  const chats = new Map<string, ChatSummary>();
  const actualMessageCounts = countActualMessagesByChat(
    deliveries.filter((item) => item.accountId === accountId && item.chatType === "direct"),
    syncedMessages.filter((item) => item.accountId === accountId),
    mediaAssets.filter((item) => item.accountId === accountId),
  );
  const managerMetadataByChatJid = new Map(
    managerChatMetadata
      .filter((item) => item.accountId === accountId)
      .map((item) => [item.chatJid, item]),
  );

  for (const syncedChat of syncedChats.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    const display = contactDisplayIndex.get(syncedChat.chatJid);
    const updatedAt = syncedChat.lastMessageAt ?? syncedChat.lastSeenAt;
    const displayName = normalizeDisplayName(syncedChat.displayName, display?.phoneNumber);
    chats.set(syncedChat.chatJid, {
      accountId: syncedChat.accountId,
      chatJid: syncedChat.chatJid,
      ...display,
      ...(displayName ? { displayName } : {}),
      createdAt: syncedChat.firstSeenAt,
      updatedAt,
      deliveryCount: 0,
      failedCount: 0,
      messageCount: actualMessageCounts.get(syncedChat.chatJid) ?? 0,
      ...(syncedChat.unreadCount !== undefined ? { unreadCount: syncedChat.unreadCount } : {}),
      managerArchived: managerMetadataByChatJid.get(syncedChat.chatJid)?.archived ?? false,
      source: "synced",
    });
  }

  for (const mapping of mappings.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    const current = chats.get(mapping.chatJid);
    chats.set(mapping.chatJid, {
      accountId: mapping.accountId,
      chatJid: mapping.chatJid,
      ...contactDisplayIndex.get(mapping.chatJid),
      sessionKey: mapping.sessionKey,
      hermesSessionId: mapping.hermesSessionId,
      createdAt: current?.createdAt ?? mapping.createdAt,
      updatedAt: maxTimestamp(current?.updatedAt, mapping.updatedAt),
      deliveryCount: current?.deliveryCount ?? 0,
      failedCount: current?.failedCount ?? 0,
      messageCount: actualMessageCounts.get(mapping.chatJid) ?? current?.messageCount ?? 0,
      ...(current?.unreadCount !== undefined ? { unreadCount: current.unreadCount } : {}),
      managerArchived: managerMetadataByChatJid.get(mapping.chatJid)?.archived ?? current?.managerArchived ?? false,
      source: current ? "mixed" : "routed",
      ...(current?.lastText ? { lastText: current.lastText } : {}),
    });
  }

  for (const delivery of deliveries.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    const current = chats.get(delivery.chatJid);
    const updatedAt = maxTimestamp(current?.updatedAt, delivery.updatedAt);
    const lastText = delivery.outboundText || delivery.inboundText || current?.lastText;
    chats.set(delivery.chatJid, {
      accountId: delivery.accountId,
      chatJid: delivery.chatJid,
      ...contactDisplayIndex.get(delivery.chatJid),
      sessionKey: current?.sessionKey ?? delivery.sessionKey,
      createdAt: current?.createdAt ?? delivery.createdAt,
      updatedAt,
      deliveryCount: (current?.deliveryCount ?? 0) + 1,
      failedCount: (current?.failedCount ?? 0) + (delivery.status === "failed" ? 1 : 0),
      messageCount: actualMessageCounts.get(delivery.chatJid) ?? current?.messageCount ?? 0,
      ...(current?.unreadCount !== undefined ? { unreadCount: current.unreadCount } : {}),
      managerArchived: managerMetadataByChatJid.get(delivery.chatJid)?.archived ?? current?.managerArchived ?? false,
      source: current?.source === "synced" || current?.source === "mixed" ? "mixed" : "routed",
      ...(current?.hermesSessionId ? { hermesSessionId: current.hermesSessionId } : {}),
      ...(lastText ? { lastText } : {}),
    });
  }

  for (const message of syncedMessages.filter((item) => item.accountId === accountId)) {
    const current = chats.get(message.chatJid);
    if (!current) {
      chats.set(message.chatJid, {
        accountId,
        chatJid: message.chatJid,
        ...contactDisplayIndex.get(message.chatJid),
        updatedAt: message.timestamp,
        deliveryCount: 0,
        failedCount: 0,
        messageCount: actualMessageCounts.get(message.chatJid) ?? 0,
        managerArchived: managerMetadataByChatJid.get(message.chatJid)?.archived ?? false,
        source: "synced",
        ...(message.text ? { lastText: message.text } : {}),
      });
      continue;
    }

    const messageIsNewer = Date.parse(message.timestamp) >= Date.parse(current.updatedAt);
    chats.set(message.chatJid, {
      ...current,
      updatedAt: maxTimestamp(current.updatedAt, message.timestamp),
      messageCount: actualMessageCounts.get(message.chatJid) ?? current.messageCount,
      managerArchived: managerMetadataByChatJid.get(message.chatJid)?.archived ?? current.managerArchived,
      source: current.source === "routed" ? "mixed" : current.source,
      ...(messageIsNewer && message.text ? { lastText: message.text } : {}),
    });
  }

  return [...chats.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function buildContactDisplayIndex(
  contacts: WhatsAppContact[],
  lidMappings: WhatsAppLidMapping[],
): ContactDisplayIndex {
  const index: ContactDisplayIndex = new Map();

  for (const mapping of lidMappings) {
    const phoneNumber = jidToPhoneNumber(mapping.pnJid);
    mergeDisplay(index, mapping.lidJid, {
      lidJid: mapping.lidJid,
      pnJid: mapping.pnJid,
      ...(phoneNumber ? { phoneNumber } : {}),
    });
    mergeDisplay(index, mapping.pnJid, {
      lidJid: mapping.lidJid,
      pnJid: mapping.pnJid,
      ...(phoneNumber ? { phoneNumber } : {}),
    });
  }

  for (const contact of contacts) {
    const rawDisplayName = contact.displayName || contact.notifyName || contact.verifiedName || contact.pushName;
    const phoneNumber =
      normalizePhoneNumber(contact.phoneNumber) ||
      jidToPhoneNumber(contact.contactJid) ||
      index.get(contact.contactJid)?.phoneNumber ||
      (contact.lidJid ? index.get(contact.lidJid)?.phoneNumber : undefined);
    const displayName = normalizeDisplayName(rawDisplayName, phoneNumber);
    const contactDisplay = {
      ...(displayName ? { displayName } : {}),
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(contact.lidJid ? { lidJid: contact.lidJid } : {}),
      ...(contact.contactJid.endsWith("@s.whatsapp.net") ? { pnJid: contact.contactJid } : {}),
    };

    mergeDisplay(index, contact.contactJid, contactDisplay);
    if (contact.lidJid) {
      mergeDisplay(index, contact.lidJid, contactDisplay);
    }
  }

  return index;
}

export function buildChatMessages(
  deliveries: DeliveryRecord[],
  syncedMessages: WhatsAppSyncedMessage[] = [],
  receipts: WhatsAppMessageReceipt[] = [],
  updates: WhatsAppMessageUpdate[] = [],
  mediaAssets: WhatsAppMediaAsset[] = [],
): ChatMessage[] {
  const receiptsByMessage = groupByMessageId(receipts);
  const updatesByMessage = groupByMessageId(updates.filter((update) => update.messageId));
  const mediaByMessage = groupByMessageId(mediaAssets);

  const deliveryMessages = deliveries
    .flatMap((delivery): ChatMessage[] => {
      const messages: ChatMessage[] = [];
      if (delivery.inboundText?.trim()) {
        messages.push({
          id: `${delivery.id}:inbound`,
          direction: "inbound",
          text: delivery.inboundText,
          kind: "message",
          status: delivery.status,
          timestamp: delivery.createdAt,
          source: "delivery",
          record: delivery,
        });
      }
      if (delivery.outboundText.trim()) {
        messages.push({
          id: `${delivery.id}:outbound`,
          direction: "outbound",
          text: delivery.outboundText,
          kind: "message",
          status: delivery.status,
          timestamp: delivery.updatedAt,
          source: "delivery",
          record: delivery,
        });
      }
      return messages;
    });

  const syncMessages = syncedMessages.map((message): ChatMessage => {
    const media = mediaByMessage.get(message.messageId) ?? [];
    const reaction = parseJsonRecord(message.reactionJson);
    const display = getSyncedMessageDisplay(message, media, reaction);
    return {
      id: `sync:${message.accountId}:${message.chatJid}:${message.messageId}`,
      direction: message.fromMe ? "outbound" : "inbound",
      text: display.text,
      kind: display.kind,
      timestamp: message.timestamp,
      source: "sync",
      ...(message.messageType ? { messageType: message.messageType } : {}),
      media,
      receipts: receiptsByMessage.get(message.messageId) ?? [],
      updates: updatesByMessage.get(message.messageId) ?? [],
      record: message,
    };
  });

  return [...syncMessages, ...deliveryMessages]
    .filter((message, index, all) => all.findIndex((candidate) => messagesOverlap(candidate, message)) === index)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function maxTimestamp(left: string | undefined, right: string) {
  if (!left) {
    return right;
  }

  return Date.parse(left) > Date.parse(right) ? left : right;
}

function mergeDisplay(
  index: ContactDisplayIndex,
  chatJid: string | undefined,
  update: Pick<ChatSummary, "displayName" | "phoneNumber" | "lidJid" | "pnJid">,
) {
  if (!chatJid) {
    return;
  }

  index.set(chatJid, {
    ...index.get(chatJid),
    ...removeUndefined(update),
  });
}

function jidToPhoneNumber(jid: string | undefined) {
  const phone = jid?.match(/^(\d+)@s\.whatsapp\.net$/)?.[1];
  return phone || undefined;
}

function normalizePhoneNumber(value: string | undefined) {
  return jidToPhoneNumber(value) ?? value;
}

function normalizeDisplayName(value: string | undefined, phoneNumber: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value.endsWith("@s.whatsapp.net") || value.endsWith("@lid") ? phoneNumber : value;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function countActualMessagesByChat(
  deliveries: DeliveryRecord[],
  syncedMessages: WhatsAppSyncedMessage[],
  mediaAssets: WhatsAppMediaAsset[],
) {
  const chatJids = new Set<string>();
  for (const delivery of deliveries) {
    chatJids.add(delivery.chatJid);
  }
  for (const message of syncedMessages) {
    chatJids.add(message.chatJid);
  }

  const counts = new Map<string, number>();
  for (const chatJid of chatJids) {
    const messages = buildChatMessages(
      deliveries.filter((delivery) => delivery.chatJid === chatJid),
      syncedMessages.filter((message) => message.chatJid === chatJid),
      [],
      [],
      mediaAssets.filter((asset) => asset.chatJid === chatJid),
    );
    counts.set(chatJid, messages.filter((message) => message.kind === "message").length);
  }

  return counts;
}

function groupByMessageId<T extends { messageId?: string }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    if (!item.messageId) {
      continue;
    }

    grouped.set(item.messageId, [...(grouped.get(item.messageId) ?? []), item]);
  }

  return grouped;
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getSyncedMessageDisplay(
  message: WhatsAppSyncedMessage,
  media: WhatsAppMediaAsset[],
  reaction: Record<string, unknown> | null,
): Pick<ChatMessage, "kind" | "text"> {
  const text = message.text?.trim();
  if (text) {
    return { kind: "message", text };
  }

  if (media.length) {
    return {
      kind: "message",
      text: media.map((item) => item.caption || item.fileName || `${item.mediaType} attachment`).join(", "),
    };
  }

  if (typeof reaction?.emoji === "string" && typeof reaction?.targetMessageId === "string") {
    return { kind: "event", text: `${reaction.emoji} reaction to a synced message` };
  }

  const raw = parseJsonRecord(message.rawJson);
  const stubType = typeof raw?.messageStubType === "string" ? raw.messageStubType : undefined;
  if (stubType === "E2E_ENCRYPTED") {
    return { kind: "event", text: "Encrypted history placeholder. WhatsApp synced the message key, but not readable content." };
  }

  if (message.messageType === "protocolMessage") {
    return { kind: "event", text: "Protocol sync event. WhatsApp metadata, not a chat message." };
  }

  if (message.messageType === "messageContextInfo") {
    return { kind: "event", text: "Device/context sync event. WhatsApp metadata, not readable chat text." };
  }

  return {
    kind: "event",
    text: message.messageType
      ? `${message.messageType} sync event. No readable message body was provided.`
      : "History placeholder. WhatsApp synced this message record without readable content.",
  };
}

function messagesOverlap(left: ChatMessage, right: ChatMessage) {
  if (left.id === right.id) {
    return true;
  }

  if (left.source === right.source || left.direction !== right.direction || left.text !== right.text) {
    return false;
  }

  return Math.abs(Date.parse(left.timestamp) - Date.parse(right.timestamp)) < 2000;
}
