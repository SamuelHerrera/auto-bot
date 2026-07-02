import { createHash } from "node:crypto";
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

export class HermesApiAdapter implements HermesAdapter {
  constructor(private readonly options: HermesApiAdapterOptions) {}

  async createSession(sessionKey: string): Promise<HermesSession> {
    if (!this.options.apiKey) {
      throw new Error("Internal Hermes API key is required.");
    }

    const sessionId = getHermesApiSessionId(sessionKey);
    const response = await fetch(`${getHermesApiRoot(this.options.baseUrl)}/api/sessions`, {
      method: "POST",
      headers: this.getHeaders(sessionKey),
      body: JSON.stringify({
        id: sessionId,
        model: this.options.model,
        title: sessionKey,
        system_prompt:
          "You are replying to a WhatsApp conversation routed through an external bridge. Return only the message text to send back.",
      }),
    });

    if (response.status === 409) {
      return this.getSession(sessionId, sessionKey);
    }

    if (!response.ok) {
      throw new Error(`Hermes session create failed with ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as HermesSessionResponse;
    return this.toHermesSession(payload.session, sessionKey);
  }

  async sendMessage(sessionId: string, event: WhatsAppMessageEvent): Promise<HermesReply> {
    if (!this.options.apiKey) {
      throw new Error("Internal Hermes API key is required.");
    }

    const response = await fetch(
      `${getHermesApiRoot(this.options.baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}/chat`,
      {
        method: "POST",
        headers: this.getHeaders(event.sessionKey),
        body: JSON.stringify({
          message: [
            `WhatsApp account: ${event.accountId}`,
            `Chat: ${event.chatJid}`,
            `Sender: ${event.senderJid}`,
            `Message ID: ${event.messageId}`,
            "",
            event.text,
          ].join("\n"),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Hermes session chat failed with ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as HermesSessionChatResponse;
    const outputText = payload.message?.content?.trim();
    if (!outputText) {
      throw new Error("Hermes API returned an empty response.");
    }

    return {
      sessionId: payload.session_id || response.headers.get("x-hermes-session-id") || sessionId,
      outputText,
    };
  }

  async resetSession(sessionId: string): Promise<void> {
    if (!this.options.apiKey) {
      throw new Error("Internal Hermes API key is required.");
    }

    const response = await fetch(
      `${getHermesApiRoot(this.options.baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: this.getHeaders(),
      },
    );

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(`Hermes session reset failed with ${response.status}: ${await response.text()}`);
    }
  }

  private async getSession(sessionId: string, sessionKey: string): Promise<HermesSession> {
    const response = await fetch(
      `${getHermesApiRoot(this.options.baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: this.getHeaders(sessionKey),
      },
    );

    if (!response.ok) {
      throw new Error(`Hermes session lookup failed with ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as HermesSessionResponse;
    return this.toHermesSession(payload.session, sessionKey);
  }

  private toHermesSession(session: HermesApiSessionPayload, sessionKey: string): HermesSession {
    const now = new Date().toISOString();
    return {
      id: session.id,
      sessionKey,
      accountId: "unassigned",
      chatJid: sessionKey,
      chatType: "direct",
      chatId: sessionKey,
      createdAt: session.started_at ?? now,
      lastActivityAt: session.last_active ?? session.started_at ?? now,
      status: session.end_reason ? "reset" : "active",
    };
  }

  private getHeaders(sessionKey?: string) {
    return {
      authorization: `Bearer ${this.options.apiKey}`,
      "content-type": "application/json",
      ...(sessionKey ? { "x-hermes-session-key": sessionKey } : {}),
    };
  }
}

interface HermesSessionResponse {
  session: HermesApiSessionPayload;
}

interface HermesApiSessionPayload {
  id: string;
  started_at?: string;
  last_active?: string;
  end_reason?: string;
}

interface HermesSessionChatResponse {
  session_id?: string;
  message?: {
    content?: string;
  };
}

function getHermesApiRoot(value: string) {
  return value.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function getHermesApiSessionId(sessionKey: string) {
  const digest = createHash("sha256").update(sessionKey).digest("hex").slice(0, 24);
  return `whatsapp_${digest}`;
}
