import { normalizeMexicanPhone } from "../../shared/normalize";

type ReplayLookupResult =
  | { status: "miss" }
  | { status: "hit"; result: unknown }
  | { status: "mismatch" };

type ReplayScope = {
  actorKey: string | null;
  actorRole: string | null;
  kitchenId: string | null;
};

export async function findCachedResult(
  deps: any,
  input: { actor?: any; kitchenId?: string | null; messageId?: string | null },
  handlerName: string
): Promise<ReplayLookupResult> {
  if (!input.messageId) {
    return { status: "miss" };
  }

  const record = await deps.processedEvents.findByMessageId({
    kitchenId: input.kitchenId ?? null,
    messageId: input.messageId,
    handlerName
  });

  return unwrapReplayResult(record?.result, buildReplayScope(input));
}

export async function cacheResult(
  deps: any,
  input: { actor?: any; kitchenId?: string | null; messageId?: string | null },
  handlerName: string,
  result: unknown
) {
  if (!input.messageId) {
    return;
  }

  await deps.processedEvents.create({
    kitchenId: input.kitchenId ?? null,
    messageId: input.messageId,
    handlerName,
    result: wrapReplayResult(result, buildReplayScope(input))
  });
}

export function findContextProcessedEvent(
  input: { actor?: any; kitchenId?: string | null; messageId?: string | null },
  context: { processedEvents?: Array<{ messageId: string; result: unknown }> },
  handlerName: string
): ReplayLookupResult {
  const record = context.processedEvents?.find((event) => event.messageId === input.messageId);

  if (!record) {
    return { status: "miss" };
  }

  return unwrapReplayResult(record.result, buildReplayScope(input), true);
}

export async function runInWriteTransaction<T>(
  deps: any,
  work: (transactionDeps: any) => Promise<T>
): Promise<T> {
  if (typeof deps.withTransaction === "function") {
    return deps.withTransaction(work);
  }

  return work(deps);
}

export async function writeAuditEvent(deps: any, auditEvent: any) {
  if (!auditEvent) {
    return;
  }

  const eventType = String(auditEvent.type ?? "event").toUpperCase();
  const actorId = auditEvent.actorId ?? null;
  const entityId = auditEvent.orderId ?? auditEvent.kitchenId ?? null;
  const entityType = auditEvent.orderId ? "order" : "kitchen";

  await deps.activityLogs.create({
    kitchenId: auditEvent.kitchenId ?? null,
    userId: actorId,
    entityType,
    entityId,
    eventType,
    description: String(auditEvent.type),
    metadata: auditEvent
  });
}

function wrapReplayResult(result: unknown, scope: ReplayScope) {
  return {
    __replayScopeVersion: 1,
    __replayScope: scope,
    __replayResult: result
  };
}

function unwrapReplayResult(
  value: unknown,
  expectedScope: ReplayScope,
  allowLegacyResult = false
): ReplayLookupResult {
  if (!value) {
    return { status: "miss" };
  }

  if (isReplayEnvelope(value)) {
    return replayScopesMatch(value.__replayScope, expectedScope)
      ? { status: "hit", result: value.__replayResult }
      : { status: "mismatch" };
  }

  return allowLegacyResult
    ? { status: "hit", result: value }
    : { status: "mismatch" };
}

function isReplayEnvelope(
  value: unknown
): value is {
  __replayScopeVersion: number;
  __replayScope: ReplayScope;
  __replayResult: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (
    (value as Record<string, unknown>).__replayScopeVersion === 1 &&
    "__replayScope" in (value as Record<string, unknown>) &&
    "__replayResult" in (value as Record<string, unknown>)
  );
}

function buildReplayScope(input: { actor?: any; kitchenId?: string | null }): ReplayScope {
  const actor = input.actor;

  return {
    actorKey: resolveActorKey(actor),
    actorRole: resolveActorRole(actor),
    kitchenId: normalizeOptionalString(input.kitchenId ?? actor?.kitchenId ?? null)
  };
}

function resolveActorKey(actor: any) {
  if (actor?.platformAccess && typeof actor.id === "string" && actor.id.trim() !== "") {
    return `platform:${actor.id.trim()}`;
  }

  switch (actor?.role) {
    case "CLIENT":
      return typeof actor.phone === "string" && actor.phone.trim() !== ""
        ? `client:${normalizeMexicanPhone(actor.phone)}`
        : null;
    case "KITCHEN":
      return typeof actor.contactId === "string" && actor.contactId.trim() !== ""
        ? `kitchen:${actor.contactId.trim()}`
        : null;
    case "DELIVERER":
      return typeof actor.id === "string" && actor.id.trim() !== ""
        ? `deliverer:${actor.id.trim()}`
        : null;
    default:
      return typeof actor?.id === "string" && actor.id.trim() !== ""
        ? `actor:${actor.id.trim()}`
        : null;
  }
}

function resolveActorRole(actor: any) {
  if (actor?.platformAccess && typeof actor.id === "string" && actor.id.trim() !== "") {
    return "PLATFORM_SUPPORT";
  }

  return normalizeOptionalString(actor?.role ?? null);
}

function replayScopesMatch(left: ReplayScope, right: ReplayScope) {
  return (
    left.actorKey === right.actorKey &&
    left.actorRole === right.actorRole &&
    left.kitchenId === right.kitchenId
  );
}

function normalizeOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}
