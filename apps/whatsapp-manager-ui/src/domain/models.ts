export type AccountStatus = "disconnected" | "connecting" | "connected";
export type NumberSubview = "home" | "messages" | "rules" | "failures";
export type NumberRuleAction = "allow" | "deny";
export type NumberRuleMatchType = "all" | "exact" | "regex";
export type RefreshScope = "accounts" | "activity" | "rules" | "logs";
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
  sessionKey?: string;
  hermesSessionId?: string;
  createdAt?: string;
  updatedAt: string;
  deliveryCount: number;
  failedCount: number;
  messageCount: number;
  lastText?: string;
}

export interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  status: DeliveryRecord["status"];
  timestamp: string;
  record: DeliveryRecord;
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
