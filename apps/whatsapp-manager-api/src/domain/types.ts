export type WhatsAppChatId = string;
export type HermesSessionId = string;
export type WhatsAppChatType = "direct" | "group";
export type WhatsAppGroupRoutingPolicy = "group" | "participant";
export type DeliveryStatus = "pending" | "sent" | "failed";
export type DeliveryFailureStage = "hermes" | "whatsapp";
export type MediaType = "image" | "video" | "audio" | "document";
export type NumberRuleAction = "allow" | "deny";
export type NumberRuleMatchType = "all" | "exact" | "regex";
export type AuditLogOutcome = "success" | "failure";

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
  status: "disconnected" | "connecting" | "connected";
  connectedAt?: string;
  disconnectedAt?: string;
  qrCode?: string;
  lastError?: string;
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
