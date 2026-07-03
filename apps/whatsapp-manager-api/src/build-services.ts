import type { AppConfig } from "./config.js";
import {
  type AccountMetadataStore,
  type AuditLogStore,
  type BridgeDeliveryStore,
  InMemoryChatSessionRouter,
  type ManagerChatMetadataStore,
  type NumberRuleStore,
  type WhatsAppSyncStore,
} from "./services/chat-session-router.js";
import {
  HermesApiAdapter,
  type HermesAdapter,
} from "./services/hermes-adapter.js";
import { BaileysWhatsAppGateway } from "./services/baileys-whatsapp-gateway.js";
import { FileBridgeStateStore } from "./services/bridge-state-store.js";
import { SqliteBridgeStateStore } from "./services/sqlite-bridge-state-store.js";
import { AppEventBus } from "./services/event-bus.js";
import { evaluateNumberRules, recordBlockedNumberDelivery } from "./services/number-rules.js";
import type { WhatsAppGateway } from "./services/whatsapp-service.js";
import { recordWhatsAppSyncEvent } from "./services/whatsapp-sync-recorder.js";
import type { AuditLogInput, DeliveryRecord, WhatsAppAccountStatus } from "./domain/types.js";

export interface AppServices {
  hermesAdapter: HermesAdapter;
  router: InMemoryChatSessionRouter;
  whatsappGateway: WhatsAppGateway;
  deliveryStore?: BridgeDeliveryStore;
  numberRuleStore?: NumberRuleStore;
  auditLogStore?: AuditLogStore;
  accountMetadataStore?: AccountMetadataStore;
  managerChatMetadataStore?: ManagerChatMetadataStore;
  whatsappSyncStore?: WhatsAppSyncStore;
  eventBus: AppEventBus;
}

export function buildServices(config: AppConfig): AppServices {
  const hermesAdapter = buildHermesAdapter(config);
  const eventBus = new AppEventBus();
  const whatsappGateway = new BaileysWhatsAppGateway(config.BAILEYS_STATE_DIR, config.WHATSAPP_MEDIA_DIR);
  const bridgeStore = config.BRIDGE_DATABASE_FILE
    ? new SqliteBridgeStateStore(config.BRIDGE_DATABASE_FILE)
    : config.BRIDGE_STATE_FILE
      ? new FileBridgeStateStore(config.BRIDGE_STATE_FILE)
      : undefined;
  const router = new InMemoryChatSessionRouter(
    hermesAdapter,
    bridgeStore,
    bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined,
  );

  function recordAuditLog(input: AuditLogInput) {
    if (bridgeStore instanceof SqliteBridgeStateStore) {
      bridgeStore.recordAuditLog(input);
      eventBus.publish("logs");
    }
  }

  whatsappGateway.onStatusChange?.((status) => {
    const createdDefaultRule = ensureDefaultDenyAllNumberRule(
      bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined,
      status,
    );
    if (!isPendingAccountId(status.accountId)) {
      recordAuditLog({
        action: "whatsapp.status-change",
        resourceType: "whatsapp-account",
        resourceId: status.accountId,
        details: {
          status: status.status,
          createdDefaultRule,
          hadError: Boolean(status.lastError),
        },
      });
    }
    if (createdDefaultRule) {
      eventBus.publish("rules");
    }
    eventBus.publish("accounts");
  });

  whatsappGateway.onSyncEvent?.((event) => {
    const changes = recordWhatsAppSyncEvent(bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined, event);
    eventBus.publish("activity", {
      accountId: event.accountId,
      source: "whatsapp-sync",
      ...changes,
    });
  });

  whatsappGateway.onInboundMessage(async (event) => {
    const deliveryStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
    const numberRuleStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
    const decision = evaluateNumberRules(numberRuleStore, event);
    if (!decision.allowed) {
      const delivery = recordBlockedNumberDelivery(deliveryStore, event, decision.reason ?? "Blocked by number rule");
      recordAuditLog({
        action: "message.inbound",
        outcome: "ignored",
        resourceType: "whatsapp-message",
        resourceId: event.messageId,
        details: {
          accountId: event.accountId,
          chatJid: event.chatJid,
          reason: decision.reason ?? "Blocked by number rule",
        },
      });
      eventBus.publish("activity", {
        accountId: event.accountId,
        chatJid: event.chatJid,
        source: "delivery",
        deliveries: [delivery],
      });
      return;
    }

    let result;
    try {
      result = await router.handleInboundMessage(event);
    } catch (error) {
      const now = new Date().toISOString();
      if (bridgeStore instanceof SqliteBridgeStateStore) {
        const delivery = {
          id: `${event.accountId}:${event.chatJid}:${event.messageId}`,
          accountId: event.accountId,
          chatJid: event.chatJid,
          chatType: event.chatType,
          sessionKey: event.sessionKey,
          inboundMessageId: event.messageId,
          inboundText: event.text,
          outboundText: "",
          status: "failed",
          attempts: 0,
          failureStage: "hermes",
          error: error instanceof Error ? error.message : "Hermes turn failed",
          createdAt: now,
          updatedAt: now,
        } as const;
        bridgeStore.saveDelivery(delivery);
        eventBus.publish("activity", {
          accountId: event.accountId,
          chatJid: event.chatJid,
          source: "delivery",
          deliveries: [delivery],
        });
      }
      console.error("Hermes inbound turn failed", error);
      recordAuditLog({
        action: "message.inbound",
        outcome: "failure",
        resourceType: "whatsapp-message",
        resourceId: event.messageId,
        details: {
          accountId: event.accountId,
          chatJid: event.chatJid,
          reason: error instanceof Error ? error.message : "Hermes turn failed",
        },
      });
      return;
    }

    if (result.duplicate || !result.reply) {
      recordAuditLog({
        action: "message.inbound",
        resourceType: "whatsapp-message",
        resourceId: event.messageId,
        details: {
          accountId: event.accountId,
          chatJid: event.chatJid,
          duplicate: result.duplicate,
          replied: Boolean(result.reply),
        },
      });
      return;
    }

    const delivery = await sendReplyWithDeliveryRecord({
      ...(bridgeStore instanceof SqliteBridgeStateStore ? { deliveryStore: bridgeStore } : {}),
      event: result.event ?? event,
      text: result.reply.outputText,
      whatsappGateway,
    }).catch((error: unknown) => {
      console.error("WhatsApp reply delivery failed", error);
      return null;
    });
    recordAuditLog({
      action: "message.inbound",
      resourceType: "whatsapp-message",
      resourceId: event.messageId,
      details: {
        accountId: event.accountId,
        chatJid: event.chatJid,
        duplicate: false,
        hermesSessionId: result.session?.id ?? null,
        replied: true,
      },
    });
    eventBus.publish("activity", {
      accountId: event.accountId,
      chatJid: event.chatJid,
      source: "delivery",
      ...(delivery ? { deliveries: [delivery] } : {}),
    });
  });

  return {
    hermesAdapter,
    router,
    whatsappGateway,
    eventBus,
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { deliveryStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { numberRuleStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { auditLogStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { accountMetadataStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { managerChatMetadataStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { whatsappSyncStore: bridgeStore } : {}),
  };
}

export function ensureDefaultDenyAllNumberRule(
  numberRuleStore: NumberRuleStore | undefined,
  status: WhatsAppAccountStatus,
): boolean {
  const accountId = status.accountId.trim();
  if (!numberRuleStore || status.status !== "connected" || !accountId) {
    return false;
  }

  if (numberRuleStore.listNumberRules(accountId).length > 0) {
    return false;
  }

  numberRuleStore.createNumberRule({
    accountId,
    action: "deny",
    matchType: "all",
    label: "Default deny all",
    enabled: true,
  });
  return true;
}

function isPendingAccountId(accountId: string) {
  return accountId.startsWith("pending-");
}

export async function sendReplyWithDeliveryRecord(input: {
  deliveryStore?: BridgeDeliveryStore;
  event: {
    accountId: string;
    chatJid: string;
    chatType: "direct" | "group";
    chatId: string;
    messageId: string;
    sessionKey: string;
  };
  text: string;
  whatsappGateway: WhatsAppGateway;
}): Promise<DeliveryRecord> {
  const now = new Date().toISOString();
  const record: DeliveryRecord = {
    id: `${input.event.accountId}:${input.event.chatJid}:${input.event.messageId}`,
    accountId: input.event.accountId,
    chatJid: input.event.chatJid,
    chatType: input.event.chatType,
    sessionKey: input.event.sessionKey,
    inboundMessageId: input.event.messageId,
    outboundText: input.text,
    status: "pending" as const,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  input.deliveryStore?.saveDelivery(record);
  try {
    await input.whatsappGateway.sendMessage({
      accountId: input.event.accountId,
      chatJid: input.event.chatJid,
      chatId: input.event.chatId,
      text: input.text,
    });
    const sentRecord: DeliveryRecord = {
      ...record,
      status: "sent",
      attempts: record.attempts + 1,
      updatedAt: new Date().toISOString(),
    };
    input.deliveryStore?.saveDelivery(sentRecord);
    return sentRecord;
  } catch (error) {
    const failedRecord: DeliveryRecord = {
      ...record,
      status: "failed",
      attempts: record.attempts + 1,
      failureStage: "whatsapp",
      error: error instanceof Error ? error.message : "WhatsApp send failed",
      updatedAt: new Date().toISOString(),
    };
    input.deliveryStore?.saveDelivery(failedRecord);
    throw error;
  }
}

function buildHermesAdapter(config: AppConfig): HermesAdapter {
  return new HermesApiAdapter({
    apiKey: config.internalApiKey,
    baseUrl: config.HERMES_API_BASE_URL,
    model: config.HERMES_API_MODEL,
  });
}
