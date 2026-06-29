import type { AppConfig } from "./config.js";
import { InMemoryChatSessionRouter } from "./services/chat-session-router.js";
import {
  CliHermesAdapter,
  MockHermesAdapter,
  type HermesAdapter,
} from "./services/hermes-adapter.js";
import { MockWhatsAppGateway, type WhatsAppGateway } from "./services/whatsapp-service.js";

export interface AppServices {
  hermesAdapter: HermesAdapter;
  router: InMemoryChatSessionRouter;
  whatsappGateway: WhatsAppGateway;
}

export function buildServices(config: AppConfig): AppServices {
  const hermesAdapter =
    config.HERMES_ADAPTER_MODE === "cli" ? new CliHermesAdapter() : new MockHermesAdapter();
  const whatsappGateway = new MockWhatsAppGateway();

  return {
    hermesAdapter,
    router: new InMemoryChatSessionRouter(hermesAdapter),
    whatsappGateway,
  };
}
