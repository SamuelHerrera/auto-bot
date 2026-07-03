import type {
  OutboundWhatsAppMessage,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
  WhatsAppSyncEventType,
} from "../domain/types.js";

export interface WhatsAppSyncEvent {
  accountId: string;
  eventType: WhatsAppSyncEventType;
  payload: unknown;
  receivedAt: string;
}

export interface WhatsAppGateway {
  onInboundMessage(handler: (event: WhatsAppMessageEvent) => Promise<void>): void;
  onStatusChange?(handler: (status: WhatsAppAccountStatus) => void): void;
  onSyncEvent?(handler: (event: WhatsAppSyncEvent) => void): void;
  getStatus(): Promise<WhatsAppAccountStatus>;
  listAccounts(): Promise<WhatsAppAccountStatus[]>;
  initializeAccount(accountId?: string): Promise<WhatsAppAccountStatus>;
  disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus>;
  sendMessage(message: OutboundWhatsAppMessage): Promise<void>;
  normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent>;
}
