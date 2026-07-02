import type { AppConfig } from "./config.js";
import {
  type BridgeDeliveryStore,
  InMemoryChatSessionRouter,
  type NumberRuleStore,
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

export interface AppServices {
  hermesAdapter: HermesAdapter;
  router: InMemoryChatSessionRouter;
  whatsappGateway: WhatsAppGateway;
  deliveryStore?: BridgeDeliveryStore;
  numberRuleStore?: NumberRuleStore;
  eventBus: AppEventBus;
}

export function buildServices(config: AppConfig): AppServices {
  const hermesAdapter = buildHermesAdapter(config);
  const eventBus = new AppEventBus();
  const whatsappGateway = new BaileysWhatsAppGateway(config.BAILEYS_STATE_DIR);
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

  whatsappGateway.onStatusChange?.(() => {
    eventBus.publish("accounts");
  });

  whatsappGateway.onInboundMessage(async (event) => {
    const deliveryStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
    const numberRuleStore = bridgeStore instanceof SqliteBridgeStateStore ? bridgeStore : undefined;
    const decision = evaluateNumberRules(numberRuleStore, event);
    if (!decision.allowed) {
      recordBlockedNumberDelivery(deliveryStore, event, decision.reason ?? "Blocked by number rule");
      eventBus.publish("activity");
      return;
    }

    let result;
    try {
      result = await router.handleInboundMessage(event);
    } catch (error) {
      const now = new Date().toISOString();
      if (bridgeStore instanceof SqliteBridgeStateStore) {
        bridgeStore.saveDelivery({
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
        });
      }
      console.error("Hermes inbound turn failed", error);
      eventBus.publish("activity");
      return;
    }

    if (result.duplicate || !result.reply) {
      return;
    }

    await sendReplyWithDeliveryRecord({
      ...(bridgeStore instanceof SqliteBridgeStateStore ? { deliveryStore: bridgeStore } : {}),
      event: result.event ?? event,
      text: result.reply.outputText,
      whatsappGateway,
    }).catch((error: unknown) => {
      console.error("WhatsApp reply delivery failed", error);
    });
    eventBus.publish("activity");
  });

  return {
    hermesAdapter,
    router,
    whatsappGateway,
    eventBus,
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { deliveryStore: bridgeStore } : {}),
    ...(bridgeStore instanceof SqliteBridgeStateStore ? { numberRuleStore: bridgeStore } : {}),
  };
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
}) {
  const now = new Date().toISOString();
  const record = {
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
    input.deliveryStore?.saveDelivery({
      ...record,
      status: "sent",
      attempts: record.attempts + 1,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    input.deliveryStore?.saveDelivery({
      ...record,
      status: "failed",
      attempts: record.attempts + 1,
      failureStage: "whatsapp",
      error: error instanceof Error ? error.message : "WhatsApp send failed",
      updatedAt: new Date().toISOString(),
    });
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
