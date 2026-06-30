import type { AppConfig } from "./config.js";
import { InMemoryChatSessionRouter } from "./services/chat-session-router.js";
import {
  CliHermesAdapter,
  MockHermesAdapter,
  type HermesAdapter,
} from "./services/hermes-adapter.js";
import { BaileysWhatsAppGateway } from "./services/baileys-whatsapp-gateway.js";
import { FileBridgeStateStore } from "./services/bridge-state-store.js";
import { MockWhatsAppGateway, type WhatsAppGateway } from "./services/whatsapp-service.js";

export interface AppServices {
  hermesAdapter: HermesAdapter;
  router: InMemoryChatSessionRouter;
  whatsappGateway: WhatsAppGateway;
}

export function buildServices(config: AppConfig): AppServices {
  const hermesAdapter =
    config.HERMES_ADAPTER_MODE === "cli" ? new CliHermesAdapter() : new MockHermesAdapter();
  const whatsappGateway =
    config.WHATSAPP_GATEWAY_MODE === "baileys"
      ? new BaileysWhatsAppGateway(config.BAILEYS_STATE_DIR)
      : new MockWhatsAppGateway();
  const router = new InMemoryChatSessionRouter(
    hermesAdapter,
    config.BRIDGE_STATE_FILE ? new FileBridgeStateStore(config.BRIDGE_STATE_FILE) : undefined,
  );

  whatsappGateway.onInboundMessage(async (event) => {
    const result = await router.handleInboundMessage(event);
    if (result.duplicate || !result.reply) {
      return;
    }

    await whatsappGateway.sendMessage({
      accountId: event.accountId,
      chatJid: event.chatJid,
      chatId: event.chatId,
      text: result.reply.outputText,
    });
  });

  return {
    hermesAdapter,
    router,
    whatsappGateway,
  };
}
