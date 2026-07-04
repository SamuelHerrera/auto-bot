import type { Request } from "express";
import { requireFields, rejectUnsupportedFields } from "../../../shared/validation";
import { buildPlatformSupportActor, assertTrustedKitchenActor, getRequestActor } from "./common";

export function validateRegisterKitchenRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = buildPlatformSupportActor(request);
  rejectUnsupportedFields(body, ["messageId", "tenant"]);
  requireFields(body, ["messageId", "tenant"]);

  return {
    ...body,
    actor
  };
}

export function validateRegisterWhatsappSessionRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = buildPlatformSupportActor(request);
  rejectUnsupportedFields(body, ["messageId", "providerEvent", "providerSession"]);
  requireFields(body, ["messageId"]);

  return {
    ...body,
    actor
  };
}

export function validateUpdateKitchenConfigurationRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = getRequestActor(request);
  const kitchenId = String(request.params.kitchenId);
  rejectUnsupportedFields(body, ["messageId", "configuration"]);
  requireFields(body, ["messageId", "configuration"]);
  assertTrustedKitchenActor(actor, kitchenId);

  return {
    ...body,
    actor
  };
}

export function validateUpsertAuthorizedContactRequest(request: Request) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const actor = getRequestActor(request);
  const kitchenId = String(request.params.kitchenId);
  rejectUnsupportedFields(body, ["messageId", "contact"]);
  requireFields(body, ["messageId", "contact"]);
  assertTrustedKitchenActor(actor, kitchenId);

  return {
    ...body,
    actor
  };
}
