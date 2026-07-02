import type {
  OutboundWhatsAppMessage,
  WhatsAppAccountStatus,
  WhatsAppMessageEvent,
} from "../domain/types.js";

export interface WhatsAppGateway {
  onInboundMessage(handler: (event: WhatsAppMessageEvent) => Promise<void>): void;
  onStatusChange?(handler: (status: WhatsAppAccountStatus) => void): void;
  getStatus(): Promise<WhatsAppAccountStatus>;
  listAccounts(): Promise<WhatsAppAccountStatus[]>;
  initializeAccount(accountId?: string): Promise<WhatsAppAccountStatus>;
  disconnectAccount(accountId: string): Promise<WhatsAppAccountStatus>;
  sendMessage(message: OutboundWhatsAppMessage): Promise<void>;
  normalizeInboundEvent(payload: unknown): Promise<WhatsAppMessageEvent>;
}
