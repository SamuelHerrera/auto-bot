import { randomUUID } from "node:crypto";
import { serializeResult } from "../../shared/serialize";
import type {
  HermesConversationState,
  HermesRuntimeContext,
  HermesTransportInput
} from "./types";

export interface HermesConversationStore {
  get(conversationId: string): Promise<HermesConversationState | null> | HermesConversationState | null;
  set(state: HermesConversationState, conversationKey?: string): Promise<void> | void;
}

export class InMemoryHermesConversationStore implements HermesConversationStore {
  private readonly store = new Map<string, HermesConversationState>();

  get(conversationId: string) {
    return this.store.get(conversationId) ?? null;
  }

  set(state: HermesConversationState, conversationKey = state.conversationId) {
    this.store.set(conversationKey, serializeResult(state) as HermesConversationState);
  }
}

export function createInMemoryHermesConversationStore() {
  return new InMemoryHermesConversationStore();
}

export function resolveConversationId(input: HermesTransportInput) {
  const explicitId = typeof input.conversationId === "string" ? input.conversationId.trim() : "";
  if (explicitId) {
    return explicitId;
  }

  const phone = firstNonEmptyString(input.message.phone);
  const kitchenId = firstNonEmptyString(input.message.kitchenId);
  if (phone) {
    return kitchenId ? `phone:${phone}:kitchen:${kitchenId}` : `phone:${phone}`;
  }

  const orderId = firstNonEmptyString(input.message.orderId);
  if (orderId) {
    return kitchenId ? `order:${orderId}:kitchen:${kitchenId}` : `order:${orderId}`;
  }

  if (kitchenId) {
    return `kitchen:${kitchenId}`;
  }

  const messageId = firstNonEmptyString(input.message.id);
  if (messageId) {
    return `message:${messageId}`;
  }

  return `conversation:${randomUUID()}`;
}

export function resolveConversationScopeKey(
  input: HermesTransportInput,
  conversationId = resolveConversationId(input)
) {
  const kitchenId = firstNonEmptyString(input.message.kitchenId);

  if (!kitchenId || conversationId.includes(":kitchen:")) {
    return conversationId;
  }

  return `${conversationId}::kitchen:${kitchenId}`;
}

export function mergeRuntimeContexts(
  stored: HermesRuntimeContext | null,
  incoming?: HermesRuntimeContext,
  message?: HermesTransportInput["message"]
): HermesRuntimeContext {
  const phone = pickScopedValue(message?.phone, stored?.phone, incoming?.phone);
  const kitchenId = pickScopedValue(stored?.kitchenId, message?.kitchenId, incoming?.kitchenId);
  const orderId = pickScopedValue(stored?.orderId, message?.orderId, incoming?.orderId);
  const actorRole = pickScopedValue(stored?.actorRole, message?.actorRole, incoming?.actorRole);
  const metadata = pickFirstDefinedValue(stored?.metadata, incoming?.metadata, message?.metadata);

  return serializeResult({
    ...(phone !== undefined ? { phone } : {}),
    ...(kitchenId !== undefined ? { kitchenId } : {}),
    ...(orderId !== undefined ? { orderId } : {}),
    ...(actorRole !== undefined ? { actorRole } : {}),
    ...(metadata !== undefined ? { metadata } : {})
  }) as HermesRuntimeContext;
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized !== "") {
      return normalized;
    }
  }

  return null;
}

function pickFirstDefinedValue(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function pickScopedValue(
  storedValue: unknown,
  messageValue: unknown,
  incomingValue: unknown
) {
  if (storedValue !== undefined && storedValue !== null && storedValue !== "") {
    return storedValue;
  }

  return pickFirstDefinedValue(messageValue, incomingValue);
}
