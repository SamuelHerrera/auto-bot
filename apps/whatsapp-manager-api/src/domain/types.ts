export type WhatsAppChatId = string;
export type HermesSessionId = string;

export interface WhatsAppMessageEvent {
  chatId: WhatsAppChatId;
  messageId: string;
  senderId: string;
  text: string;
  timestamp: string;
}

export interface HermesSession {
  id: HermesSessionId;
  chatId: WhatsAppChatId;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "reset";
}

export interface ChatSessionMapping {
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
