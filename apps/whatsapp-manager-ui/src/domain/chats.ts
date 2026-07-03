import type { ChatMessage, ChatSummary, DeliveryRecord, SessionMapping } from "./models";
import { getDeliveryStatus, isFailedDelivery } from "./deliveries";

export function buildChatSummaries(
  accountId: string,
  mappings: SessionMapping[],
  deliveries: DeliveryRecord[],
): ChatSummary[] {
  if (!accountId) {
    return [];
  }

  const chats = new Map<string, ChatSummary>();

  for (const mapping of mappings.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    chats.set(mapping.chatJid, {
      accountId: mapping.accountId,
      chatJid: mapping.chatJid,
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
      sessionKey: current?.sessionKey ?? delivery.sessionKey,
      createdAt: current?.createdAt ?? delivery.createdAt,
      updatedAt,
      deliveryCount: (current?.deliveryCount ?? 0) + 1,
      failedCount: (current?.failedCount ?? 0) + (isFailedDelivery(delivery) ? 1 : 0),
      messageCount: (current?.messageCount ?? 0) + countDeliveryMessages(delivery),
      ...(current?.hermesSessionId ? { hermesSessionId: current.hermesSessionId } : {}),
      ...(lastText ? { lastText } : {}),
    });
  }

  return [...chats.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
          status: getDeliveryStatus(delivery),
          timestamp: delivery.createdAt,
          record: delivery,
        });
      }
      if (delivery.outboundText.trim()) {
        messages.push({
          id: `${delivery.id}:outbound`,
          direction: "outbound",
          text: delivery.outboundText,
          status: getDeliveryStatus(delivery),
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
