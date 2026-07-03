export type WhatsAppChatId = string;
export type HermesSessionId = string;
export type WhatsAppChatType = "direct" | "group";
export type WhatsAppGroupRoutingPolicy = "group" | "participant";
export type DeliveryStatus = "pending" | "sent" | "failed" | "ignored";
export type DeliveryFailureStage = "hermes" | "whatsapp";
export type MediaType = "image" | "video" | "audio" | "document";
export type NumberRuleAction = "allow" | "deny";
export type NumberRuleMatchType = "all" | "exact" | "regex";
export type AuditLogOutcome = "success" | "failure" | "ignored";
export type WhatsAppSyncEventType =
  | "messaging-history.set"
  | "messaging-history.status"
  | "chats.upsert"
  | "chats.update"
  | "chats.delete"
  | "contacts.upsert"
  | "contacts.update"
  | "messages.delete"
  | "messages.media-update"
  | "messages.reaction"
  | "messages.upsert"
  | "messages.update"
  | "message-receipt.update"
  | "groups.upsert"
  | "groups.update"
  | "group-participants.update"
  | "lid-mapping.update";

export interface WhatsAppMediaAttachment {
  type: MediaType;
  url?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
}

export interface WhatsAppReaction {
  emoji: string;
  targetMessageId: string;
}

export interface WhatsAppMessageEvent {
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  senderJid: string;
  sessionKey: string;
  messageId: string;
  participantJid?: string;
  chatId: WhatsAppChatId;
  senderId: string;
  text: string;
  media?: WhatsAppMediaAttachment[];
  reaction?: WhatsAppReaction;
  timestamp: string;
}

export interface HermesSession {
  id: HermesSessionId;
  sessionKey: string;
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  chatId: WhatsAppChatId;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "reset";
}

export interface ChatSessionMapping {
  sessionKey: string;
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  chatId: WhatsAppChatId;
  hermesSessionId: HermesSessionId;
  createdAt: string;
  updatedAt: string;
}

export interface HermesReply {
  sessionId: HermesSessionId;
  outputText: string;
}

export interface OutboundWhatsAppMessage {
  chatJid?: WhatsAppChatId;
  chatId: WhatsAppChatId;
  text: string;
  accountId?: string;
  media?: WhatsAppMediaAttachment[];
  reaction?: WhatsAppReaction;
}

export interface WhatsAppAccountStatus {
  accountId: string;
  alias?: string;
  status: "disconnected" | "connecting" | "connected";
  connectedAt?: string;
  disconnectedAt?: string;
  qrCode?: string;
  lastError?: string;
}

export interface WhatsAppAccountMetadata {
  accountId: string;
  alias?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagerChatMetadata {
  accountId: string;
  chatJid: WhatsAppChatId;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InboundMessageResult {
  duplicate: boolean;
  mapping?: ChatSessionMapping;
  reply?: HermesReply;
  session?: HermesSession;
  event?: WhatsAppMessageEvent;
}

export interface DeliveryRecord {
  id: string;
  accountId: string;
  chatJid: WhatsAppChatId;
  chatType: WhatsAppChatType;
  sessionKey: string;
  inboundMessageId: string;
  inboundText?: string;
  outboundText: string;
  status: DeliveryStatus;
  attempts: number;
  failureStage?: DeliveryFailureStage;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupRoutingPolicyRecord {
  accountId: string;
  groupJid: string;
  policy: WhatsAppGroupRoutingPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface NumberRuleRecord {
  id: string;
  accountId: string;
  action: NumberRuleAction;
  matchType: NumberRuleMatchType;
  pattern: string;
  label?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NumberRuleInput {
  accountId: string;
  action: NumberRuleAction;
  matchType: NumberRuleMatchType;
  pattern?: string;
  label?: string;
  enabled?: boolean;
}

export interface AuditLogRecord {
  id: string;
  action: string;
  actor: string;
  outcome: AuditLogOutcome;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogInput {
  action: string;
  actor?: string;
  outcome?: AuditLogOutcome;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}

export interface WhatsAppContactRecord {
  accountId: string;
  contactJid: string;
  phoneNumber?: string;
  lidJid?: string;
  name?: string;
  notifyName?: string;
  verifiedName?: string;
  rawJson?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WhatsAppChatRecord {
  accountId: string;
  chatJid: string;
  chatType: WhatsAppChatType;
  displayName?: string;
  unreadCount?: number;
  lastMessageAt?: string;
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: string;
  rawJson?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WhatsAppStoredMessageRecord {
  accountId: string;
  chatJid: string;
  messageId: string;
  senderJid?: string;
  fromMe: boolean;
  timestamp: string;
  messageType?: string;
  text?: string;
  mediaJson?: string;
  reactionJson?: string;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppMessageCountRecord {
  accountId: string;
  chatJid: string;
  messageCount: number;
}

export interface WhatsAppMessageReceiptRecord {
  id: string;
  accountId: string;
  chatJid: string;
  messageId: string;
  participantJid?: string;
  receiptType?: string;
  timestamp?: string;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppMessageUpdateRecord {
  id: string;
  accountId: string;
  chatJid?: string;
  messageId?: string;
  updateType: string;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppMediaAssetRecord {
  id: string;
  accountId: string;
  chatJid: string;
  messageId: string;
  mediaType: MediaType;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  url?: string;
  directPath?: string;
  localPath?: string;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppLidMappingRecord {
  accountId: string;
  lidJid: string;
  pnJid: string;
  source: string;
  rawJson?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WhatsAppHistorySyncBatchRecord {
  id: string;
  accountId: string;
  syncType?: string;
  chatCount: number;
  contactCount: number;
  messageCount: number;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppSyncEventRecord {
  id: string;
  accountId: string;
  eventType: WhatsAppSyncEventType;
  payloadHash: string;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppSyncSummary {
  contacts: number;
  chats: number;
  messages: number;
  messageReceipts: number;
  messageUpdates: number;
  mediaAssets: number;
  lidMappings: number;
  historySyncBatches: number;
  syncEvents: number;
}

export interface WhatsAppSyncSnapshot {
  contacts: WhatsAppContactRecord[];
  chats: WhatsAppChatRecord[];
  messages: WhatsAppStoredMessageRecord[];
  messageReceipts: WhatsAppMessageReceiptRecord[];
  messageUpdates: WhatsAppMessageUpdateRecord[];
  mediaAssets: WhatsAppMediaAssetRecord[];
  lidMappings: WhatsAppLidMappingRecord[];
  historySyncBatches: WhatsAppHistorySyncBatchRecord[];
  syncEvents: WhatsAppSyncEventRecord[];
}

export function getWhatsAppChatType(chatJid: string): WhatsAppChatType {
  return chatJid.endsWith("@g.us") ? "group" : "direct";
}

export function getWhatsAppSessionKey(input: {
  accountId: string;
  chatJid: string;
  chatType?: WhatsAppChatType;
  participantJid?: string;
  groupPolicy?: WhatsAppGroupRoutingPolicy;
}) {
  const chatType = input.chatType ?? getWhatsAppChatType(input.chatJid);
  if (chatType === "group" && input.groupPolicy === "participant" && input.participantJid) {
    return `whatsapp:${input.accountId}:group:${input.chatJid}:user:${input.participantJid}`;
  }

  return `whatsapp:${input.accountId}:${chatType}:${input.chatJid}`;
}
