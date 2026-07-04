import type { HermesActionName, HermesOrchestratorRequest } from "./types";

export const SUPPORTED_HERMES_ACTIONS: HermesActionName[] = [
  "create_order_draft",
  "get_order",
  "change_order_status",
  "query_orders"
];

export function isSupportedHermesAction(action: unknown): action is HermesActionName {
  return SUPPORTED_HERMES_ACTIONS.includes(action as HermesActionName);
}

export function normalizeHermesActionRequest(value: unknown): HermesOrchestratorRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createHermesContractError("validation_error", {
      reason: "action_request_must_be_object"
    });
  }

  const action = (value as HermesOrchestratorRequest).action;
  const payload = (value as HermesOrchestratorRequest).payload;

  if (!isSupportedHermesAction(action)) {
    throw createHermesContractError("validation_error", {
      reason: "unsupported_action",
      action
    });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createHermesContractError("validation_error", {
      reason: "payload_must_be_object",
      action
    });
  }

  return {
    action,
    payload
  };
}

export function extractHermesActionRequest(value: unknown): HermesOrchestratorRequest {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value) && isPlainObject((value as any).actionRequest)
      ? (value as any).actionRequest
      : value;

  return normalizeHermesActionRequest(candidate);
}

export function createHermesContractError(code: string, details?: Record<string, unknown>) {
  const error: any = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
