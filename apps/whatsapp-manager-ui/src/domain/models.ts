export type AccountStatus = "disconnected" | "connecting" | "connected";
export type NumberSubview = "home" | "messages" | "rules" | "failures";
export type NumberRuleAction = "allow" | "deny";
export type NumberRuleMatchType = "all" | "exact" | "regex";
export type RefreshScope = "accounts" | "directory" | "activity" | "chat" | "rules" | "logs";
export type AuditLogOutcome = "success" | "failure" | "ignored";
export type AuditLogFilter = "all" | AuditLogOutcome;

export interface WhatsAppAccount {
  accountId: string;
  alias?: string;
  status: AccountStatus;
  connectedAt?: string;
  disconnectedAt?: string;
  qrCode?: string;
  lastError?: string;
}

export interface ManagerChatMetadata {
  accountId: string;
  chatJid: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMapping {
  sessionKey: string;
  accountId: string;
  chatJid: string;
  chatType: "direct" | "group";
  chatId: string;
  hermesSessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRecord {
  id: string;
  accountId: string;
  chatJid: string;
  chatType: "direct" | "group";
  sessionKey: string;
  inboundMessageId: string;
  inboundText?: string;
  outboundText: string;
  status: "pending" | "sent" | "failed" | "ignored";
  attempts: number;
  failureStage?: "hermes" | "whatsapp";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppContact {
  accountId: string;
  contactJid: string;
  phoneNumber?: string;
  lidJid?: string;
  notifyName?: string;
  verifiedName?: string;
  pushName?: string;
  displayName?: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  rawPayload?: unknown;
}

export interface WhatsAppLidMapping {
  accountId: string;
  lidJid: string;
  pnJid: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  rawPayload?: unknown;
}

export interface WhatsAppSyncedChat {
  accountId: string;
  chatJid: string;
  chatType: "direct" | "group";
  displayName?: string;
  unreadCount?: number;
  archived?: boolean;
  muted?: boolean;
  pinned?: boolean;
  lastMessageAt?: string;
  rawPayload?: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WhatsAppSyncedMessage {
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

export interface WhatsAppMessageCount {
  accountId: string;
  chatJid: string;
  messageCount: number;
}

export interface WhatsAppMessageReceipt {
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

export interface WhatsAppMessageUpdate {
  id: string;
  accountId: string;
  chatJid?: string;
  messageId?: string;
  updateType: string;
  rawJson?: string;
  receivedAt: string;
}

export interface WhatsAppMediaAsset {
  id: string;
  accountId: string;
  chatJid: string;
  messageId: string;
  mediaType: "image" | "video" | "audio" | "document";
  mimetype?: string;
  fileName?: string;
  caption?: string;
  url?: string;
  directPath?: string;
  localPath?: string;
  rawJson?: string;
  receivedAt: string;
}

export interface NumberRule {
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

export interface ChatSummary {
  accountId: string;
  chatJid: string;
  displayName?: string;
  phoneNumber?: string;
  lidJid?: string;
  pnJid?: string;
  sessionKey?: string;
  hermesSessionId?: string;
  createdAt?: string;
  updatedAt: string;
  deliveryCount: number;
  failedCount: number;
  messageCount: number;
  unreadCount?: number;
  managerArchived: boolean;
  source: "routed" | "synced" | "mixed";
  lastText?: string;
}

export interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  kind: "message" | "event";
  status?: DeliveryRecord["status"];
  timestamp: string;
  source: "delivery" | "sync";
  messageType?: string;
  media?: WhatsAppMediaAsset[];
  receipts?: WhatsAppMessageReceipt[];
  updates?: WhatsAppMessageUpdate[];
  record?: DeliveryRecord | WhatsAppSyncedMessage;
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

export interface BrandingSettings {
  title: string;
  iconSrc: string;
}

export interface WorkspaceState {
  activeAccountId: string;
  activeTabId: string;
  isLogsTabOpen: boolean;
  isSettingsTabOpen: boolean;
  openAccountTabs: string[];
}
