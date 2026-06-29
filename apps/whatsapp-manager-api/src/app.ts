import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import { buildServices, type AppServices } from "./build-services.js";

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

  app.post<{ Body: { accountId: string } }>("/whatsapp/connect", async (request) => {
    return services.whatsappGateway.initializeAccount(request.body.accountId);
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

  app.get<{ Params: { chatId: string } }>("/chats/:chatId/session", async (request, reply) => {
    const session = await services.router.getSession(request.params.chatId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return session;
  });

  app.post<{ Params: { chatId: string } }>("/chats/:chatId/session", async (request) => {
    return services.router.getOrCreateSession(request.params.chatId);
  });

  app.post<{ Params: { chatId: string } }>("/chats/:chatId/session/reset", async (request) => {
    return services.router.resetSession(request.params.chatId);
  });

  app.post<{
    Params: { chatId: string };
    Body: { hermesSessionId: string };
  }>("/chats/:chatId/session/remap", async (request) => {
    return services.router.remapSession(request.params.chatId, request.body.hermesSessionId);
  });

  app.get("/sessions", async () => ({
    items: await services.router.getMappings(),
  }));

  app.post<{ Body: { chatId: string; text: string } }>("/messages/outbound", async (request) => {
    await services.whatsappGateway.sendMessage({
      chatId: request.body.chatId,
      text: request.body.text,
    });

    return { status: "queued" };
  });

  app.post<{ Body: unknown }>("/messages/inbound", async (request) => {
    const event = await services.whatsappGateway.normalizeInboundEvent(request.body);
    return services.router.handleInboundMessage(event);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid configuration", issues: error.issues });
    }

    const normalizedError = error instanceof Error ? error : new Error("Internal Server Error");
    requestLog(normalizedError);
    return reply.code(500).send({ error: normalizedError.message });
  });

  return app;
}

function requestLog(error: Error) {
  if (process.env.NODE_ENV !== "test") {
    console.error(error);
  }
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
