import type { ChatMessage, ChatSummary, DeliveryRecord, SessionMapping, WhatsAppContact, WhatsAppLidMapping } from "./models";

export type ContactDisplayIndex = Map<string, Pick<ChatSummary, "displayName" | "phoneNumber" | "lidJid" | "pnJid">>;

export function buildChatSummaries(
  accountId: string,
  mappings: SessionMapping[],
  deliveries: DeliveryRecord[],
  contactDisplayIndex: ContactDisplayIndex = new Map(),
): ChatSummary[] {
  if (!accountId) {
    return [];
  }

  const chats = new Map<string, ChatSummary>();

  for (const mapping of mappings.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    chats.set(mapping.chatJid, {
      accountId: mapping.accountId,
      chatJid: mapping.chatJid,
      ...contactDisplayIndex.get(mapping.chatJid),
      sessionKey: mapping.sessionKey,
      hermesSessionId: mapping.hermesSessionId,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
      deliveryCount: 0,
      failedCount: 0,
      messageCount: 0,
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
      messageCount: (current?.messageCount ?? 0) + countDeliveryMessages(delivery),
      ...(current?.hermesSessionId ? { hermesSessionId: current.hermesSessionId } : {}),
      ...(lastText ? { lastText } : {}),
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
    const displayName = contact.displayName || contact.notifyName || contact.verifiedName || contact.pushName;
    const phoneNumber = contact.phoneNumber || jidToPhoneNumber(contact.contactJid) || (contact.lidJid ? index.get(contact.lidJid)?.phoneNumber : undefined);
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

export function countDeliveryMessages(delivery: DeliveryRecord): number {
  return Number(Boolean(delivery.inboundText?.trim())) + Number(Boolean(delivery.outboundText.trim()));
}

export function buildChatMessages(deliveries: DeliveryRecord[]): ChatMessage[] {
  return deliveries
    .flatMap((delivery): ChatMessage[] => {
      const messages: ChatMessage[] = [];
      if (delivery.inboundText?.trim()) {
        messages.push({
          id: `${delivery.id}:inbound`,
          direction: "inbound",
          text: delivery.inboundText,
          status: delivery.status,
          timestamp: delivery.createdAt,
          record: delivery,
        });
      }
      if (delivery.outboundText.trim()) {
        messages.push({
          id: `${delivery.id}:outbound`,
          direction: "outbound",
          text: delivery.outboundText,
          status: delivery.status,
          timestamp: delivery.updatedAt,
          record: delivery,
        });
      }
      return messages;
    })
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

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
