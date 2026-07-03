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
import type { AuditLogInput, NumberRuleInput } from "./domain/types.js";
import { evaluateNumberRules, recordBlockedNumberDelivery } from "./services/number-rules.js";
import type { RoutingInput } from "./services/chat-session-router.js";

const brandingAuditCoalesceWindowMs = 15_000;

interface CreateAppOptions {
  config: AppConfig;
  services?: AppServices;
}

export function createApp({ config, services = buildServices(config) }: CreateAppOptions) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.LOG_LEVEL },
  });

  function audit(input: AuditLogInput) {
    const record = shouldCoalesceAuditLog(input) && services.auditLogStore?.coalesceAuditLog
      ? services.auditLogStore.coalesceAuditLog(input, brandingAuditCoalesceWindowMs)
      : (services.auditLogStore?.recordAuditLog(input) ?? {
        id: "ephemeral",
        actor: input.actor?.trim() || "system",
        outcome: input.outcome ?? "success",
        createdAt: new Date().toISOString(),
        ...input,
      });
    app.log.info({ audit: record }, "audit event");
    services.eventBus.publish("logs");
    return record;
  }

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
    audit({
      action: "whatsapp.connect",
      resourceType: "whatsapp-account",
      resourceId: status.accountId,
      details: {
        requestedAccountId: request.body?.accountId ?? null,
        status: status.status,
        createdDefaultRule,
      },
    });
    return status;
  });

  app.get("/whatsapp/accounts", async () => ({
    items: mergeAccountMetadata(await services.whatsappGateway.listAccounts(), services.accountMetadataStore?.listAccountMetadata() ?? []),
  }));

  app.patch<{ Params: { accountId: string }; Body: unknown }>("/whatsapp/accounts/:accountId", async (request, reply) => {
    if (!services.accountMetadataStore) {
      return reply.code(503).send({ error: "Account metadata storage is not configured" });
    }

    const accountId = decodeURIComponent(request.params.accountId).trim();
    if (!accountId) {
      return reply.code(400).send({ error: "accountId is required" });
    }

    const alias = parseAccountAliasInput(request.body);
    const metadata = services.accountMetadataStore.setAccountAlias(accountId, alias);
    services.eventBus.publish("accounts");
    audit({
      action: "whatsapp-account.alias-update",
      resourceType: "whatsapp-account",
      resourceId: accountId,
      details: {
        alias: metadata.alias ?? null,
      },
    });
    return metadata;
  });

  app.post<{ Params: { accountId: string } }>(
    "/whatsapp/accounts/:accountId/disconnect",
    async (request) => {
      const status = await services.whatsappGateway.disconnectAccount(request.params.accountId);
      services.eventBus.publish("accounts");
      audit({
        action: "whatsapp.disconnect",
        resourceType: "whatsapp-account",
        resourceId: status.accountId,
        details: {
          status: status.status,
          hadError: Boolean(status.lastError),
        },
      });
      return status;
    },
  );

  app.get("/whatsapp/status", async () => {
    const status = await services.whatsappGateway.getStatus();
    return mergeAccountMetadata([status], services.accountMetadataStore?.listAccountMetadata() ?? [])[0] ?? status;
  });

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
      const session = await services.router.getOrCreateSession(getRouteFromRequest(request.params.chatId, request.body));
      audit({
        action: "session.create",
        resourceType: "hermes-session",
        resourceId: session.id,
        details: {
          accountId: session.accountId,
          chatJid: session.chatJid,
          sessionKey: session.sessionKey,
        },
      });
      return session;
    },
  );

  app.post<{ Params: { chatId: string }; Body: Partial<RoutingInput> }>(
    "/chats/:chatId/session/reset",
    async (request) => {
      const session = await services.router.resetSession(getRouteFromRequest(request.params.chatId, request.body));
      audit({
        action: "session.reset",
        resourceType: "hermes-session",
        resourceId: session.id,
        details: {
          accountId: session.accountId,
          chatJid: session.chatJid,
          sessionKey: session.sessionKey,
        },
      });
      return session;
    },
  );

  app.post<{
    Params: { chatId: string };
    Body: { hermesSessionId: string } & Partial<RoutingInput>;
  }>("/chats/:chatId/session/remap", async (request) => {
    const mapping = await services.router.remapSession(
      getRouteFromRequest(request.params.chatId, request.body),
      request.body.hermesSessionId,
    );
    audit({
      action: "session.remap",
      resourceType: "chat-session",
      resourceId: mapping.sessionKey,
      details: {
        accountId: mapping.accountId,
        chatJid: mapping.chatJid,
        hermesSessionId: mapping.hermesSessionId,
      },
    });
    return mapping;
  });

  app.get<{ Querystring: { accountId?: string; chatJid?: string } }>("/sessions", async (request) => ({
    items: await services.router.getMappings({
      ...(request.query.accountId ? { accountId: request.query.accountId } : {}),
      ...(request.query.chatJid ? { chatJid: request.query.chatJid } : {}),
    }),
  }));

  app.get<{ Querystring: { accountId?: string; chatJid?: string } }>("/deliveries", async (request) => ({
    items: services.deliveryStore?.listDeliveries({
      ...(request.query.accountId ? { accountId: request.query.accountId } : {}),
      ...(request.query.chatJid ? { chatJid: request.query.chatJid } : {}),
    }) ?? [],
  }));

  app.get<{ Querystring: { accountId?: string } }>("/manager/chats", async (request) => ({
    items: services.managerChatMetadataStore?.listManagerChatMetadata(request.query.accountId) ?? [],
  }));

  app.patch<{ Body: unknown }>("/manager/chats", async (request, reply) => {
    if (!services.managerChatMetadataStore) {
      return reply.code(503).send({ error: "Manager chat metadata storage is not configured" });
    }

    const input = parseManagerChatMetadataInput(request.body);
    const metadata = services.managerChatMetadataStore.setManagerChatArchived(input);
    services.eventBus.publish("activity");
    audit({
      action: metadata.archived ? "manager-chat.archive" : "manager-chat.unarchive",
      resourceType: "manager-chat",
      resourceId: `${metadata.accountId}:${metadata.chatJid}`,
      details: {
        accountId: metadata.accountId,
        chatJid: metadata.chatJid,
        archived: metadata.archived,
      },
    });
    return metadata;
  });

  app.get<{ Querystring: { accountId?: string } }>("/whatsapp/sync/summary", async (request) => (
    services.whatsappSyncStore?.getWhatsAppSyncSummary(request.query.accountId) ?? emptyWhatsAppSyncSummary()
  ));

  app.get<{ Querystring: SyncListQuery }>("/whatsapp/sync/contacts", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppContacts(
      request.query.accountId,
      readLimit(request.query.limit, 1000),
    ) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery }>("/whatsapp/sync/chats", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppChats(
      request.query.accountId,
      readLimit(request.query.limit, 1000),
    ) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery & { chatJid?: string } }>("/whatsapp/sync/messages", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppMessages({
      limit: readLimit(request.query.limit, 1000),
      ...(request.query.accountId ? { accountId: request.query.accountId } : {}),
      ...(request.query.chatJid ? { chatJid: request.query.chatJid } : {}),
    }) ?? [],
  }));

  app.get<{ Querystring: { accountId?: string } }>("/whatsapp/sync/message-counts", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppMessageCounts(request.query.accountId) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery & { chatJid?: string } }>("/whatsapp/sync/message-receipts", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppMessageReceipts({
      limit: readLimit(request.query.limit, 1000),
      ...(request.query.accountId ? { accountId: request.query.accountId } : {}),
      ...(request.query.chatJid ? { chatJid: request.query.chatJid } : {}),
    }) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery & { chatJid?: string } }>("/whatsapp/sync/message-updates", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppMessageUpdates({
      limit: readLimit(request.query.limit, 1000),
      ...(request.query.accountId ? { accountId: request.query.accountId } : {}),
      ...(request.query.chatJid ? { chatJid: request.query.chatJid } : {}),
    }) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery & { chatJid?: string } }>("/whatsapp/sync/media-assets", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppMediaAssets({
      limit: readLimit(request.query.limit, 1000),
      ...(request.query.accountId ? { accountId: request.query.accountId } : {}),
      ...(request.query.chatJid ? { chatJid: request.query.chatJid } : {}),
    }) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery }>("/whatsapp/sync/lid-mappings", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppLidMappings(
      request.query.accountId,
      readLimit(request.query.limit, 1000),
    ) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery }>("/whatsapp/sync/history-batches", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppHistorySyncBatches(
      request.query.accountId,
      readLimit(request.query.limit, 1000),
    ) ?? [],
  }));

  app.get<{ Querystring: SyncListQuery }>("/whatsapp/sync/events", async (request) => ({
    items: services.whatsappSyncStore?.listWhatsAppSyncEvents(
      request.query.accountId,
      readLimit(request.query.limit, 1000),
    ) ?? [],
  }));

  app.get<{ Querystring: { limit?: string } }>("/audit-logs", async (request) => ({
    items: services.auditLogStore?.listAuditLogs(readLimit(request.query.limit)) ?? [],
  }));

  app.post<{ Body: unknown }>("/audit-logs", async (request) => {
    const input = parseAuditLogInput(request.body);
    return audit(input);
  });

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
    audit({
      action: "number-rule.create",
      resourceType: "number-rule",
      resourceId: rule.id,
      details: {
        accountId: rule.accountId,
        action: rule.action,
        matchType: rule.matchType,
        pattern: rule.pattern,
        enabled: rule.enabled,
      },
    });
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
    audit({
      action: "number-rule.update",
      resourceType: "number-rule",
      resourceId: existing.id,
      details: {
        before: existing,
        after: rule,
      },
    });
    return rule;
  });

  app.delete<{ Params: { ruleId: string } }>("/number-rules/:ruleId", async (request, reply) => {
    if (!services.numberRuleStore) {
      return reply.code(503).send({ error: "Number rule storage is not configured" });
    }

    const ruleId = decodeURIComponent(request.params.ruleId);
    const existing = services.numberRuleStore.getNumberRule(ruleId);
    if (!existing) {
      return reply.code(404).send({ error: "Number rule not found" });
    }

    const deleted = services.numberRuleStore.deleteNumberRule(ruleId);
    if (!deleted) {
      return reply.code(404).send({ error: "Number rule not found" });
    }

    services.eventBus.publish("rules");
    audit({
      action: "number-rule.delete",
      resourceType: "number-rule",
      resourceId: existing.id,
      details: {
        accountId: existing.accountId,
        action: existing.action,
        matchType: existing.matchType,
        pattern: existing.pattern,
      },
    });
    return reply.code(204).send();
  });

  app.post<{ Params: { deliveryId: string } }>("/deliveries/:deliveryId/retry", async (request, reply) => {
    const record = services.deliveryStore?.getDelivery(decodeURIComponent(request.params.deliveryId));
    if (!record) {
      return reply.code(404).send({ error: "Delivery record not found" });
    }

    if (record.status === "ignored") {
      return reply.code(409).send({ error: record.error ?? "Ignored delivery cannot be retried" });
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
        const delivery = recordBlockedNumberDelivery(services.deliveryStore, retryEvent, decision.reason ?? "Blocked by number rule");
        services.eventBus.publish("activity", {
          accountId: record.accountId,
          chatJid: record.chatJid,
          source: "delivery",
          deliveries: [delivery],
        });
        audit({
          action: "delivery.retry",
          outcome: "ignored",
          resourceType: "delivery",
          resourceId: record.id,
          details: {
            accountId: record.accountId,
            chatJid: record.chatJid,
            reason: decision.reason ?? "Blocked by number rule",
          },
        });
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
      const delivery = {
        ...resolvedRecord,
        status: "sent",
        attempts: record.attempts + 1,
        updatedAt: new Date().toISOString(),
      } as const;
      services.deliveryStore?.saveDelivery(delivery);

      services.eventBus.publish("activity", {
        accountId: record.accountId,
        chatJid: record.chatJid,
        source: "delivery",
        deliveries: [delivery],
      });
      audit({
        action: "delivery.retry",
        resourceType: "delivery",
        resourceId: record.id,
        details: {
          accountId: record.accountId,
          chatJid: record.chatJid,
          failureStage: record.failureStage,
          attempts: record.attempts + 1,
        },
      });
      return services.deliveryStore?.getDelivery(record.id) ?? record;
    }

    if (!record.outboundText.trim()) {
      return reply.code(409).send({ error: "Delivery record has no outbound text to retry" });
    }

    const delivery = await sendReplyWithDeliveryRecord({
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

    services.eventBus.publish("activity", {
      accountId: record.accountId,
      chatJid: record.chatJid,
      source: "delivery",
      deliveries: [delivery],
    });
    audit({
      action: "delivery.retry",
      resourceType: "delivery",
      resourceId: record.id,
      details: {
        accountId: record.accountId,
        chatJid: record.chatJid,
        failureStage: record.failureStage ?? "whatsapp",
        attempts: record.attempts + 1,
      },
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

      services.eventBus.publish("activity");
      audit({
        action: "message.outbound",
        resourceType: "whatsapp-message",
        resourceId: request.body.chatId,
        details: {
          accountId: request.body.accountId ?? null,
          chatId: request.body.chatId,
          textLength: request.body.text.length,
        },
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
        audit({
          action: "message.inbound",
          outcome: "failure",
          resourceType: "whatsapp-message",
          details: {
            reason: "group-chat",
          },
        });
        return { ignored: true, reason: "group-chat" };
      }

      throw error;
    }

    const decision = evaluateNumberRules(services.numberRuleStore, event);
    if (!decision.allowed) {
      const delivery = recordBlockedNumberDelivery(services.deliveryStore, event, decision.reason ?? "Blocked by number rule");
      services.eventBus.publish("activity", {
        accountId: event.accountId,
        chatJid: event.chatJid,
        source: "delivery",
        deliveries: [delivery],
      });
      audit({
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
      return { ignored: true, reason: "number-rule" };
    }

    const result = await services.router.handleInboundMessage(event);
    services.eventBus.publish("activity", {
      accountId: event.accountId,
      chatJid: event.chatJid,
      source: "message-inbound",
    });
    audit({
      action: "message.inbound",
      resourceType: "whatsapp-message",
      resourceId: event.messageId,
      details: {
        accountId: event.accountId,
        chatJid: event.chatJid,
        duplicate: result.duplicate,
        hermesSessionId: result.session?.id ?? null,
      },
    });
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

function parseAccountAliasInput(body: unknown) {
  if (!body || typeof body !== "object") {
    throw badRequest("Account payload must be an object");
  }

  const alias = readString((body as Record<string, unknown>).alias, "").trim();
  if (alias.length > 80) {
    throw badRequest("alias must be 80 characters or fewer");
  }

  return alias;
}

function parseManagerChatMetadataInput(body: unknown) {
  if (!body || typeof body !== "object") {
    throw badRequest("Manager chat payload must be an object");
  }

  const value = body as Record<string, unknown>;
  const accountId = readString(value.accountId, "").trim();
  const chatJid = readString(value.chatJid, "").trim();
  if (!accountId) {
    throw badRequest("accountId is required");
  }
  if (!chatJid) {
    throw badRequest("chatJid is required");
  }
  if (typeof value.archived !== "boolean") {
    throw badRequest("archived must be boolean");
  }

  return {
    accountId,
    chatJid,
    archived: value.archived,
  };
}

function mergeAccountMetadata<T extends { accountId: string }>(
  accounts: T[],
  metadata: Array<{ accountId: string; alias?: string }>,
): Array<T & { alias?: string }> {
  const metadataByAccountId = new Map(metadata.map((item) => [item.accountId, item]));
  return accounts.map((account) => {
    const alias = metadataByAccountId.get(account.accountId)?.alias?.trim();
    return alias ? { ...account, alias } : account;
  });
}

function parseAuditLogInput(body: unknown): AuditLogInput {
  if (!body || typeof body !== "object") {
    throw badRequest("Audit log payload must be an object");
  }

  const value = body as Record<string, unknown>;
  const action = readString(value.action, "").trim();
  if (!action) {
    throw badRequest("action is required");
  }

  const outcome = readString(value.outcome, "success");
  if (outcome !== "success" && outcome !== "failure" && outcome !== "ignored") {
    throw badRequest("outcome must be success, failure, or ignored");
  }

  const details = value.details && typeof value.details === "object" && !Array.isArray(value.details)
    ? value.details as Record<string, unknown>
    : undefined;

  return {
    action,
    outcome,
    ...(readString(value.actor, "").trim() ? { actor: readString(value.actor, "").trim() } : {}),
    ...(readString(value.resourceType, "").trim() ? { resourceType: readString(value.resourceType, "").trim() } : {}),
    ...(readString(value.resourceId, "").trim() ? { resourceId: readString(value.resourceId, "").trim() } : {}),
    ...(details ? { details } : {}),
  };
}

function shouldCoalesceAuditLog(input: AuditLogInput) {
  return input.action === "ui-branding.update" && input.outcome !== "failure";
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function readLimit(value: string | undefined, max = 500) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return 200;
  }

  return Math.min(Math.max(parsed, 1), max);
}

function emptyWhatsAppSyncSummary() {
  return {
    contacts: 0,
    chats: 0,
    messages: 0,
    messageReceipts: 0,
    messageUpdates: 0,
    mediaAssets: 0,
    lidMappings: 0,
    historySyncBatches: 0,
    syncEvents: 0,
  };
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

interface SyncListQuery {
  accountId?: string;
  limit?: string;
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
