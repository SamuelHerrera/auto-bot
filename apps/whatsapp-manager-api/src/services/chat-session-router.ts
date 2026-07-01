import type {
  ChatSessionMapping,
  DeliveryRecord,
  GroupRoutingPolicyRecord,
  HermesSession,
  InboundMessageResult,
  WhatsAppChatId,
  WhatsAppChatType,
  WhatsAppGroupRoutingPolicy,
  WhatsAppMessageEvent,
} from "../domain/types.js";
import { getWhatsAppSessionKey } from "../domain/types.js";
import type { HermesAdapter } from "./hermes-adapter.js";

export class InMemoryChatSessionRouter {
  private readonly sessions = new Map<string, HermesSession>();
  private readonly mappings = new Map<string, ChatSessionMapping>();
  private readonly processedMessages = new Set<string>();
  private readonly sessionQueues = new Map<string, Promise<InboundMessageResult>>();

  constructor(
    private readonly hermesAdapter: HermesAdapter,
    private readonly store?: ChatSessionRouterStore,
    private readonly groupPolicyStore?: GroupRoutingPolicyStore,
  ) {
    const snapshot = store?.load();
    for (const mapping of snapshot?.mappings ?? []) {
      this.mappings.set(mapping.sessionKey, mapping);
    }
    for (const session of snapshot?.sessions ?? []) {
      this.sessions.set(session.id, session);
    }
    for (const messageKey of snapshot?.processedMessages ?? []) {
      this.processedMessages.add(messageKey);
    }
  }

  async getMappings(): Promise<ChatSessionMapping[]> {
    return [...this.mappings.values()];
  }

  async listGroupPolicies(): Promise<GroupRoutingPolicyRecord[]> {
    return this.groupPolicyStore?.listGroupPolicies() ?? [];
  }

  async setGroupPolicy(input: {
    accountId: string;
    groupJid: string;
    policy: WhatsAppGroupRoutingPolicy;
  }): Promise<GroupRoutingPolicyRecord> {
    if (this.groupPolicyStore) {
      return this.groupPolicyStore.setGroupPolicy(input);
    }

    const now = new Date().toISOString();
    return {
      ...input,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getSession(sessionKey: string): Promise<HermesSession | null> {
    const mapping = this.mappings.get(sessionKey);
    if (!mapping) {
      return null;
    }

    return this.sessions.get(mapping.hermesSessionId) ?? null;
  }

  async getSessionForRoute(input: RoutingInput): Promise<HermesSession | null> {
    return this.getSession(this.normalizeRoutingInput(input).sessionKey);
  }

  async getOrCreateSession(input: RoutingInput): Promise<HermesSession> {
    const route = this.normalizeRoutingInput(input);
    const existing = await this.getSession(route.sessionKey);
    if (existing) {
      return existing;
    }

    const session = await this.hermesAdapter.createSession(route.sessionKey);
    const now = new Date().toISOString();
    const enrichedSession: HermesSession = {
      ...session,
      sessionKey: route.sessionKey,
      accountId: route.accountId,
      chatJid: route.chatJid,
      chatType: route.chatType,
      chatId: route.chatJid,
    };

    this.sessions.set(enrichedSession.id, enrichedSession);
    this.mappings.set(route.sessionKey, {
      sessionKey: route.sessionKey,
      accountId: route.accountId,
      chatJid: route.chatJid,
      chatType: route.chatType,
      chatId: route.chatJid,
      hermesSessionId: session.id,
      createdAt: now,
      updatedAt: now,
    });
    this.saveState();

    return enrichedSession;
  }

  async resetSession(input: RoutingInput): Promise<HermesSession> {
    const route = this.normalizeRoutingInput(input);
    const existing = await this.getSession(route.sessionKey);
    if (existing) {
      await this.hermesAdapter.resetSession(existing.id);
      this.sessions.delete(existing.id);
    }

    this.mappings.delete(route.sessionKey);
    this.saveState();
    return this.getOrCreateSession(route);
  }

  async remapSession(input: RoutingInput, hermesSessionId: string): Promise<ChatSessionMapping> {
    const route = this.normalizeRoutingInput(input);
    const current = this.sessions.get(hermesSessionId);
    const now = new Date().toISOString();

    if (!current) {
      const created = await this.hermesAdapter.createSession(route.sessionKey);
      this.sessions.set(created.id, created);
      hermesSessionId = created.id;
    }

    const mapping: ChatSessionMapping = {
      sessionKey: route.sessionKey,
      accountId: route.accountId,
      chatJid: route.chatJid,
      chatType: route.chatType,
      chatId: route.chatJid,
      hermesSessionId,
      createdAt: this.mappings.get(route.sessionKey)?.createdAt ?? now,
      updatedAt: now,
    };

    this.mappings.set(route.sessionKey, mapping);
    this.saveState();
    return mapping;
  }

  async handleInboundMessage(event: WhatsAppMessageEvent): Promise<InboundMessageResult> {
    const route = this.normalizeRoutingInput(event);
    const routedEvent: WhatsAppMessageEvent = {
      ...event,
      chatJid: route.chatJid,
      chatType: route.chatType,
      sessionKey: route.sessionKey,
    };

    if (this.hasProcessed(routedEvent)) {
      return { duplicate: true };
    }

    this.markProcessed(routedEvent);
    return this.enqueue(route.sessionKey, async () => this.processInboundMessage(routedEvent));
  }

  async retryInboundMessage(event: WhatsAppMessageEvent): Promise<InboundMessageResult> {
    const route = this.normalizeRoutingInput(event);
    const routedEvent: WhatsAppMessageEvent = {
      ...event,
      chatJid: route.chatJid,
      chatType: route.chatType,
      sessionKey: route.sessionKey,
      messageId: `${event.messageId}:retry:${Date.now()}`,
    };
    return this.enqueue(route.sessionKey, async () => this.processInboundMessage(routedEvent));
  }

  private async processInboundMessage(event: WhatsAppMessageEvent): Promise<InboundMessageResult> {
    const session = await this.getOrCreateSession(event);
    const reply = await this.hermesAdapter.sendMessage(session.id, event);

    if (reply.sessionId !== session.id) {
      this.sessions.delete(session.id);
      session.id = reply.sessionId;
      const currentMapping = this.mappings.get(session.sessionKey);
      if (currentMapping) {
        this.mappings.set(session.sessionKey, {
          ...currentMapping,
          hermesSessionId: reply.sessionId,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    session.lastActivityAt = new Date().toISOString();
    this.sessions.set(session.id, session);
    this.saveState();
    const mapping = this.mappings.get(session.sessionKey);
    if (!mapping) {
      throw new Error(`Session mapping not found for ${session.sessionKey}`);
    }

    return {
      duplicate: false,
      mapping,
      reply,
      session,
      event,
    };
  }

  private enqueue(sessionKey: string, task: () => Promise<InboundMessageResult>) {
    const previous = this.sessionQueues.get(sessionKey) ?? Promise.resolve({ duplicate: false });
    const next = previous.catch(() => ({ duplicate: false })).then(task);
    this.sessionQueues.set(sessionKey, next);
    void next
      .finally(() => {
        if (this.sessionQueues.get(sessionKey) === next) {
          this.sessionQueues.delete(sessionKey);
        }
      })
      .catch(() => undefined);

    return next;
  }

  private hasProcessed(event: WhatsAppMessageEvent) {
    return this.processedMessages.has(this.getProcessedMessageKey(event));
  }

  private markProcessed(event: WhatsAppMessageEvent) {
    this.processedMessages.add(this.getProcessedMessageKey(event));
    this.saveState();
  }

  private getProcessedMessageKey(event: WhatsAppMessageEvent) {
    return `${event.accountId}:${event.chatJid}:${event.messageId}`;
  }

  private normalizeRoutingInput(input: RoutingInput): NormalizedRoutingInput {
    const chatJid = input.chatJid ?? input.chatId;
    if (!chatJid) {
      throw new Error("chatJid is required");
    }

    const chatType = input.chatType ?? (chatJid.endsWith("@g.us") ? "group" : "direct");
    const groupPolicy =
      chatType === "group"
        ? input.groupPolicy ?? this.groupPolicyStore?.getGroupPolicy(input.accountId, chatJid)
        : undefined;
    const shouldUseProvidedSessionKey = Boolean(input.sessionKey && chatType !== "group");
    const sessionKey = shouldUseProvidedSessionKey
      ? input.sessionKey!
      : getWhatsAppSessionKey({
        accountId: input.accountId,
        chatJid,
        chatType,
        ...(groupPolicy ? { groupPolicy } : {}),
        ...(input.participantJid ? { participantJid: input.participantJid } : {}),
      });

    return {
      accountId: input.accountId,
      chatJid,
      chatType,
      sessionKey,
    };
  }

  private saveState() {
    this.store?.save({
      mappings: [...this.mappings.values()],
      sessions: [...this.sessions.values()],
      processedMessages: [...this.processedMessages.values()],
    });
  }
}

export interface ChatSessionRouterSnapshot {
  mappings: ChatSessionMapping[];
  sessions: HermesSession[];
  processedMessages: string[];
}

export interface ChatSessionRouterStore {
  load(): ChatSessionRouterSnapshot;
  save(snapshot: ChatSessionRouterSnapshot): void;
}

export interface BridgeDeliveryStore {
  listDeliveries(): DeliveryRecord[];
  getDelivery(id: string): DeliveryRecord | null;
  saveDelivery(record: DeliveryRecord): void;
}

export interface GroupRoutingPolicyStore {
  listGroupPolicies(): GroupRoutingPolicyRecord[];
  getGroupPolicy(accountId: string, groupJid: string): WhatsAppGroupRoutingPolicy;
  setGroupPolicy(input: {
    accountId: string;
    groupJid: string;
    policy: WhatsAppGroupRoutingPolicy;
  }): GroupRoutingPolicyRecord;
}

export interface RoutingInput {
  accountId: string;
  chatJid?: WhatsAppChatId;
  chatId?: WhatsAppChatId;
  chatType?: WhatsAppChatType;
  participantJid?: string;
  sessionKey?: string;
  groupPolicy?: WhatsAppGroupRoutingPolicy;
}

interface NormalizedRoutingInput {
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  sessionKey: string;
}
