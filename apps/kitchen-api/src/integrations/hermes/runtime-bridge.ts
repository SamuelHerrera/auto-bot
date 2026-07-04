import { serializeResult } from "../../shared/serialize";
import { normalizeHermesActionRequest } from "./contract";
import { createHermesLocalOrchestrator, type HermesLocalOrchestrator } from "./orchestrator";
import type {
  HermesActionName,
  HermesBackendRole,
  HermesOrchestratorRequest,
  HermesRuntimeBridgeInput,
  HermesRuntimeBridgeProvider,
  HermesRuntimeBridgeResult
} from "./types";

export class HermesRuntimeBridge {
  constructor(
    private readonly orchestrator: HermesLocalOrchestrator = createHermesLocalOrchestrator(),
    private readonly provider?: HermesRuntimeBridgeProvider
  ) {}

  async execute(
    input: HermesRuntimeBridgeInput,
    options: { allowCallerActionRequest?: boolean } = {}
  ): Promise<HermesRuntimeBridgeResult> {
    try {
      if (input?.actionRequest && options.allowCallerActionRequest !== true) {
        return this.errorResult(safeSerializeInput(input), null, "action_not_allowed", null);
      }

      const inbound = normalizeInbound(input);
      const selectedAction = await this.resolveActionRequest(inbound);

      if (!selectedAction) {
        return this.errorResult(inbound, null, "no_action_available", null);
      }

      const actionRequest = hydrateActionRequestWithContext(selectedAction, inbound);
      const orchestratorResult = await this.orchestrator.execute(actionRequest as HermesOrchestratorRequest<any>);

      return {
        ok: orchestratorResult.ok,
        inbound: serializeResult(inbound) as HermesRuntimeBridgeInput,
        actionRequest: serializeResult(actionRequest) as HermesOrchestratorRequest,
        orchestratorResult,
        outboundResponse: {
          status: orchestratorResult.ok ? "success" : "error",
          message: orchestratorResult.finalResponse.summary,
          nextSuggestedAction: orchestratorResult.finalResponse.nextSuggestedAction,
          actionExecuted: orchestratorResult.action,
          ...(orchestratorResult.finalResponse.context
            ? { context: serializeResult(orchestratorResult.finalResponse.context) as Record<string, unknown> }
            : {})
        }
      };
    } catch (error: any) {
      const inbound = safeSerializeInput(input);

      return this.errorResult(
        inbound,
        null,
        error?.code ?? "runtime_bridge_error",
        error?.details ?? null
      );
    }
  }

  private async resolveActionRequest(
    input: HermesRuntimeBridgeInput
  ): Promise<HermesOrchestratorRequest | null> {
    if (input.actionRequest) {
      return normalizeActionRequest(input.actionRequest);
    }

    if (!this.provider) {
      return null;
    }

    const providerOutput = await this.provider.decideAction(input);
    return normalizeActionRequest(providerOutput);
  }

  private errorResult(
    inbound: HermesRuntimeBridgeInput,
    actionRequest: HermesOrchestratorRequest | null,
    code: string,
    details: Record<string, unknown> | null
  ): HermesRuntimeBridgeResult {
    return {
      ok: false,
      inbound: serializeResult(inbound) as HermesRuntimeBridgeInput,
      actionRequest: actionRequest ? (serializeResult(actionRequest) as HermesOrchestratorRequest) : null,
      orchestratorResult: null,
      outboundResponse: {
        status: "error",
        message: code,
        nextSuggestedAction: null,
        actionExecuted: actionRequest?.action ?? null,
        ...(details ? { context: serializeResult(details) as Record<string, unknown> } : {})
      }
    };
  }
}

export function createHermesRuntimeBridge(
  orchestrator?: HermesLocalOrchestrator,
  provider?: HermesRuntimeBridgeProvider
) {
  return new HermesRuntimeBridge(orchestrator ?? createHermesLocalOrchestrator(), provider);
}

function normalizeInbound(input: HermesRuntimeBridgeInput): HermesRuntimeBridgeInput {
  if (!input || typeof input !== "object") {
    throw createBridgeError("validation_error", {
      reason: "input_must_be_object"
    });
  }

  if (!input.message || typeof input.message !== "object" || Array.isArray(input.message)) {
    throw createBridgeError("validation_error", {
      reason: "message_must_be_object"
    });
  }

  if (typeof input.message.text !== "string" || input.message.text.trim() === "") {
    throw createBridgeError("validation_error", {
      reason: "message_text_required"
    });
  }

  return {
    message: {
      ...input.message,
      text: input.message.text.trim()
    },
    ...(input.context ? { context: input.context } : {}),
    ...(input.actionRequest ? { actionRequest: input.actionRequest } : {})
  };
}

function normalizeActionRequest(value: unknown): HermesOrchestratorRequest {
  try {
    return normalizeHermesActionRequest(value);
  } catch (error: any) {
    throw createBridgeError(error?.code ?? "validation_error", error?.details);
  }
}

function hydrateActionRequestWithContext(
  actionRequest: HermesOrchestratorRequest,
  input: HermesRuntimeBridgeInput
): HermesOrchestratorRequest {
  const payload = { ...(actionRequest.payload as Record<string, unknown>) };
  const phone = input.context?.phone ?? input.message.phone;
  const kitchenId = input.context?.kitchenId ?? input.message.kitchenId;
  const orderId = input.context?.orderId ?? input.message.orderId;
  const actorRole = (input.context?.actorRole ?? input.message.actorRole ?? inferActorRole(actionRequest.action)) as HermesBackendRole;

  switch (actionRequest.action) {
    case "create_order_draft":
      if (payload.phone === undefined && phone !== undefined) {
        payload.phone = phone;
      }
      if (payload.kitchenId === undefined && kitchenId !== undefined) {
        payload.kitchenId = kitchenId;
      }
      break;
    case "get_order":
    case "change_order_status":
      if (payload.orderId === undefined && orderId !== undefined) {
        payload.orderId = orderId;
      }
      if (payload.actor === undefined) {
        payload.actor = buildActorFromContext(actorRole, phone, kitchenId);
      }
      break;
    case "query_orders":
      if (payload.actor === undefined) {
        payload.actor = buildActorFromContext(actorRole, phone, kitchenId);
      }
      break;
  }

  return {
    action: actionRequest.action,
    payload: payload as HermesOrchestratorRequest["payload"]
  };
}

function inferActorRole(action: HermesActionName): HermesBackendRole {
  switch (action) {
    case "query_orders":
      return "KITCHEN";
    default:
      return "CLIENT";
  }
}

function buildActorFromContext(
  role: HermesBackendRole,
  phone?: string,
  kitchenId?: string | number | bigint
) {
  switch (role) {
    case "CLIENT":
      return phone ? { role, phone } : { role };
    case "KITCHEN":
      return kitchenId !== undefined ? { role, kitchenId } : { role };
    default:
      return { role };
  }
}

function createBridgeError(code: string, details?: Record<string, unknown>) {
  const error: any = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function safeSerializeInput(input: HermesRuntimeBridgeInput) {
  try {
    return serializeResult(input) as HermesRuntimeBridgeInput;
  } catch {
    return {
      message: {
        text: ""
      }
    };
  }
}
