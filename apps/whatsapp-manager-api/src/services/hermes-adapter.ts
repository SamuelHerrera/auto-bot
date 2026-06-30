import type { HermesReply, HermesSession, WhatsAppMessageEvent } from "../domain/types.js";

export interface HermesAdapter {
  createSession(sessionKey: string): Promise<HermesSession>;
  sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply>;
  resetSession(sessionId: string): Promise<void>;
}

export class MockHermesAdapter implements HermesAdapter {
  async createSession(sessionKey: string): Promise<HermesSession> {
    const now = new Date().toISOString();
    return {
      id: `hermes_${sessionKey}_${Date.now()}`,
      sessionKey,
      accountId: "unassigned",
      chatJid: sessionKey,
      chatType: "direct",
      chatId: sessionKey,
      createdAt: now,
      lastActivityAt: now,
      status: "active",
    };
  }

  async sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply> {
    return {
      sessionId,
      outputText: `mock-hermes-response: ${event.text}`,
    };
  }

  async resetSession(_sessionId: string): Promise<void> {}
}

export class CliHermesAdapter implements HermesAdapter {
  async createSession(_sessionKey: string): Promise<HermesSession> {
    throw new Error("CLI Hermes adapter is not implemented yet.");
  }

  async sendMessage(_sessionId: string, _event: WhatsAppMessageEvent): Promise<HermesReply> {
    throw new Error("CLI Hermes adapter is not implemented yet.");
  }

  async resetSession(_sessionId: string): Promise<void> {
    throw new Error("CLI Hermes adapter is not implemented yet.");
  }
}
