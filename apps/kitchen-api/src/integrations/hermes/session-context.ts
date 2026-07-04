import type { HermesBackendRole } from "./types";

export const HERMES_SESSION_CONTEXT_HEADER = "x-hermes-session-context";
export const HERMES_BRIDGE_TRUSTED_SOURCE_HEADER = "x-hermes-bridge-source";
export const HERMES_BRIDGE_TRUSTED_SOURCE_VALUE = "whatsapp-manager";

export type HermesSessionContext = {
  conversationId: string;
  senderId?: string;
  phone?: string;
  kitchenId?: string;
  orderId?: string;
  actorRole?: HermesBackendRole;
  metadata?: Record<string, unknown>;
};

export function normalizeHermesSessionContext(value: unknown): HermesSessionContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const conversationId = normalizeRequiredString(record.conversationId);

  if (!conversationId) {
    return null;
  }

  const actorRole = normalizeActorRole(record.actorRole);

  return {
    conversationId,
    ...(normalizeOptionalString(record.senderId) ? { senderId: normalizeOptionalString(record.senderId)! } : {}),
    ...(normalizeOptionalString(record.phone) ? { phone: normalizeOptionalString(record.phone)! } : {}),
    ...(normalizeOptionalString(record.kitchenId) ? { kitchenId: normalizeOptionalString(record.kitchenId)! } : {}),
    ...(normalizeOptionalString(record.orderId) ? { orderId: normalizeOptionalString(record.orderId)! } : {}),
    ...(actorRole ? { actorRole } : {}),
    ...(isPlainObject(record.metadata) ? { metadata: record.metadata as Record<string, unknown> } : {})
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequiredString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeActorRole(value: unknown): HermesBackendRole | undefined {
  const role = typeof value === "string" ? value.trim().toUpperCase() : "";

  if (role === "CLIENT" || role === "KITCHEN" || role === "DELIVERER") {
    return role;
  }

  return undefined;
}
