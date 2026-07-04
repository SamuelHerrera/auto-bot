import { serializeResult } from "../../shared/serialize";
import { createHermesKitcheniaAdapter, type HermesKitcheniaAdapter } from "./adapter";
import type {
  HermesActionInputMap,
  HermesActionName,
  HermesFinalResponse,
  HermesOrchestratorRequest,
  HermesOrchestratorResult
} from "./types";

export class HermesLocalOrchestrator {
  constructor(private readonly adapter: HermesKitcheniaAdapter = createHermesKitcheniaAdapter()) {}

  async execute<TAction extends HermesActionName>(
    request: HermesOrchestratorRequest<TAction>
  ): Promise<HermesOrchestratorResult<TAction>> {
    try {
      const normalizedRequest = normalizeRequest(request);
      const adapterResult = await this.adapter.execute(normalizedRequest.action, normalizedRequest.payload);
      const finalResponse = buildFinalResponse(normalizedRequest.action, adapterResult);

      return {
        ok: adapterResult.ok,
        action: normalizedRequest.action,
        request: serializeResult(normalizedRequest) as HermesOrchestratorRequest<TAction>,
        adapterResult,
        finalResponse
      };
    } catch (error: any) {
      const action = isSupportedAction(request?.action) ? request.action : "get_order";
      const adapterResult = {
        ok: false,
        action: action as TAction,
        statusCode: 0,
        data: null,
        error: {
          type: "validation_error" as const,
          code: error?.code ?? "validation_error",
          message: error?.code ?? "validation_error",
          ...(error?.details ? { details: error.details } : {})
        },
        raw: error?.details ?? null
      } as const;
      const normalizedRequest = {
        action: action as TAction,
        payload: ((request as any)?.payload ?? {}) as HermesActionInputMap[typeof action]
      } as HermesOrchestratorRequest<TAction>;

      return {
        ok: false,
        action: action as TAction,
        request: serializeResult(normalizedRequest) as HermesOrchestratorRequest<TAction>,
        adapterResult,
        finalResponse: buildFinalResponse(action, adapterResult)
      };
    }
  }
}

export function createHermesLocalOrchestrator(adapter?: HermesKitcheniaAdapter) {
  return new HermesLocalOrchestrator(adapter ?? createHermesKitcheniaAdapter());
}

function normalizeRequest<TAction extends HermesActionName>(
  request: HermesOrchestratorRequest<TAction>
): HermesOrchestratorRequest<TAction> {
  if (!request || typeof request !== "object") {
    throw createOrchestratorError("validation_error", {
      reason: "request_must_be_object"
    });
  }

  const action = request.action;

  if (!isSupportedAction(action)) {
    throw createOrchestratorError("validation_error", {
      reason: "unsupported_action",
      action
    });
  }

  if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) {
    throw createOrchestratorError("validation_error", {
      reason: "payload_must_be_object",
      action
    });
  }

  return request;
}

function isSupportedAction(action: unknown): action is HermesActionName {
  return (
    action === "create_order_draft" ||
    action === "get_order" ||
    action === "change_order_status" ||
    action === "query_orders"
  );
}

function buildFinalResponse(
  action: HermesActionName,
  adapterResult: {
    ok: boolean;
    error: { code: string; details?: Record<string, unknown> } | null;
    data: Record<string, unknown> | null;
  }
): HermesFinalResponse {
  if (!adapterResult.ok) {
    return {
      status: "error",
      summary: adapterResult.error?.code ?? "adapter_error",
      nextSuggestedAction: suggestNextActionOnError(action, adapterResult.error?.code),
      ...(adapterResult.error?.details ? { context: serializeResult(adapterResult.error.details) as Record<string, unknown> } : {})
    };
  }

  switch (action) {
    case "create_order_draft":
      return {
        status: "success",
        summary: "draft_created",
        nextSuggestedAction: "get_order",
        context: pickContext(adapterResult.data, ["orderId", "orderStatus", "readyToConfirm", "nextMissingField"])
      };
    case "get_order":
      return {
        status: "success",
        summary: "order_retrieved",
        nextSuggestedAction:
          adapterResult.data?.orderStatus === "DRAFT" ? "change_order_status" : null,
        context: pickContext(adapterResult.data, ["orderId", "orderStatus"])
      };
    case "change_order_status":
      return {
        status: "success",
        summary: `order_status_changed_${String(adapterResult.data?.orderStatus ?? "unknown").toLowerCase()}`,
        nextSuggestedAction:
          adapterResult.data?.orderStatus === "CONFIRMED" ? "query_orders" : null,
        context: pickContext(adapterResult.data, ["orderId", "orderStatus", "messageId"])
      };
    case "query_orders":
      return {
        status: "success",
        summary: `orders_queried_${String(adapterResult.data?.filter ?? "unknown")}`,
        nextSuggestedAction: null,
        context: pickContext(adapterResult.data, ["filter", "count", "nextCursor"])
      };
    default:
      return {
        status: "success",
        summary: "action_completed",
        nextSuggestedAction: null
      };
  }
}

function suggestNextActionOnError(action: HermesActionName, errorCode?: string): HermesActionName | null {
  if (errorCode === "missing_fields") {
    return action;
  }

  if (errorCode === "product_not_found") {
    return "create_order_draft";
  }

  if (errorCode === "order_not_found") {
    return "get_order";
  }

  return null;
}

function pickContext(source: Record<string, unknown> | null, fields: string[]) {
  if (!source) {
    return undefined;
  }

  const entries = fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function createOrchestratorError(code: string, details?: Record<string, unknown>) {
  const error: any = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}
