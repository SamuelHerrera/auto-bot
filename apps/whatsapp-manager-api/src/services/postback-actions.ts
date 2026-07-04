import { randomUUID } from "node:crypto";
import type {
  PostbackActionRecord,
  PostbackActionRunRecord,
  WhatsAppMessageEvent,
} from "../domain/types.js";
import type { AgentPlatformEventStore, PostbackActionStore } from "./chat-session-router.js";

export interface PostbackActionDispatcherOptions {
  store?: PostbackActionStore;
  agentPlatformEventStore?: AgentPlatformEventStore;
}

export class PostbackActionDispatcher {
  constructor(private readonly options: PostbackActionDispatcherOptions) {}

  async dispatchInboundMessage(event: WhatsAppMessageEvent): Promise<PostbackActionRunRecord[]> {
    const actions = this.options.store
      ?.listPostbackActions({ accountId: event.accountId, chatJid: event.chatJid })
      .filter((action) => action.enabled && action.trigger === "inbound_message" && matchesAction(action, event)) ?? [];

    if (actions.length === 0) {
      return [];
    }

    const runs: PostbackActionRunRecord[] = [];
    for (const action of actions) {
      runs.push(await this.executeAction(action, event));
    }

    return runs;
  }

  async executeAction(action: PostbackActionRecord, event: WhatsAppMessageEvent): Promise<PostbackActionRunRecord> {
    const now = new Date().toISOString();
    const run: PostbackActionRunRecord = {
      id: randomUUID(),
      actionId: action.id,
      actionName: action.name,
      actionType: action.actionType,
      accountId: event.accountId,
      chatJid: event.chatJid,
      inboundMessageId: event.messageId,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.options.store?.savePostbackActionRun(run);

    try {
      const result = action.actionType === "agent"
        ? await this.executeAgentAction(action, event)
        : await this.executeHttpAction(action, event);
      const completed: PostbackActionRunRecord = {
        ...run,
        status: "success",
        attempts: 1,
        ...result,
        updatedAt: new Date().toISOString(),
      };
      this.options.store?.savePostbackActionRun(completed);
      return completed;
    } catch (error) {
      const failed: PostbackActionRunRecord = {
        ...run,
        status: "failed",
        attempts: 1,
        error: error instanceof Error ? error.message : "Postback action failed",
        updatedAt: new Date().toISOString(),
      };
      this.options.store?.savePostbackActionRun(failed);
      return failed;
    }
  }

  private async executeAgentAction(action: PostbackActionRecord, event: WhatsAppMessageEvent) {
    const config = parseConfig(action);
    const queued = this.options.agentPlatformEventStore?.appendAgentPlatformEvent(event);
    if (!queued) {
      throw new Error("Agent platform event storage is not configured.");
    }
    return {
      requestJson: JSON.stringify({ event, config }),
      responseBody: JSON.stringify({
        deliveryMode: "platform",
        sequence: queued.sequence,
      }),
    };
  }

  private async executeHttpAction(action: PostbackActionRecord, event: WhatsAppMessageEvent) {
    const config = parseConfig(action);
    const url = readConfigString(config.url);
    if (!url) {
      throw new Error("HTTP postback action requires config.url");
    }

    const method = readConfigString(config.method) || "POST";
    const headers = readHeaders(config.headers);
    const payload = buildPayload(config, event);
    const response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(readPositiveInteger(config.timeoutMs, 10000)),
    });
    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP postback failed with ${response.status}: ${responseBody.slice(0, 300)}`);
    }

    return {
      requestJson: JSON.stringify({ url, method, headers: redactHeaders(headers), payload }),
      responseStatus: response.status,
      responseBody: responseBody.slice(0, 2000),
    };
  }
}

function matchesAction(action: PostbackActionRecord, event: WhatsAppMessageEvent) {
  return (!action.accountId || action.accountId === event.accountId) &&
    (!action.chatJid || action.chatJid === event.chatJid);
}

function parseConfig(action: PostbackActionRecord): Record<string, unknown> {
  try {
    const parsed = JSON.parse(action.configJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function buildPayload(config: Record<string, unknown>, event: WhatsAppMessageEvent) {
  const template = config.payloadTemplate;
  if (template && typeof template === "object" && !Array.isArray(template)) {
    return renderTemplate(template as Record<string, unknown>, event);
  }

  return {
    accountId: event.accountId,
    chatJid: event.chatJid,
    chatType: event.chatType,
    senderJid: event.senderJid,
    participantJid: event.participantJid ?? null,
    messageId: event.messageId,
    text: event.text,
    timestamp: event.timestamp,
  };
}

function renderTemplate(template: Record<string, unknown>, event: WhatsAppMessageEvent): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [key, renderTemplateValue(value, event)]),
  );
}

function renderTemplateValue(value: unknown, event: WhatsAppMessageEvent): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*event\.([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
      const eventValue = (event as unknown as Record<string, unknown>)[key];
      return eventValue === undefined || eventValue === null ? "" : String(eventValue);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplateValue(item, event));
  }
  if (value && typeof value === "object") {
    return renderTemplate(value as Record<string, unknown>, event);
  }
  return value;
}

function readHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function redactHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|api-key|token|secret/i.test(key) ? "[redacted]" : value,
    ]),
  );
}

function readConfigString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}
