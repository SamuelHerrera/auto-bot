import type { Request } from "express";
import { createError } from "../../../shared/errors";
import { requireFields } from "../../../shared/validation";
import { assertNoTrustedActorClaims, getRequestActor } from "./common";
import { config } from "../../../infrastructure/config";

export function validateGetPrintQueueRequest(request: Request) {
  const actor = getRequestActor(request);
  assertNoTrustedActorClaims(actor);

  const expectedApiKey = config.printing.printerBridgeApiKey.trim();
  const submittedApiKey = request.get(config.printing.printerBridgeAuthHeader)?.trim() ?? "";

  if (!expectedApiKey || submittedApiKey !== expectedApiKey) {
    throw createError(403, "printer_not_authorized");
  }

  const input = {
    kitchenId: request.params.kitchenId,
    printerIdentifier: request.query.printerIdentifier
  };

  requireFields(input, ["kitchenId", "printerIdentifier"]);

  return {
    kitchenId: input.kitchenId,
    printerIdentifier: String(input.printerIdentifier),
    printerCredential: {
      type: "service_token"
    }
  };
}
