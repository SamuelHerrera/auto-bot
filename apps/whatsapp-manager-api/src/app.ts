import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import {
  buildServices,
  ensureDefaultDenyAllNumberRule,
  sendReplyWithDeliveryRecord,
  type AppServices,
} from "./build-services.js";
import type { NumberRuleInput } from "./domain/types.js";
import { evaluateNumberRules, recordBlockedNumberDelivery } from "./services/number-rules.js";
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
    const isAuthorizedEventStream =
      request.url.startsWith("/events") && getQueryToken(request.url) === config.API_TOKEN;
    if (authorization !== `Bearer ${config.API_TOKEN}` && !isAuthorizedEventStream) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async () => ({
    status: "ok",
    dependencies: {
      databaseUrlConfigured: Boolean(config.DATABASE_URL),
      hermesApiBaseUrl: config.HERMES_API_BASE_URL,
      internalApiKeyConfigured: Boolean(config.internalApiKey),
    },
  }));

  app.get("/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 25000);
    const unsubscribe = services.eventBus.subscribe((event) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });

    return;
  });

  app.post<{ Body?: { accountId?: string } }>("/whatsapp/connect", async (request) => {
    const status = await services.whatsappGateway.initializeAccount(request.body?.accountId);
    const createdDefaultRule = ensureDefaultDenyAllNumberRule(services.numberRuleStore, status);
    services.eventBus.publish("accounts");
    if (createdDefaultRule) {
      services.eventBus.publish("rules");
    }
    return status;
  });

  app.get("/whatsapp/accounts", async () => ({
    items: await services.whatsappGateway.listAccounts(),
  }));

  app.post<{ Params: { accountId: string } }>(
    "/whatsapp/accounts/:accountId/disconnect",
    async (request) => {
      const status = await services.whatsappGateway.disconnectAccount(request.params.accountId);
      services.eventBus.publish("accounts");
      return status;
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

  app.get<{ Querystring: { accountId?: string } }>("/number-rules", async (request) => ({
    items: services.numberRuleStore?.listNumberRules(request.query.accountId) ?? [],
  }));

  app.post<{ Body: unknown }>("/number-rules", async (request, reply) => {
    if (!services.numberRuleStore) {
      return reply.code(503).send({ error: "Number rule storage is not configured" });
    }

    const input = parseNumberRuleInput(request.body);
    const rule = services.numberRuleStore.createNumberRule(input);
    services.eventBus.publish("rules");
    return rule;
  });

  app.put<{ Params: { ruleId: string }; Body: unknown }>("/number-rules/:ruleId", async (request, reply) => {
    if (!services.numberRuleStore) {
      return reply.code(503).send({ error: "Number rule storage is not configured" });
    }

    const existing = services.numberRuleStore.getNumberRule(decodeURIComponent(request.params.ruleId));
    if (!existing) {
      return reply.code(404).send({ error: "Number rule not found" });
    }

    const input = parseNumberRuleInput(request.body, existing);
    const rule = services.numberRuleStore.updateNumberRule(existing.id, input);
    services.eventBus.publish("rules");
    return rule;
  });

  app.delete<{ Params: { ruleId: string } }>("/number-rules/:ruleId", async (request, reply) => {
    if (!services.numberRuleStore) {
      return reply.code(503).send({ error: "Number rule storage is not configured" });
    }

    const deleted = services.numberRuleStore.deleteNumberRule(decodeURIComponent(request.params.ruleId));
    if (!deleted) {
      return reply.code(404).send({ error: "Number rule not found" });
    }

    services.eventBus.publish("rules");
    return reply.code(204).send();
  });

  app.post<{ Params: { deliveryId: string } }>("/deliveries/:deliveryId/retry", async (request, reply) => {
    const record = services.deliveryStore?.getDelivery(decodeURIComponent(request.params.deliveryId));
    if (!record) {
      return reply.code(404).send({ error: "Delivery record not found" });
    }

    if (record.failureStage === "hermes") {
      if (!record.inboundText?.trim()) {
        return reply.code(409).send({ error: "Hermes failure record has no inbound text to retry" });
      }

      const retryEvent = {
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
      };
      const decision = evaluateNumberRules(services.numberRuleStore, retryEvent);
      if (!decision.allowed) {
        recordBlockedNumberDelivery(services.deliveryStore, retryEvent, decision.reason ?? "Blocked by number rule");
        services.eventBus.publish("activity");
        return reply.code(409).send({ error: decision.reason ?? "Blocked by number rule" });
      }

      const result = await services.router.retryInboundMessage(retryEvent);

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

      services.eventBus.publish("activity");
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

    services.eventBus.publish("activity");
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

      services.eventBus.publish("activity");
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

    const decision = evaluateNumberRules(services.numberRuleStore, event);
    if (!decision.allowed) {
      recordBlockedNumberDelivery(services.deliveryStore, event, decision.reason ?? "Blocked by number rule");
      services.eventBus.publish("activity");
      return { ignored: true, reason: "number-rule" };
    }

    const result = await services.router.handleInboundMessage(event);
    services.eventBus.publish("activity");
    return result;
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

function parseNumberRuleInput(body: unknown, existing?: NumberRuleInput): NumberRuleInput {
  if (!body || typeof body !== "object") {
    throw badRequest("Rule payload must be an object");
  }

  const value = body as Record<string, unknown>;
  const accountId = readString(value.accountId, existing?.accountId ?? "").trim();
  const action = readString(value.action, existing?.action ?? "");
  const matchType = readString(value.matchType, existing?.matchType ?? "");
  const pattern = readString(value.pattern, existing?.pattern ?? "");
  const label = readString(value.label, existing?.label ?? "").trim();
  const enabled = typeof value.enabled === "boolean" ? value.enabled : existing?.enabled ?? true;

  if (!accountId) {
    throw badRequest("accountId is required");
  }

  if (action !== "allow" && action !== "deny") {
    throw badRequest("action must be allow or deny");
  }

  if (matchType !== "all" && matchType !== "exact" && matchType !== "regex") {
    throw badRequest("matchType must be all, exact, or regex");
  }

  if (matchType !== "all" && !pattern.trim()) {
    throw badRequest("pattern is required for exact and regex rules");
  }

  if (matchType === "regex") {
    try {
      new RegExp(pattern);
    } catch (error) {
      throw badRequest(error instanceof Error ? `Invalid regex: ${error.message}` : "Invalid regex");
    }
  }

  return {
    accountId,
    action,
    matchType,
    pattern: matchType === "all" ? "" : pattern.trim(),
    ...(label ? { label } : {}),
    enabled,
  };
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function badRequest(message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function requestLog(error: Error) {
  if (process.env.NODE_ENV !== "test") {
    console.error(error);
  }
}

function getQueryToken(url: string) {
  try {
    return new URL(url, "http://localhost").searchParams.get("token");
  } catch {
    return null;
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
