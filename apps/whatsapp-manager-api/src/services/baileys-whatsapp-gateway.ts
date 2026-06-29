import makeWASocket, {
  DisconnectReason,
  type BaileysEventMap,
  type WASocket,
  type WAMessage,
  type WAMessageContent,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type {
  OutboundWhatsAppMessage,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
} from "../domain/types.js";
import type { WhatsAppGateway } from "./whatsapp-service.js";

interface BaileysAccountRuntime {
  accountId: string;
  socket: WASocket;
  status: WhatsAppAccountStatus;
  reconnecting: boolean;
}

type InboundHandler = (event: WhatsAppMessageEvent) => Promise<void>;

export class BaileysWhatsAppGateway implements WhatsAppGateway {
  private readonly accounts = new Map<string, BaileysAccountRuntime>();
  private inboundHandler: InboundHandler | null = null;
  private lastActiveAccountId: string | null = null;

  constructor(private readonly stateDir: string) {}

  onInboundMessage(handler: InboundHandler): void {
    this.inboundHandler = handler;
  }

  async getStatus(): Promise<WhatsAppAccountStatus> {
    const accountId =
      this.lastActiveAccountId && this.accounts.has(this.lastActiveAccountId)
        ? this.lastActiveAccountId
        : [...this.accounts.keys()][0];

    if (!accountId) {
      return {
        accountId: "unassigned",
        status: "disconnected",
      };
    }

    return this.accounts.get(accountId)!.status;
  }

  async listAccounts(): Promise<WhatsAppAccountStatus[]> {
    return [...this.accounts.values()].map((account) => account.status);
  }

  async initializeAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    const existing = this.accounts.get(accountId);
    if (existing && existing.status.status !== "disconnected") {
      return existing.status;
    }

    const accountPath = path.join(this.stateDir, sanitizePathSegment(accountId));
    await mkdir(accountPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(accountPath);
    const socket = makeWASocket({
      auth: state,
      browser: ["Auto Bot", "Chrome", "1.0.0"],
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
    });

    const runtime: BaileysAccountRuntime = {
      accountId,
      socket,
      reconnecting: false,
      status: {
        accountId,
        status: "connecting",
      },
    };

    this.accounts.set(accountId, runtime);
    this.lastActiveAccountId = accountId;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(accountId, update);
    });
    socket.ev.on("messages.upsert", (event) => {
      void this.handleMessageUpsert(accountId, event);
    });

    return runtime.status;
  }

  async disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    const runtime = this.accounts.get(accountId);
    if (!runtime) {
      return {
        accountId,
        status: "disconnected",
        disconnectedAt: new Date().toISOString(),
      };
    }

    runtime.reconnecting = false;
    await runtime.socket.logout().catch(() => runtime.socket.end(undefined));

    runtime.status = {
      accountId,
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
    };

    if (this.lastActiveAccountId === accountId) {
      this.lastActiveAccountId = null;
    }

    return runtime.status;
  }

  async sendMessage(message: OutboundWhatsAppMessage): Promise<void> {
    const runtime = this.resolveAccount(message.accountId);
    if (!runtime) {
      throw new Error("No connected WhatsApp account is available for outbound messages.");
    }

    if (runtime.status.status !== "connected") {
      throw new Error(`WhatsApp account ${runtime.accountId} is not connected.`);
    }

    await runtime.socket.sendMessage(message.chatId, { text: message.text });
  }

  async normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent> {
    if (isBaileysMessage(payload)) {
      const event = normalizeBaileysMessage(payload);
      if (!event) {
        throw new Error("Baileys message does not contain a routable text payload.");
      }

      return event;
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid inbound payload.");
    }

    const candidate = payload as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text : "";
    const chatId = typeof candidate.chatId === "string" ? candidate.chatId : "";

    if (!chatId || !text) {
      throw new Error("Inbound payload must contain chatId and text.");
    }

    return {
      chatId,
      text,
      messageId:
        typeof candidate.messageId === "string" ? candidate.messageId : `msg_${Date.now()}`,
      senderId: typeof candidate.senderId === "string" ? candidate.senderId : chatId,
      timestamp:
        typeof candidate.timestamp === "string"
          ? candidate.timestamp
          : new Date().toISOString(),
    };
  }

  private async handleConnectionUpdate(
    accountId: string,
    update: BaileysEventMap["connection.update"],
  ) {
    const runtime = this.accounts.get(accountId);
    if (!runtime) {
      return;
    }

    if (update.qr) {
      runtime.status = {
        accountId,
        status: "connecting",
        qrCode: update.qr,
      };
    }

    if (update.connection === "connecting") {
      runtime.status = {
        ...runtime.status,
        accountId,
        status: "connecting",
      };
    }

    if (update.connection === "open") {
      runtime.reconnecting = false;
      runtime.status = {
        accountId,
        status: "connected",
        connectedAt: new Date().toISOString(),
      };
      this.lastActiveAccountId = accountId;
    }

    if (update.connection === "close") {
      const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !runtime.reconnecting;

      runtime.status = {
        accountId,
        status: shouldReconnect ? "connecting" : "disconnected",
        disconnectedAt: new Date().toISOString(),
        ...(update.lastDisconnect?.error?.message
          ? { lastError: update.lastDisconnect.error.message }
          : {}),
      };

      if (shouldReconnect) {
        runtime.reconnecting = true;
        this.accounts.delete(accountId);
        await this.initializeAccount(accountId).catch((error: unknown) => {
          this.accounts.set(accountId, runtime);
          runtime.status = {
            accountId,
            status: "disconnected",
            disconnectedAt: new Date().toISOString(),
            lastError: error instanceof Error ? error.message : "Reconnect failed.",
          };
        });
      }
    }
  }

  private async handleMessageUpsert(
    _accountId: string,
    event: BaileysEventMap["messages.upsert"],
  ) {
    if (!this.inboundHandler) {
      return;
    }

    for (const message of event.messages) {
      if (message.key.fromMe || message.key.remoteJid === "status@broadcast") {
        continue;
      }

      const normalized = normalizeBaileysMessage(message);
      if (!normalized) {
        continue;
      }

      await this.inboundHandler(normalized);
    }
  }

  private resolveAccount(accountId?: string): BaileysAccountRuntime | null {
    if (accountId) {
      return this.accounts.get(accountId) ?? null;
    }

    if (this.lastActiveAccountId) {
      return this.accounts.get(this.lastActiveAccountId) ?? null;
    }

    return (
      [...this.accounts.values()].find((account) => account.status.status === "connected") ?? null
    );
  }
}

function normalizeBaileysMessage(message: WAMessage): WhatsAppMessageEvent | null {
  const chatId = message.key.remoteJid;
  const text = extractText(message.message ?? undefined);

  if (!chatId || !message.key.id || !text) {
    return null;
  }

  return {
    chatId,
    messageId: message.key.id,
    senderId: message.key.participant ?? chatId,
    text,
    timestamp: normalizeTimestamp(message.messageTimestamp),
  };
}

function extractText(message: WAMessageContent | null | undefined): string {
  if (!message) {
    return "";
  }

  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.templateButtonReplyMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    extractText(message.ephemeralMessage?.message) ??
    extractText(message.viewOnceMessage?.message) ??
    extractText(message.viewOnceMessageV2?.message) ??
    extractText(message.documentWithCaptionMessage?.message) ??
    ""
  ).trim();
}

function normalizeTimestamp(timestamp: WAMessage["messageTimestamp"]): string {
  if (typeof timestamp === "number") {
    return new Date(timestamp * 1000).toISOString();
  }

  const maybeNumber = Number(timestamp?.toString());
  if (Number.isFinite(maybeNumber)) {
    return new Date(maybeNumber * 1000).toISOString();
  }

  return new Date().toISOString();
}

function getDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const output = (error as { output?: { statusCode?: number } }).output;
  return output?.statusCode;
}

function isBaileysMessage(payload: unknown): payload is WAMessage {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "key" in payload &&
      typeof (payload as { key?: unknown }).key === "object",
  );
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
