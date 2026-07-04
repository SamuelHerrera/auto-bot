import type { Request } from "express";
import { createError } from "../../../shared/errors";
import { requireFields, rejectUnsupportedFields } from "../../../shared/validation";
import { assertActorPhone, assertRole, assertTrustedDelivererActor, assertTrustedKitchenActor, getRequestActor } from "./common";

function parseBody(request: Request) {
  return (request.body ?? {}) as Record<string, unknown>;
}

export function validateCreateOrderDraftRequest(request: Request) {
  const body = parseBody(request);
  const actor = getRequestActor(request);
  rejectUnsupportedFields(body, [
    "messageId",
    "kitchenId",
    "orderId",
    "items",
    "deliveryType",
    "address",
    "paymentMethod",
    "paymentStatus",
    "paymentReference",
    "comments"
  ]);
  requireFields(body, ["messageId", "kitchenId", "items"]);
  assertRole(actor, ["CLIENT"]);
  assertActorPhone(actor);

  if (!Array.isArray(body.items)) {
    throw createError(400, "missing_fields", { missingFields: ["items"] });
  }

  return {
    ...body,
    actor
  };
}

export function validateChangeOrderStatusRequest(request: Request) {
  const body = parseBody(request);
  const actor = getRequestActor(request);
  rejectUnsupportedFields(body, [
    "messageId",
    "targetOrderStatus",
    "deliveryDriverUserId",
    "cancellationDescription",
    "estimatedReadyAt",
    "printedAt",
    "printStatus"
  ]);
  requireFields(body, ["messageId", "targetOrderStatus"]);
  assertRole(actor, ["CLIENT", "KITCHEN", "DELIVERER"]);

  if (actor.role === "CLIENT") {
    assertActorPhone(actor);
  }

  if (actor.role === "KITCHEN") {
    const kitchenId = typeof request.body?.kitchenId === "string"
      ? request.body.kitchenId
      : String(request.body?.kitchenId ?? "");
    if (kitchenId) {
      assertTrustedKitchenActor(actor, kitchenId);
    } else if (!actor.contactId || !actor.kitchenId) {
      throw createError(403, "action_not_allowed");
    }
  }

  if (actor.role === "DELIVERER") {
    assertTrustedDelivererActor(actor);
  }

  return {
    ...body,
    actor
  };
}

export function validateGetOrderRequest(request: Request) {
  const actor = getRequestActor(request);
  assertRole(actor, ["CLIENT", "KITCHEN", "DELIVERER"]);

  if (actor.role === "CLIENT") {
    assertActorPhone(actor);
  }

  if (actor.role === "KITCHEN") {
    if (!actor.contactId || !actor.kitchenId) {
      throw createError(403, "action_not_allowed");
    }
  }

  if (actor.role === "DELIVERER") {
    assertTrustedDelivererActor(actor);
  }

  const input = {
    actor,
    orderId: request.params.orderId
  };
  requireFields(input, ["actor", "orderId"]);
  return input;
}

export function validateQueryOrdersRequest(request: Request) {
  const actor = getRequestActor(request);
  assertRole(actor, ["KITCHEN", "DELIVERER"]);

  if (actor.role === "KITCHEN" && (!actor.kitchenId || !actor.contactId)) {
    throw createError(403, "action_not_allowed");
  }

  if (actor.role === "DELIVERER") {
    assertTrustedDelivererActor(actor);
  }

  const input = {
    actor,
    filter: request.query.filter
  };
  requireFields(input, ["actor", "filter"]);
  return {
    actor: input.actor,
    filter: String(input.filter),
    ...(request.query.limit ? { limit: Number(request.query.limit) } : {})
  };
}
