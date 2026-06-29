import type {
  ChatSessionMapping,
  HermesSession,
  WhatsAppChatId,
  WhatsAppMessageEvent,
} from "../domain/types.js";
import type { HermesAdapter } from "./hermes-adapter.js";

export class InMemoryChatSessionRouter {
  private readonly sessions = new Map<string, HermesSession>();
  private readonly mappings = new Map<WhatsAppChatId, ChatSessionMapping>();

  constructor(private readonly hermesAdapter: HermesAdapter) {}

  async getMappings(): Promise<ChatSessionMapping[]> {
    return [...this.mappings.values()];
  }

  async getSession(chatId: WhatsAppChatId): Promise<HermesSession | null> {
    const mapping = this.mappings.get(chatId);
    if (!mapping) {
      return null;
    }

    return this.sessions.get(mapping.hermesSessionId) ?? null;
  }

  async getOrCreateSession(chatId: WhatsAppChatId): Promise<HermesSession> {
    const existing = await this.getSession(chatId);
    if (existing) {
      return existing;
    }

    const session = await this.hermesAdapter.createSession(chatId);
    const now = new Date().toISOString();

    this.sessions.set(session.id, session);
    this.mappings.set(chatId, {
      chatId,
      hermesSessionId: session.id,
      createdAt: now,
      updatedAt: now,
    });

    return session;
  }

  async resetSession(chatId: WhatsAppChatId): Promise<HermesSession> {
    const existing = await this.getSession(chatId);
    if (existing) {
      await this.hermesAdapter.resetSession(existing.id);
      this.sessions.delete(existing.id);
    }

    this.mappings.delete(chatId);
    return this.getOrCreateSession(chatId);
  }

  async remapSession(chatId: WhatsAppChatId, hermesSessionId: string): Promise<ChatSessionMapping> {
    const current = this.sessions.get(hermesSessionId);
    const now = new Date().toISOString();

    if (!current) {
      const created = await this.hermesAdapter.createSession(chatId);
      this.sessions.set(created.id, created);
      hermesSessionId = created.id;
    }

    const mapping: ChatSessionMapping = {
      chatId,
      hermesSessionId,
      createdAt: this.mappings.get(chatId)?.createdAt ?? now,
      updatedAt: now,
    };

    this.mappings.set(chatId, mapping);
    return mapping;
  }

  async handleInboundMessage(event: WhatsAppMessageEvent) {
    const session = await this.getOrCreateSession(event.chatId);
    const reply = await this.hermesAdapter.sendMessage(session.id, event);

    const storedSession = this.sessions.get(session.id);
    if (storedSession) {
      storedSession.lastActivityAt = new Date().toISOString();
    }

    return {
      mapping: this.mappings.get(event.chatId)!,
      reply,
      session,
    };
  }
}
