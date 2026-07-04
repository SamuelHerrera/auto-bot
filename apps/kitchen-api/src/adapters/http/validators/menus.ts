import type { Request } from "express";
import { requireFields, rejectUnsupportedFields } from "../../../shared/validation";
import { assertRole, assertTrustedDelivererActor, assertTrustedKitchenActor, getRequestActor } from "./common";

export function validateGetCurrentMenuRequest(request: Request) {
  const actor = getRequestActor(request);
  const kitchenId = String(request.params.kitchenId);
  assertRole(actor, ["CLIENT", "KITCHEN", "DELIVERER"]);

  if (actor.role === "KITCHEN") {
    assertTrustedKitchenActor(actor, kitchenId);
  }

  if (actor.role === "DELIVERER") {
    assertTrustedDelivererActor(actor, kitchenId);
  }

  return {
    actor,
    kitchenId
  };
}

export function validatePublishMenuRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = getRequestActor(request);
  const kitchenId = String(request.params.kitchenId);
  rejectUnsupportedFields(body, ["messageId", "items"]);
  requireFields(body, ["messageId", "items"]);
  assertTrustedKitchenActor(actor, kitchenId);

  return {
    ...body,
    actor
  };
}

export function validateUpsertMenuProductRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = getRequestActor(request);
  const kitchenId = String(request.params.kitchenId);
  rejectUnsupportedFields(body, ["messageId", "product"]);
  requireFields(body, ["messageId", "product"]);
  assertTrustedKitchenActor(actor, kitchenId);

  return {
    ...body,
    actor
  };
}
