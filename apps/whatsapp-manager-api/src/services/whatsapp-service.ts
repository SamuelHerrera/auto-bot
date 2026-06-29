import type {
  OutboundWhatsAppMessage,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
} from "../domain/types.js";

export interface WhatsAppGateway {
  getStatus(): Promise<WhatsAppAccountStatus>;
  initializeAccount(accountId: string): Promise<WhatsAppAccountStatus>;
  sendMessage(message: OutboundWhatsAppMessage): Promise<void>;
  normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent>;
}

export class MockWhatsAppGateway implements WhatsAppGateway {
  async getStatus(): Promise<WhatsAppAccountStatus> {
    return {
      accountId: "mock-account",
      status: "connected",
      connectedAt: new Date().toISOString(),
    };
  }

  async initializeAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    return {
      accountId,
      status: "connected",
      connectedAt: new Date().toISOString(),
    };
  }

  async sendMessage(_message: OutboundWhatsAppMessage): Promise<void> {}

  async normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent> {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid inbound payload.");
    }

    const candidate = payload as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text : "";
    const chatId = typeof candidate.chatId === "string" ? candidate.chatId : "";

    if (!chatId || !text) {
      throw new Error("Inbound payload must contain chatId and text.");
    }

    return {
      chatId,
      text,
      messageId:
        typeof candidate.messageId === "string" ? candidate.messageId : `msg_${Date.now()}`,
      senderId: typeof candidate.senderId === "string" ? candidate.senderId : chatId,
      timestamp:
        typeof candidate.timestamp === "string"
          ? candidate.timestamp
          : new Date().toISOString(),
    };
  }
}
