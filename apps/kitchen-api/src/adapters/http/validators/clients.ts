import type { Request } from "express";
import { requireFields, rejectUnsupportedFields } from "../../../shared/validation";
import { assertActorPhone, assertRole, getRequestActor } from "./common";

export function validateUpsertClientRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = getRequestActor(request);
  rejectUnsupportedFields(body, ["messageId", "kitchenId", "profile"]);
  requireFields(body, ["messageId", "kitchenId", "profile"]);
  assertRole(actor, ["CLIENT"]);
  assertActorPhone(actor);

  return {
    ...body,
    actor
  };
}
