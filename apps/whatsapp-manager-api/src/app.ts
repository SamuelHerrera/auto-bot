import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { buildServices, sendReplyWithDeliveryRecord, type AppServices } from "./build-services.js";
import type { RoutingInput } from "./services/chat-session-router.js";

interface CreateAppOptions {
  config: AppConfig;
  services?: AppServices;
}

export function createApp({ config, services = buildServices(config) }: CreateAppOptions) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
  });

  void app.register(cors, {
    origin: parseCorsOrigin(config.CORS_ORIGIN),
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS" || request.url.startsWith("/health/")) {
      return;
    }

    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${config.API_TOKEN}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async () => ({
    status: "ok",
    dependencies: {
      databaseUrlConfigured: Boolean(config.DATABASE_URL),
      hermesAdapterMode: config.HERMES_ADAPTER_MODE,
    },
  }));

  app.post<{ Body?: { accountId?: string } }>("/whatsapp/connect", async (request) => {
    return services.whatsappGateway.initializeAccount(request.body?.accountId);
  });

  app.get("/whatsapp/accounts", async () => ({
    items: await services.whatsappGateway.listAccounts(),
  }));

  app.post<{ Params: { accountId: string } }>(
    "/whatsapp/accounts/:accountId/disconnect",
    async (request) => {
      return services.whatsappGateway.disconnectAccount(request.params.accountId);
    },
  );

  app.get("/whatsapp/status", async () => services.whatsappGateway.getStatus());

  app.get("/chats", async () => ({
    items: await services.router.getMappings(),
  }));

  app.get<{ Params: { chatId: string }; Querystring: SessionQuery }>(
    "/chats/:chatId/session",
    async (request, reply) => {
      const route = getRouteFromRequest(request.params.chatId, request.query);
      const session = await services.router.getSessionForRoute(route);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      return session;
    },
  );

  app.post<{ Params: { chatId: string }; Body: Partial<RoutingInput> }>(
    "/chats/:chatId/session",
    async (request) => {
      return services.router.getOrCreateSession(getRouteFromRequest(request.params.chatId, request.body));
    },
  );

  app.post<{ Params: { chatId: string }; Body: Partial<RoutingInput> }>(
    "/chats/:chatId/session/reset",
    async (request) => {
      return services.router.resetSession(getRouteFromRequest(request.params.chatId, request.body));
    },
  );

  app.post<{
    Params: { chatId: string };
    Body: { hermesSessionId: string } & Partial<RoutingInput>;
  }>("/chats/:chatId/session/remap", async (request) => {
    return services.router.remapSession(
      getRouteFromRequest(request.params.chatId, request.body),
      request.body.hermesSessionId,
    );
  });

  app.get("/sessions", async () => ({
    items: await services.router.getMappings(),
  }));

  app.get("/deliveries", async () => ({
    items: services.deliveryStore?.listDeliveries() ?? [],
  }));

  app.post<{ Params: { deliveryId: string } }>("/deliveries/:deliveryId/retry", async (request, reply) => {
    const record = services.deliveryStore?.getDelivery(decodeURIComponent(request.params.deliveryId));
    if (!record) {
      return reply.code(404).send({ error: "Delivery record not found" });
    }

    if (record.failureStage === "hermes") {
      if (!record.inboundText?.trim()) {
        return reply.code(409).send({ error: "Hermes failure record has no inbound text to retry" });
      }

      const result = await services.router.retryInboundMessage({
        accountId: record.accountId,
        chatJid: record.chatJid,
        chatType: record.chatType,
        chatId: record.chatJid,
        messageId: record.inboundMessageId,
        senderJid: record.chatJid,
        senderId: record.chatJid,
        sessionKey: record.sessionKey,
        text: record.inboundText,
        timestamp: new Date().toISOString(),
      });

      if (!result.reply) {
        return reply.code(409).send({ error: "Hermes retry produced no reply" });
      }

      await sendReplyWithDeliveryRecord({
        ...(services.deliveryStore ? { deliveryStore: services.deliveryStore } : {}),
        event: result.event ?? {
          accountId: record.accountId,
          chatJid: record.chatJid,
          chatType: record.chatType,
          chatId: record.chatJid,
          messageId: record.inboundMessageId,
          sessionKey: record.sessionKey,
        },
        text: result.reply.outputText,
        whatsappGateway: services.whatsappGateway,
      });

      const { error: _error, failureStage: _failureStage, ...resolvedRecord } = record;
      services.deliveryStore?.saveDelivery({
        ...resolvedRecord,
        status: "sent",
        attempts: record.attempts + 1,
        updatedAt: new Date().toISOString(),
      });

      return services.deliveryStore?.getDelivery(record.id) ?? record;
    }

    if (!record.outboundText.trim()) {
      return reply.code(409).send({ error: "Delivery record has no outbound text to retry" });
    }

    await sendReplyWithDeliveryRecord({
      ...(services.deliveryStore ? { deliveryStore: services.deliveryStore } : {}),
      event: {
        accountId: record.accountId,
        chatJid: record.chatJid,
        chatType: record.chatType,
        chatId: record.chatJid,
        messageId: record.inboundMessageId,
        sessionKey: record.sessionKey,
      },
      text: record.outboundText,
      whatsappGateway: services.whatsappGateway,
    });

    return services.deliveryStore?.getDelivery(record.id) ?? record;
  });

  app.post<{ Body: { accountId?: string; chatId: string; text: string } }>(
    "/messages/outbound",
    async (request) => {
      await services.whatsappGateway.sendMessage({
        ...(request.body.accountId ? { accountId: request.body.accountId } : {}),
        chatId: request.body.chatId,
        text: request.body.text,
      });

      return { status: "queued" };
    },
  );

  app.post<{ Body: unknown }>("/messages/inbound", async (request) => {
    let event;
    try {
      event = await services.whatsappGateway.normalizeInboundEvent(request.body);
    } catch (error) {
      if (isUnsupportedGroupChatError(error)) {
        return { ignored: true, reason: "group-chat" };
      }

      throw error;
    }

    return services.router.handleInboundMessage(event);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid configuration", issues: error.issues });
    }

    const normalizedError = error instanceof Error ? error : new Error("Internal Server Error");
    requestLog(normalizedError);
    return reply.code(getErrorStatusCode(error)).send({ error: normalizedError.message });
  });

  return app;
}

function requestLog(error: Error) {
  if (process.env.NODE_ENV !== "test") {
    console.error(error);
  }
}

function getErrorStatusCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return 500;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 600) {
    return statusCode;
  }

  return 500;
}

function isUnsupportedGroupChatError(error: unknown) {
  return error instanceof Error && error.message === "Group chats are not supported by this WhatsApp manager.";
}

function parseCorsOrigin(value: string) {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 1 && origins[0] === "*") {
    return true;
  }

  return origins;
}

interface SessionQuery {
  accountId?: string;
  chatType?: "direct" | "group";
  participantJid?: string;
}

function getRouteFromRequest(chatId: string, input?: Partial<RoutingInput>): RoutingInput {
  const accountId = input?.accountId?.trim() || "manual";
  return {
    accountId,
    chatJid: input?.chatJid ?? chatId,
    chatId,
    ...(input?.chatType ? { chatType: input.chatType } : {}),
    ...(input?.participantJid ? { participantJid: input.participantJid } : {}),
    ...(input?.sessionKey ? { sessionKey: input.sessionKey } : {}),
  };
}
