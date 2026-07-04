import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../../infrastructure/prisma";
import { config } from "../../../infrastructure/config";
import { normalizeMexicanPhone } from "../../../shared/normalize";
import { createError } from "../../../shared/errors";
import {
  HERMES_SESSION_CONTEXT_HEADER,
  normalizeHermesSessionContext,
  type HermesSessionContext
} from "../../../integrations/hermes/session-context";
import {
  normalizeHermesLocalIdentity
} from "../../../integrations/hermes/local-identity";

export type RequestActor = {
  role?: string;
  id?: string;
  phone?: string;
  kitchenId?: string;
  platformAccess?: boolean;
  printerIdentifier?: string;
  contactId?: string;
};

const TRUSTED_CALLER_CONTEXT_HEADER = "x-caller-context";
const ALLOWED_ACTOR_FIELDS = new Set([
  "role",
  "id",
  "phone",
  "kitchenId",
  "platformAccess",
  "printerIdentifier",
  "contactId"
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalBigInt(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    throw createError(403, "action_not_allowed");
  }
}

function normalizeActor(value: unknown): RequestActor {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw createError(403, "action_not_allowed");
  }

  const unsupportedField = Object.keys(value).find((fieldName) => !ALLOWED_ACTOR_FIELDS.has(fieldName));

  if (unsupportedField) {
    throw createError(403, "action_not_allowed");
  }

  return {
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.phone === "string" ? { phone: value.phone } : {}),
    ...(typeof value.kitchenId === "string" ? { kitchenId: value.kitchenId } : {}),
    ...(typeof value.platformAccess === "boolean" ? { platformAccess: value.platformAccess } : {}),
    ...(typeof value.printerIdentifier === "string" ? { printerIdentifier: value.printerIdentifier } : {}),
    ...(typeof value.contactId === "string" ? { contactId: value.contactId } : {})
  };
}

function isTrustedInternalRequest(request: Request) {
  const expectedApiKey = config.hermes.kitcheniaApiKey.trim();

  if (!expectedApiKey) {
    return false;
  }

  const authHeaderValue = request.get(config.hermes.kitcheniaAuthHeader);

  if (!authHeaderValue) {
    return false;
  }

  const expectedValue = `${config.hermes.kitcheniaAuthScheme} ${expectedApiKey}`.trim();

  return authHeaderValue.trim() === expectedValue;
}

async function resolvePrivilegedUserActor(rawActor: RequestActor, expectedRole: "KITCHEN" | "DELIVERER"): Promise<RequestActor> {
  const claimedKitchenId = toOptionalBigInt(rawActor.kitchenId);
  const claimedUserId = toOptionalBigInt(rawActor.contactId ?? rawActor.id);
  let userRecord: { id: bigint; role: string; isActive: boolean; kitchenId: bigint | null } | null = null;
  let trustedPhone = rawActor.phone;

  if (claimedUserId) {
    userRecord = await prisma.user.findUnique({
      where: { id: claimedUserId },
      select: {
        id: true,
        role: true,
        isActive: true,
        kitchenId: true
      }
    });
  }

  if (!userRecord && rawActor.phone) {
    const linkedPhone = await prisma.linkedPhone.findFirst({
      where: {
        normalizedPhone: normalizeMexicanPhone(rawActor.phone),
        ...(claimedKitchenId ? { kitchenId: claimedKitchenId } : {}),
        user: {
          role: expectedRole
        }
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            isActive: true,
            kitchenId: true
          }
        }
      },
      orderBy: { id: "desc" }
    });

    userRecord = linkedPhone?.user ?? null;
    trustedPhone = linkedPhone?.phone ?? trustedPhone;
  }

  if (!userRecord || userRecord.role !== expectedRole || !userRecord.isActive || !userRecord.kitchenId) {
    throw createError(403, "action_not_allowed");
  }

  if (claimedKitchenId && userRecord.kitchenId !== claimedKitchenId) {
    throw createError(403, "action_not_allowed");
  }

  return {
    role: expectedRole,
    id: userRecord.id.toString(),
    kitchenId: userRecord.kitchenId.toString(),
    ...(trustedPhone ? { phone: trustedPhone } : {}),
    ...(expectedRole === "KITCHEN" ? { contactId: userRecord.id.toString() } : {})
  };
}

async function resolveTrustedActor(rawActor: RequestActor): Promise<RequestActor> {
  if (Object.keys(rawActor).length === 0) {
    return {};
  }

  if (rawActor.role === "CLIENT" && rawActor.phone) {
    return {
      role: "CLIENT",
      phone: normalizeMexicanPhone(rawActor.phone)
    };
  }

  if (rawActor.role === "KITCHEN") {
    return resolvePrivilegedUserActor(rawActor, "KITCHEN");
  }

  if (rawActor.role === "DELIVERER") {
    return resolvePrivilegedUserActor(rawActor, "DELIVERER");
  }

  if (rawActor.id) {
    return {
      id: rawActor.id
    };
  }

  throw createError(403, "action_not_allowed");
}

async function resolveLocalIdentityActor(request: Request): Promise<RequestActor | null> {
  if (!config.hermes.localIdentityEnabled) {
    return null;
  }

  const headerValue = request.get(config.hermes.localIdentityHeader);

  if (!headerValue) {
    return null;
  }

  const parsedIdentity = normalizeHermesLocalIdentity(JSON.parse(headerValue));

  if (!parsedIdentity) {
    throw createError(403, "action_not_allowed");
  }

  if (parsedIdentity.platformAccess || parsedIdentity.role === "PLATFORM_SUPPORT") {
    return {
      id: parsedIdentity.id ?? "hermes_local_platform_support",
      platformAccess: true
    };
  }

  return resolveTrustedActor(normalizeActor(parsedIdentity));
}

async function resolveSessionBackedActor(request: Request): Promise<RequestActor | null> {
  const headerValue = request.get(HERMES_SESSION_CONTEXT_HEADER);

  if (!headerValue) {
    return null;
  }

  const parsedContext = normalizeHermesSessionContext(JSON.parse(headerValue));

  if (!parsedContext) {
    throw createError(403, "action_not_allowed");
  }

  const persistedState = await prisma.whatsAppManagerConversationState.findUnique({
    where: {
      conversationId: parsedContext.conversationId
    }
  });

  if (!persistedState) {
    throw createError(403, "action_not_allowed");
  }

  assertSessionContextMatchesState(parsedContext, persistedState);

  return resolveTrustedActor({
    ...(persistedState.actorRole ? { role: persistedState.actorRole } : {}),
    ...(persistedState.phone ? { phone: persistedState.phone } : {}),
    ...(persistedState.kitchenId ? { kitchenId: persistedState.kitchenId } : {})
  });
}

function assertSessionContextMatchesState(
  submitted: HermesSessionContext,
  persisted: {
    conversationId: string;
    senderId: string | null;
    phone: string | null;
    kitchenId: string | null;
    orderId: string | null;
    actorRole: string | null;
  }
) {
  if (submitted.conversationId !== persisted.conversationId) {
    throw createError(403, "action_not_allowed");
  }

  if (submitted.senderId && submitted.senderId !== persisted.senderId) {
    throw createError(403, "action_not_allowed");
  }

  if (submitted.phone && submitted.phone !== persisted.phone) {
    throw createError(403, "action_not_allowed");
  }

  if (submitted.kitchenId && submitted.kitchenId !== persisted.kitchenId) {
    throw createError(403, "action_not_allowed");
  }

  if (submitted.orderId && submitted.orderId !== persisted.orderId) {
    throw createError(403, "action_not_allowed");
  }

  if (submitted.actorRole && submitted.actorRole !== persisted.actorRole) {
    throw createError(403, "action_not_allowed");
  }
}

export function resolveActor(request: Request, _response: Response, next: NextFunction) {
  void (async () => {
    const sessionActor = await resolveSessionBackedActor(request);

    if (sessionActor) {
      (request as Request & { actor?: RequestActor }).actor = sessionActor;
      next();
      return;
    }

    const localIdentityActor = await resolveLocalIdentityActor(request);

    if (localIdentityActor) {
      (request as Request & { actor?: RequestActor }).actor = localIdentityActor;
      next();
      return;
    }

    const headerValue = request.get(TRUSTED_CALLER_CONTEXT_HEADER);

    if (!headerValue) {
      (request as Request & { actor?: RequestActor }).actor = {};
      next();
      return;
    }

    if (!isTrustedInternalRequest(request)) {
      throw createError(403, "action_not_allowed");
    }

    const sourceActor = JSON.parse(headerValue);
    const actor = await resolveTrustedActor(normalizeActor(sourceActor));

    (request as Request & { actor?: RequestActor }).actor = actor;
    next();
  })().catch(() => {
    next(createError(403, "action_not_allowed"));
  });
}
