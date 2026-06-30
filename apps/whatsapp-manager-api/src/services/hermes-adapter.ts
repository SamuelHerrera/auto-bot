import type { HermesReply, HermesSession, WhatsAppMessageEvent } from "../domain/types.js";

export interface HermesAdapter {
  createSession(sessionKey: string): Promise<HermesSession>;
  sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply>;
  resetSession(sessionId: string): Promise<void>;
}

export interface HermesApiAdapterOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class MockHermesAdapter implements HermesAdapter {
  async createSession(sessionKey: string): Promise<HermesSession> {
    const now = new Date().toISOString();
    return {
      id: `hermes_${sessionKey}_${Date.now()}`,
      sessionKey,
      accountId: "unassigned",
      chatJid: sessionKey,
      chatType: "direct",
      chatId: sessionKey,
      createdAt: now,
      lastActivityAt: now,
      status: "active",
    };
  }

  async sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply> {
    return {
      sessionId,
      outputText: `mock-hermes-response: ${event.text}`,
    };
  }

  async resetSession(_sessionId: string): Promise<void> {}
}

export class CliHermesAdapter implements HermesAdapter {
  async createSession(_sessionKey: string): Promise<HermesSession> {
    throw new Error("CLI Hermes adapter is not implemented yet.");
  }

  async sendMessage(_sessionId: string, _event: WhatsAppMessageEvent): Promise<HermesReply> {
    throw new Error("CLI Hermes adapter is not implemented yet.");
  }

  async resetSession(_sessionId: string): Promise<void> {
    throw new Error("CLI Hermes adapter is not implemented yet.");
  }
}

export class HermesApiAdapter implements HermesAdapter {
  constructor(private readonly options: HermesApiAdapterOptions) {}

  async createSession(sessionKey: string): Promise<HermesSession> {
    const now = new Date().toISOString();
    return {
      id: `hermes-api:${sessionKey}`,
      sessionKey,
      accountId: "unassigned",
      chatJid: sessionKey,
      chatType: "direct",
      chatId: sessionKey,
      createdAt: now,
      lastActivityAt: now,
      status: "active",
    };
  }

  async sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply> {
    if (!this.options.apiKey) {
      throw new Error("HERMES_API_KEY is required when HERMES_ADAPTER_MODE=api.");
    }

    const response = await fetch(`${trimTrailingSlash(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are replying to a WhatsApp conversation routed through an external bridge. Return only the message text to send back.",
          },
          {
            role: "user",
            content: [
              `Routing key: ${event.sessionKey}`,
              `WhatsApp account: ${event.accountId}`,
              `Chat: ${event.chatJid}`,
              `Sender: ${event.senderJid}`,
              "",
              event.text,
            ].join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Hermes API request failed with ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as ChatCompletionsResponse;
    const outputText = payload.choices[0]?.message?.content?.trim();
    if (!outputText) {
      throw new Error("Hermes API returned an empty response.");
    }

    return {
      sessionId,
      outputText,
    };
  }

  async resetSession(_sessionId: string): Promise<void> {}
}

interface ChatCompletionsResponse {
  choices: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
