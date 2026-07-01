import type {
  OutboundWhatsAppMessage,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
} from "../domain/types.js";
import { getWhatsAppChatType, getWhatsAppSessionKey } from "../domain/types.js";

export interface WhatsAppGateway {
  onInboundMessage(handler: (event: WhatsAppMessageEvent) => Promise<void>): void;
  getStatus(): Promise<WhatsAppAccountStatus>;
  listAccounts(): Promise<WhatsAppAccountStatus[]>;
  initializeAccount(accountId: string): Promise<WhatsAppAccountStatus>;
  disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus>;
  sendMessage(message: OutboundWhatsAppMessage): Promise<void>;
  normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent>;
}

export class MockWhatsAppGateway implements WhatsAppGateway {
  private readonly accounts = new Map<string, WhatsAppAccountStatus>();
  private readonly sentMessages: OutboundWhatsAppMessage[] = [];
  private lastConnectedAccountId: string | null = null;
  private inboundHandler: ((event: WhatsAppMessageEvent) => Promise<void>) | null = null;

  onInboundMessage(handler: (event: WhatsAppMessageEvent) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  async getStatus(): Promise<WhatsAppAccountStatus> {
    const accountId =
      this.lastConnectedAccountId && this.accounts.has(this.lastConnectedAccountId)
        ? this.lastConnectedAccountId
        : [...this.accounts.keys()][0];

    if (!accountId) {
      return {
        accountId: "unassigned",
        status: "disconnected",
      };
    }

    return this.accounts.get(accountId)!;
  }

  async listAccounts(): Promise<WhatsAppAccountStatus[]> {
    return [...this.accounts.values()];
  }

  async initializeAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    const account: WhatsAppAccountStatus = {
      accountId,
      status: "connected",
      connectedAt: new Date().toISOString(),
    };

    this.accounts.set(accountId, account);
    this.lastConnectedAccountId = accountId;
    return account;
  }

  async disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    const existing = this.accounts.get(accountId);
    const account: WhatsAppAccountStatus = existing
      ? {
          accountId,
          status: "disconnected",
        }
      : {
          accountId,
          status: "disconnected",
        };

    this.accounts.set(accountId, account);

    if (this.lastConnectedAccountId === accountId) {
      this.lastConnectedAccountId = null;
    }

    return account;
  }

  async sendMessage(message: OutboundWhatsAppMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  getSentMessages(): OutboundWhatsAppMessage[] {
    return [...this.sentMessages];
  }

  async normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent> {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid inbound payload.");
    }

    const candidate = payload as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text : "";
    const chatJid =
      typeof candidate.chatJid === "string"
        ? candidate.chatJid
        : typeof candidate.chatId === "string"
          ? candidate.chatId
          : "";
    const accountId = typeof candidate.accountId === "string" ? candidate.accountId : "manual";
    const chatType =
      candidate.chatType === "group" || candidate.chatType === "direct"
        ? candidate.chatType
        : getWhatsAppChatType(chatJid);
    const participantJid =
      typeof candidate.participantJid === "string" ? candidate.participantJid : undefined;

    if (!chatJid || !text) {
      throw new Error("Inbound payload must contain chatJid/chatId and text.");
    }

    const sessionKey = getWhatsAppSessionKey({
      accountId,
      chatJid,
      chatType,
      ...(participantJid ? { participantJid } : {}),
    });

    return {
      accountId,
      chatJid,
      chatType,
      senderJid: typeof candidate.senderJid === "string" ? candidate.senderJid : chatJid,
      ...(participantJid ? { participantJid } : {}),
      sessionKey,
      chatId: chatJid,
      text,
      messageId:
        typeof candidate.messageId === "string" ? candidate.messageId : `msg_${Date.now()}`,
      senderId:
        typeof candidate.senderId === "string"
          ? candidate.senderId
          : typeof candidate.senderJid === "string"
            ? candidate.senderJid
            : chatJid,
      media: [],
      timestamp:
        typeof candidate.timestamp === "string"
          ? candidate.timestamp
          : new Date().toISOString(),
    };
  }

  async injectInboundMessage(payload: unknown): Promise<void> {
    if (!this.inboundHandler) {
      return;
    }

    await this.inboundHandler(await this.normalizeInboundEvent(payload));
  }
}
