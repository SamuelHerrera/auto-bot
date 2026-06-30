export type WhatsAppChatId = string;
export type HermesSessionId = string;
export type WhatsAppChatType = "direct" | "group";

export interface WhatsAppMessageEvent {
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  senderJid: string;
  sessionKey: string;
  messageId: string;
  participantJid?: string;
  chatId: WhatsAppChatId;
  senderId: string;
  text: string;
  timestamp: string;
}

export interface HermesSession {
  id: HermesSessionId;
  sessionKey: string;
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  chatId: WhatsAppChatId;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "reset";
}

export interface ChatSessionMapping {
  sessionKey: string;
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  chatId: WhatsAppChatId;
  hermesSessionId: HermesSessionId;
  createdAt: string;
  updatedAt: string;
}

export interface HermesReply {
  sessionId: HermesSessionId;
  outputText: string;
}

export interface OutboundWhatsAppMessage {
  chatJid?: WhatsAppChatId;
  chatId: WhatsAppChatId;
  text: string;
  accountId?: string;
}

export interface WhatsAppAccountStatus {
  accountId: string;
  status: "disconnected" | "connecting" | "connected";
  connectedAt?: string;
  disconnectedAt?: string;
  qrCode?: string;
  lastError?: string;
}

export interface InboundMessageResult {
  duplicate: boolean;
  mapping?: ChatSessionMapping;
  reply?: HermesReply;
  session?: HermesSession;
}

export function getWhatsAppChatType(chatJid: string): WhatsAppChatType {
  return chatJid.endsWith("@g.us") ? "group" : "direct";
}

export function getWhatsAppSessionKey(input: {
  accountId: string;
  chatJid: string;
  chatType?: WhatsAppChatType;
  participantJid?: string;
}) {
  const chatType = input.chatType ?? getWhatsAppChatType(input.chatJid);
  if (chatType === "group" && input.participantJid) {
    return `whatsapp:${input.accountId}:group:${input.chatJid}:user:${input.participantJid}`;
  }

  return `whatsapp:${input.accountId}:${chatType}:${input.chatJid}`;
}
