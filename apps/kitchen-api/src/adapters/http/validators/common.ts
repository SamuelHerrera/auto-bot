import type { Request } from "express";
import { createError } from "../../../shared/errors";
import type { RequestActor } from "../middleware/resolve-actor";
import { config } from "../../../infrastructure/config";

export function getRequestActor(request: Request): RequestActor {
  const actor = (request as Request & { actor?: RequestActor }).actor;

  if (!actor) {
    throw createError(403, "action_not_allowed");
  }

  return actor;
}

export function assertKitchenScope(actor: { kitchenId?: string }, kitchenId: string) {
  if (!actor.kitchenId || actor.kitchenId !== kitchenId) {
    throw createError(403, "action_not_allowed");
  }
}

export function assertTrustedKitchenActor(actor: { role?: string; kitchenId?: string; contactId?: string }, kitchenId: string) {
  assertRole(actor, ["KITCHEN"]);
  assertKitchenScope(actor, kitchenId);

  if (!actor.contactId) {
    throw createError(403, "action_not_allowed");
  }
}

export function assertActorKitchenId(actor: { kitchenId?: string }) {
  if (!actor.kitchenId) {
    throw createError(403, "action_not_allowed");
  }
}

export function assertPlatformAccess(actor: { platformAccess?: boolean }) {
  if (!actor.platformAccess || !("id" in actor) || typeof (actor as { id?: string }).id !== "string") {
    throw createError(403, "action_not_allowed");
  }
}

export function assertTrustedInternalRequest(request: Request) {
  const expectedApiKey = config.hermes.kitcheniaApiKey.trim();

  if (!expectedApiKey) {
    throw createError(403, "action_not_allowed");
  }

  const authHeaderValue = request.get(config.hermes.kitcheniaAuthHeader);

  if (!authHeaderValue) {
    throw createError(403, "action_not_allowed");
  }

  const expectedValue = `${config.hermes.kitcheniaAuthScheme} ${expectedApiKey}`.trim();

  if (authHeaderValue.trim() !== expectedValue) {
    throw createError(403, "action_not_allowed");
  }
}

export function buildPlatformSupportActor(request: Request): RequestActor {
  const actor = (request as Request & { actor?: RequestActor }).actor;

  if (actor?.platformAccess) {
    return {
      id: actor.id ?? "hermes_local_platform_support",
      platformAccess: true
    };
  }

  assertTrustedInternalRequest(request);

  const expectedApiKey = config.platformSupport.apiKey.trim();
  const submittedApiKey = request.get(config.platformSupport.authHeader)?.trim() ?? "";

  if (!expectedApiKey || submittedApiKey !== expectedApiKey) {
    throw createError(403, "action_not_allowed");
  }

  return {
    id: "platform_support_service",
    platformAccess: true
  };
}

export function assertTrustedDelivererActor(actor: { role?: string; id?: string; kitchenId?: string }, kitchenId?: string) {
  assertRole(actor, ["DELIVERER"]);
  assertActorId(actor);
  assertActorKitchenId(actor);

  if (kitchenId) {
    assertKitchenScope(actor, kitchenId);
  }
}

export function assertNoTrustedActorClaims(actor: RequestActor) {
  if (Object.keys(actor).length > 0) {
    throw createError(403, "action_not_allowed");
  }
}

export function assertRole(actor: { role?: string }, allowedRoles: string[]) {
  if (!actor.role || !allowedRoles.includes(actor.role)) {
    throw createError(403, "action_not_allowed");
  }
}

export function assertActorPhone(actor: { phone?: string }) {
  if (!actor.phone) {
    throw createError(403, "action_not_allowed");
  }
}

export function assertActorId(actor: { id?: string }) {
  if (!actor.id) {
    throw createError(403, "action_not_allowed");
  }
}
