import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  type BaileysEventMap,
  type WASocket,
  type WAMessage,
  type WAMessageContent,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type {
  OutboundWhatsAppMessage,
  WhatsAppMediaAttachment,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
  WhatsAppSyncEventType,
} from "../domain/types.js";
import { getWhatsAppChatType, getWhatsAppSessionKey } from "../domain/types.js";
import type { WhatsAppGateway, WhatsAppSyncEvent } from "./whatsapp-service.js";

interface BaileysAccountRuntime {
  accountId: string;
  statePath: string;
  socket?: WASocket;
  status: WhatsAppAccountStatus;
  transient: boolean;
  reconnecting: boolean;
  disconnecting: boolean;
}

type InboundHandler = (event: WhatsAppMessageEvent) => Promise<void>;
type StatusHandler = (status: WhatsAppAccountStatus) => void;
type SyncHandler = (event: WhatsAppSyncEvent) => void;

export class BaileysWhatsAppGateway implements WhatsAppGateway {
  private readonly accounts = new Map<string, BaileysAccountRuntime>();
  private inboundHandler: InboundHandler | null = null;
  private statusHandler: StatusHandler | null = null;
  private syncHandler: SyncHandler | null = null;
  private lastActiveAccountId: string | null = null;

  constructor(
    private readonly stateDir: string,
    private readonly mediaDir?: string,
  ) {
    void this.initializePersistedAccounts();
  }

  onInboundMessage(handler: InboundHandler): void {
    this.inboundHandler = handler;
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandler = handler;
  }

  onSyncEvent(handler: SyncHandler): void {
    this.syncHandler = handler;
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
    return [...this.accounts.values()]
      .filter((account) => !account.transient)
      .map((account) => account.status);
  }

  async initializeAccount(accountId?: string): Promise<WhatsAppAccountStatus> {
    const requestedAccountId = accountId?.trim();
    const isTransient = !requestedAccountId;
    const normalizedAccountId = requestedAccountId || createPendingAccountId();
    return this.initializeAccountRuntime(normalizedAccountId, isTransient);
  }

  private async initializeAccountRuntime(accountId: string, transient: boolean): Promise<WhatsAppAccountStatus> {
    const existing = this.accounts.get(accountId);
    if (existing && existing.status.status !== "disconnected") {
      return existing.status;
    }

    const accountPath = this.getAccountPath(accountId);
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
      statePath: accountPath,
      socket,
      transient,
      reconnecting: false,
      disconnecting: false,
      status: {
        accountId,
        status: "connecting",
      },
    };

    this.accounts.set(accountId, runtime);
    this.lastActiveAccountId = accountId;
    this.statusHandler?.(runtime.status);

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(runtime.accountId, update);
    });
    socket.ev.on("messages.upsert", (event) => {
      void this.handleMessageUpsert(runtime.accountId, event);
    });
    this.registerSyncEventHandlers(runtime);

    return runtime.status;
  }

  async disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus> {
    const runtime = this.accounts.get(accountId);
    const accountPath = runtime?.statePath ?? this.getAccountPath(accountId);
    if (!runtime) {
      await rm(accountPath, { recursive: true, force: true });
      return {
        accountId,
        status: "disconnected",
        disconnectedAt: new Date().toISOString(),
        lastError: "No active WhatsApp socket was available; local auth state was removed.",
      };
    }

    runtime.reconnecting = false;
    runtime.disconnecting = true;
    let logoutError: string | undefined;
    await runtime.socket?.logout().catch((error: unknown) => {
      logoutError = error instanceof Error ? error.message : "WhatsApp logout failed.";
      runtime.socket?.end(undefined);
    });
    await rm(accountPath, { recursive: true, force: true });

    const status: WhatsAppAccountStatus = {
      accountId,
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
      ...(logoutError ? { lastError: logoutError } : {}),
    };
    runtime.status = status;
    this.accounts.delete(accountId);
    this.statusHandler?.(status);

    if (this.lastActiveAccountId === accountId) {
      this.lastActiveAccountId = null;
    }

    return status;
  }

  async sendMessage(message: OutboundWhatsAppMessage): Promise<void> {
    const runtime = this.resolveAccount(message.accountId);
    if (!runtime) {
      throw new Error("No connected WhatsApp account is available for outbound messages.");
    }

    if (runtime.status.status !== "connected") {
      throw new Error(`WhatsApp account ${runtime.accountId} is not connected.`);
    }

    if (!runtime.socket) {
      throw new Error(`WhatsApp account ${runtime.accountId} has no active socket.`);
    }

    const chatJid = message.chatJid ?? message.chatId;

    if (message.reaction) {
      await runtime.socket.sendMessage(chatJid, {
        react: {
          text: message.reaction.emoji,
          key: {
            remoteJid: chatJid,
            id: message.reaction.targetMessageId,
          },
        },
      });
      return;
    }

    await runtime.socket.sendPresenceUpdate("composing", chatJid).catch(() => undefined);

    for (const attachment of message.media ?? []) {
      if (!attachment.url) {
        continue;
      }

      if (attachment.type === "image") {
        await runtime.socket.sendMessage(chatJid, {
          image: { url: attachment.url },
          caption: attachment.caption ?? message.text,
          ...(attachment.mimetype ? { mimetype: attachment.mimetype } : {}),
        });
      } else if (attachment.type === "video") {
        await runtime.socket.sendMessage(chatJid, {
          video: { url: attachment.url },
          caption: attachment.caption ?? message.text,
          ...(attachment.mimetype ? { mimetype: attachment.mimetype } : {}),
        });
      } else if (attachment.type === "audio") {
        await runtime.socket.sendMessage(chatJid, {
          audio: { url: attachment.url },
          ...(attachment.mimetype ? { mimetype: attachment.mimetype } : {}),
        });
      } else {
        await runtime.socket.sendMessage(chatJid, {
          document: { url: attachment.url },
          caption: attachment.caption ?? message.text,
          fileName: attachment.fileName ?? "attachment",
          mimetype: attachment.mimetype ?? "application/octet-stream",
        });
      }
    }

    for (const chunk of splitWhatsAppText(message.text)) {
      await runtime.socket.sendMessage(chatJid, { text: chunk });
    }

    await runtime.socket.sendPresenceUpdate("paused", chatJid).catch(() => undefined);
  }

  async normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent> {
    if (isBaileysMessage(payload)) {
      const event = normalizeBaileysMessage("manual", payload);
      if (!event) {
        throw new Error("Baileys message does not contain a routable text payload.");
      }

      if (event.chatType === "group") {
        throw new Error("Group chats are not supported by this WhatsApp manager.");
      }

      return event;
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid inbound payload.");
    }

    const candidate = payload as Record<string, unknown>;
    const text = typeof candidate.text === "string" ? candidate.text : "";
    const media = Array.isArray(candidate.media) ? candidate.media : [];
    const chatJid =
      typeof candidate.chatJid === "string"
        ? candidate.chatJid
        : typeof candidate.chatId === "string"
          ? candidate.chatId
          : "";
    const accountId = typeof candidate.accountId === "string" ? candidate.accountId : "manual";
    const chatType =
      candidate.chatType === "group" || candidate.chatType === "direct"
        ? candidate.chatType
        : getWhatsAppChatType(chatJid);
    const participantJid =
      typeof candidate.participantJid === "string" ? candidate.participantJid : undefined;
    const alternateJids = Array.isArray(candidate.alternateJids)
      ? candidate.alternateJids.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : [];

    if (!chatJid || (!text && media.length === 0)) {
      throw new Error("Inbound payload must contain chatJid/chatId and text or media.");
    }

    if (chatType === "group") {
      throw new Error("Group chats are not supported by this WhatsApp manager.");
    }

    const sessionKey = getWhatsAppSessionKey({
      accountId,
      chatJid,
      chatType,
      ...(participantJid ? { participantJid } : {}),
    });

    return {
      accountId,
      chatJid,
      chatType,
      senderJid: typeof candidate.senderJid === "string" ? candidate.senderJid : chatJid,
      ...(participantJid ? { participantJid } : {}),
      ...(alternateJids.length > 0 ? { alternateJids } : {}),
      sessionKey,
      chatId: chatJid,
      text,
      messageId:
        typeof candidate.messageId === "string" ? candidate.messageId : `msg_${Date.now()}`,
      senderId:
        typeof candidate.senderId === "string"
          ? candidate.senderId
          : typeof candidate.senderJid === "string"
            ? candidate.senderJid
            : chatJid,
      ...(media.length > 0
        ? { media: media.map((item) => item as NonNullable<WhatsAppMessageEvent["media"]>[number]) }
        : {}),
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
      this.statusHandler?.(runtime.status);
    }

    if (update.connection === "connecting") {
      runtime.status = {
        ...runtime.status,
        accountId,
        status: "connecting",
      };
      this.statusHandler?.(runtime.status);
    }

    if (update.connection === "open") {
      const linkedAccountId = runtime.transient
        ? getLinkedAccountId(runtime.socket) ?? accountId
        : accountId;
      if (linkedAccountId !== accountId) {
        this.renameRuntimeAccount(runtime, linkedAccountId);
      }

      runtime.reconnecting = false;
      runtime.status = {
        accountId: runtime.accountId,
        status: "connected",
        connectedAt: new Date().toISOString(),
      };
      runtime.transient = false;
      this.lastActiveAccountId = runtime.accountId;
      this.statusHandler?.(runtime.status);
    }

    if (update.connection === "close") {
      const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
      const isIntentionalDisconnect = runtime.disconnecting || statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !isIntentionalDisconnect && !runtime.reconnecting;

      runtime.status = {
        accountId,
        status: shouldReconnect ? "connecting" : "disconnected",
        disconnectedAt: new Date().toISOString(),
        ...(update.lastDisconnect?.error?.message
          ? { lastError: update.lastDisconnect.error.message }
          : {}),
      };
      this.statusHandler?.(runtime.status);

      if (isIntentionalDisconnect) {
        this.accounts.delete(accountId);
        if (this.lastActiveAccountId === accountId) {
          this.lastActiveAccountId = null;
        }
      }

      if (shouldReconnect) {
        runtime.reconnecting = true;
        this.accounts.delete(accountId);
        await this.initializeAccountRuntime(accountId, runtime.transient).catch((error: unknown) => {
          this.accounts.set(accountId, runtime);
          runtime.status = {
            accountId,
            status: "disconnected",
            disconnectedAt: new Date().toISOString(),
            lastError: error instanceof Error ? error.message : "Reconnect failed.",
          };
          this.statusHandler?.(runtime.status);
        });
      }
    }
  }

  private async handleMessageUpsert(
    _accountId: string,
    event: BaileysEventMap["messages.upsert"],
  ) {
    await this.downloadMessageMedia(_accountId, event);
    this.emitSyncEvent(_accountId, "messages.upsert", event);

    if (!this.inboundHandler) {
      return;
    }

    for (const message of event.messages) {
      if (
        message.key.fromMe ||
        message.key.remoteJid === "status@broadcast" ||
        message.key.remoteJid?.endsWith("@g.us")
      ) {
        continue;
      }

      const normalized = normalizeBaileysMessage(_accountId, message);
      if (!normalized) {
        continue;
      }

      await this.inboundHandler(normalized);
    }
  }

  private registerSyncEventHandlers(runtime: BaileysAccountRuntime) {
    const events: WhatsAppSyncEventType[] = [
      "messaging-history.set",
      "messaging-history.status",
      "chats.upsert",
      "chats.update",
      "chats.delete",
      "contacts.upsert",
      "contacts.update",
      "messages.delete",
      "messages.media-update",
      "messages.reaction",
      "messages.update",
      "message-receipt.update",
      "groups.upsert",
      "groups.update",
      "group-participants.update",
      "lid-mapping.update",
    ];
    const eventSource = runtime.socket?.ev as unknown as {
      on: (eventName: string, handler: (payload: unknown) => void) => void;
    } | undefined;

    for (const eventName of events) {
      eventSource?.on(eventName, (payload) => {
        this.emitSyncEvent(runtime.accountId, eventName, payload);
      });
    }
  }

  private emitSyncEvent(accountId: string, eventType: WhatsAppSyncEventType, payload: unknown) {
    this.syncHandler?.({
      accountId,
      eventType,
      payload,
      receivedAt: new Date().toISOString(),
    });
  }

  private async downloadMessageMedia(accountId: string, event: BaileysEventMap["messages.upsert"]) {
    const runtime = this.accounts.get(accountId);
    if (!this.mediaDir || !runtime?.socket) {
      return;
    }

    for (const message of event.messages) {
      const media = findMediaContent(message.message);
      if (!media || typeof media.content !== "object" || media.content === null) {
        continue;
      }

      const mediaContent = media.content as Record<string, unknown>;
      try {
        const buffer = await downloadMediaMessage(
          message,
          "buffer",
          {},
          {
            logger: pino({ level: "silent" }),
            reuploadRequest: runtime.socket.updateMediaMessage,
          },
        );
        const fileHash = createHash("sha256").update(buffer).digest("hex");
        const localPath = await this.writeMediaFile({
          accountId,
          chatJid: message.key.remoteJid ?? "unknown-chat",
          messageId: message.key.id ?? fileHash,
          mediaType: media.mediaType,
          ...(typeof mediaContent.mimetype === "string" ? { mimetype: mediaContent.mimetype } : {}),
          buffer,
        });

        mediaContent.localPath = localPath;
        mediaContent.localSha256 = fileHash;
        mediaContent.localSize = buffer.length;
      } catch (error) {
        mediaContent.localDownloadError = error instanceof Error ? error.message : "Media download failed.";
      }
    }
  }

  private async writeMediaFile(input: {
    accountId: string;
    chatJid: string;
    messageId: string;
    mediaType: WhatsAppMediaAttachment["type"];
    mimetype?: string;
    buffer: Buffer;
  }) {
    const accountDir = path.join(this.mediaDir!, sanitizePathSegment(input.accountId));
    await mkdir(accountDir, { recursive: true });
    const extension = mediaExtension(input.mediaType, input.mimetype);
    const fileName = [
      new Date().toISOString().replace(/[:.]/g, "-"),
      sanitizePathSegment(input.chatJid),
      sanitizePathSegment(input.messageId),
      input.mediaType,
    ].join("-");
    const localPath = path.join(accountDir, `${fileName}.${extension}`);
    await writeFile(localPath, input.buffer);
    return localPath;
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

  private getAccountPath(accountId: string) {
    return path.join(this.stateDir, sanitizePathSegment(accountId));
  }

  private renameRuntimeAccount(runtime: BaileysAccountRuntime, nextAccountId: string) {
    const previousAccountId = runtime.accountId;

    this.accounts.delete(previousAccountId);
    runtime.accountId = nextAccountId;
    this.accounts.set(nextAccountId, runtime);
  }

  private async initializePersistedAccounts() {
    await mkdir(this.stateDir, { recursive: true });
    const entries = await readdir(this.stateDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      let accountId = entry.name;
      let transient = accountId.startsWith("pending-");
      if (transient) {
        const pendingPath = this.getAccountPath(accountId);
        if (!(await hasPersistedAuthState(pendingPath))) {
          await rm(pendingPath, { recursive: true, force: true });
          continue;
        }

        accountId = await normalizePendingAccountDirectory({
          currentAccountId: accountId,
          currentPath: pendingPath,
          getAccountPath: (nextAccountId) => this.getAccountPath(nextAccountId),
        });
        transient = accountId.startsWith("pending-");
      }

      if (this.accounts.has(accountId)) {
        continue;
      }

      await this.initializeAccountRuntime(accountId, transient).catch((error: unknown) => {
        this.accounts.set(accountId, {
          accountId,
          statePath: this.getAccountPath(accountId),
          transient,
          reconnecting: false,
          disconnecting: false,
          status: {
            accountId,
            status: "disconnected",
            disconnectedAt: new Date().toISOString(),
            lastError: error instanceof Error ? error.message : "Persisted WhatsApp account initialization failed.",
          },
        });
      });
    }
  }
}

async function hasPersistedAuthState(accountPath: string) {
  const entries = await readdir(accountPath).catch(() => []);
  return entries.some((entry) => entry.endsWith(".json"));
}

async function normalizePendingAccountDirectory(options: {
  currentAccountId: string;
  currentPath: string;
  getAccountPath: (accountId: string) => string;
}) {
  const linkedAccountId = await readLinkedAccountIdFromCreds(options.currentPath);
  if (!linkedAccountId || linkedAccountId === options.currentAccountId) {
    return options.currentAccountId;
  }

  const nextAccountId = sanitizePathSegment(linkedAccountId);
  if (!nextAccountId || nextAccountId.startsWith("pending-")) {
    return options.currentAccountId;
  }

  const nextPath = options.getAccountPath(nextAccountId);
  const destinationExists = await hasPersistedAuthState(nextPath);
  if (destinationExists) {
    return options.currentAccountId;
  }

  await rename(options.currentPath, nextPath).catch(() => undefined);
  const moved = await hasPersistedAuthState(nextPath);
  return moved ? nextAccountId : options.currentAccountId;
}

async function readLinkedAccountIdFromCreds(accountPath: string) {
  const rawCreds = await readFile(path.join(accountPath, "creds.json"), "utf8").catch(() => "");
  if (!rawCreds) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCreds) as { me?: { id?: unknown } };
    return typeof parsed.me?.id === "string" ? getBareWhatsAppUserId(parsed.me.id) : null;
  } catch {
    return null;
  }
}

function normalizeBaileysMessage(accountId: string, message: WAMessage): WhatsAppMessageEvent | null {
  const chatJid = message.key.remoteJid;
  const remoteJidAlt = readMessageKeyString(message.key, "remoteJidAlt");
  const participantAlt = readMessageKeyString(message.key, "participantAlt");
  const text = extractText(message.message ?? undefined);
  const media = extractMedia(message.message ?? undefined);
  const reaction = extractReaction(message.message ?? undefined);

  if (!chatJid || !message.key.id || (!text && media.length === 0 && !reaction)) {
    return null;
  }

  const chatType = getWhatsAppChatType(chatJid);
  const participantJid = message.key.participant ?? undefined;
  const alternateJids = [remoteJidAlt, participantAlt].filter((value): value is string => Boolean(value));
  const sessionKey = getWhatsAppSessionKey({
    accountId,
    chatJid,
    chatType,
  });

  return {
    accountId,
    chatJid,
    chatType,
    senderJid: participantJid ?? chatJid,
    ...(alternateJids.length > 0 ? { alternateJids } : {}),
    ...(participantJid ? { participantJid } : {}),
    sessionKey,
    chatId: chatJid,
    messageId: message.key.id,
    senderId: participantJid ?? chatJid,
    text,
    ...(media.length > 0 ? { media } : {}),
    ...(reaction ? { reaction } : {}),
    timestamp: normalizeTimestamp(message.messageTimestamp),
  };
}

function readMessageKeyString(key: WAMessage["key"], property: string) {
  const value = (key as unknown as Record<string, unknown>)[property];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function extractMedia(message: WAMessageContent | null | undefined): WhatsAppMediaAttachment[] {
  if (!message) {
    return [];
  }

  if (message.imageMessage) {
    return [
      {
        type: "image",
        ...(message.imageMessage.mimetype ? { mimetype: message.imageMessage.mimetype } : {}),
        ...(message.imageMessage.caption ? { caption: message.imageMessage.caption } : {}),
      },
    ];
  }

  if (message.videoMessage) {
    return [
      {
        type: "video",
        ...(message.videoMessage.mimetype ? { mimetype: message.videoMessage.mimetype } : {}),
        ...(message.videoMessage.caption ? { caption: message.videoMessage.caption } : {}),
      },
    ];
  }

  if (message.audioMessage) {
    return [
      {
        type: "audio",
        ...(message.audioMessage.mimetype ? { mimetype: message.audioMessage.mimetype } : {}),
      },
    ];
  }

  if (message.documentMessage) {
    return [
      {
        type: "document",
        ...(message.documentMessage.mimetype ? { mimetype: message.documentMessage.mimetype } : {}),
        ...(message.documentMessage.fileName ? { fileName: message.documentMessage.fileName } : {}),
        ...(message.documentMessage.caption ? { caption: message.documentMessage.caption } : {}),
      },
    ];
  }

  return (
    extractMedia(message.ephemeralMessage?.message) ??
    extractMedia(message.viewOnceMessage?.message) ??
    extractMedia(message.viewOnceMessageV2?.message) ??
    extractMedia(message.documentWithCaptionMessage?.message) ??
    []
  );
}

function extractReaction(message: WAMessageContent | null | undefined): WhatsAppMessageEvent["reaction"] | undefined {
  const reaction = message?.reactionMessage;
  if (!reaction?.text || !reaction.key?.id) {
    return undefined;
  }

  return {
    emoji: reaction.text,
    targetMessageId: reaction.key.id,
  };
}

function splitWhatsAppText(text: string, maxLength = 3500): string[] {
  if (!text.trim()) {
    return [];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }

  return chunks;
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

function findMediaContent(content: WAMessageContent | null | undefined): { mediaType: WhatsAppMediaAttachment["type"]; content: unknown } | null {
  if (!content || typeof content !== "object") {
    return null;
  }

  const record = content as Record<string, unknown>;
  const directEntries: Array<[WhatsAppMediaAttachment["type"], string]> = [
    ["image", "imageMessage"],
    ["video", "videoMessage"],
    ["audio", "audioMessage"],
    ["document", "documentMessage"],
  ];
  for (const [mediaType, key] of directEntries) {
    const value = record[key];
    if (value && typeof value === "object") {
      return { mediaType, content: value };
    }
  }

  const nestedEntries = [
    record.ephemeralMessage,
    record.viewOnceMessage,
    record.viewOnceMessageV2,
    record.documentWithCaptionMessage,
  ];
  for (const entry of nestedEntries) {
    const nestedRecord = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const match = findMediaContent(nestedRecord.message as WAMessageContent | null | undefined);
    if (match) {
      return match;
    }
  }

  return null;
}

function mediaExtension(mediaType: WhatsAppMediaAttachment["type"], mimetype: string | undefined) {
  if (mimetype) {
    const subtype = mimetype.split("/")[1]?.split(";")[0]?.trim();
    if (subtype && /^[a-z0-9.+-]+$/i.test(subtype)) {
      return subtype.replace("jpeg", "jpg");
    }
  }

  return mediaType === "audio" ? "ogg" : mediaType === "document" ? "bin" : mediaType;
}

function createPendingAccountId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getLinkedAccountId(socket?: WASocket): string | null {
  const userId = socket?.user?.id;
  if (!userId) {
    return null;
  }

  return getBareWhatsAppUserId(userId);
}

function getBareWhatsAppUserId(userId: string): string | null {
  const bareId = userId.split("@")[0]?.split(":")[0]?.trim();
  return bareId || null;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "unknown";
}
