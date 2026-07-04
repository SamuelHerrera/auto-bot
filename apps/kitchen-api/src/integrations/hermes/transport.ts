import { createError } from "../../shared/errors";
import { serializeResult } from "../../shared/serialize";
import { createHermesRuntimeBridge, type HermesRuntimeBridge } from "./runtime-bridge";
import {
  createInMemoryHermesConversationStore,
  mergeRuntimeContexts,
  resolveConversationId,
  resolveConversationScopeKey,
  type HermesConversationStore
} from "./conversation-store";
import { createHermesRuntimeProviderFromEnv } from "./provider";
import type {
  HermesConversationState,
  HermesRuntimeContext,
  HermesTransportInput,
  HermesTransportResult
} from "./types";

export class HermesTransportService {
  constructor(
    private readonly bridge: HermesRuntimeBridge = createHermesRuntimeBridge(undefined, createHermesRuntimeProviderFromEnv()),
    private readonly store: HermesConversationStore = createInMemoryHermesConversationStore()
  ) {}

  async execute(
    input: HermesTransportInput,
    options: { allowCallerActionRequest?: boolean } = {}
  ): Promise<HermesTransportResult> {
    const normalizedInput = normalizeTransportInput(input, options);
    const conversationId = resolveConversationId(normalizedInput);
    const conversationScopeKey = resolveConversationScopeKey(normalizedInput, conversationId);
    const existingState = await this.store.get(conversationScopeKey);
    const storedContext = existingState
      ? {
          phone: existingState.phone,
          kitchenId: existingState.kitchenId,
          orderId: existingState.orderId,
          actorRole: existingState.actorRole,
          metadata: existingState.metadata
        }
      : null;
    const context = mergeRuntimeContexts(storedContext, normalizedInput.context, normalizedInput.message);
    const request = {
      message: normalizedInput.message,
      context,
      ...(normalizedInput.actionRequest ? { actionRequest: normalizedInput.actionRequest } : {})
    };
    const runtimeResult = await this.bridge.execute(request, {
      allowCallerActionRequest: options.allowCallerActionRequest === true
    });
    const state = buildConversationState(conversationId, context, runtimeResult);

    await this.store.set(state, conversationScopeKey);

    return {
      ok: runtimeResult.ok,
      conversationId,
      request: serializeResult(request) as HermesTransportResult["request"],
      runtimeResult,
      state,
      outboundResponse: runtimeResult.outboundResponse
    };
  }
}

export function createHermesTransportService(
  bridge?: HermesRuntimeBridge,
  store?: HermesConversationStore
) {
  return new HermesTransportService(
    bridge ?? createHermesRuntimeBridge(undefined, createHermesRuntimeProviderFromEnv()),
    store ?? createInMemoryHermesConversationStore()
  );
}

function normalizeTransportInput(
  input: HermesTransportInput,
  options: { allowCallerActionRequest?: boolean } = {}
): HermesTransportInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createError(400, "missing_fields", {
      missingFields: ["message"]
    });
  }

  if (!input.message || typeof input.message !== "object" || Array.isArray(input.message)) {
    throw createError(400, "missing_fields", {
      missingFields: ["message"]
    });
  }

  if (typeof input.message.text !== "string" || input.message.text.trim() === "") {
    throw createError(400, "missing_fields", {
      missingFields: ["message.text"]
    });
  }

  if (input.actionRequest && options.allowCallerActionRequest !== true) {
    throw createError(403, "action_not_allowed");
  }

  return {
    ...(typeof input.conversationId === "string" && input.conversationId.trim() !== ""
      ? { conversationId: input.conversationId.trim() }
      : {}),
    message: {
      ...input.message,
      text: input.message.text.trim()
    },
    ...(input.context ? { context: input.context } : {}),
    ...(input.actionRequest ? { actionRequest: input.actionRequest } : {})
  };
}

function buildConversationState(
  conversationId: string,
  currentContext: HermesRuntimeContext,
  runtimeResult: HermesTransportResult["runtimeResult"]
): HermesConversationState {
  const payload = runtimeResult.actionRequest?.payload as Record<string, unknown> | undefined;
  const actor = payload?.actor && typeof payload.actor === "object" && !Array.isArray(payload.actor)
    ? (payload.actor as Record<string, unknown>)
    : null;
  const adapterData = runtimeResult.orchestratorResult?.adapterResult.data ?? null;
  const finalContext = runtimeResult.outboundResponse.context ?? null;

  return serializeResult({
    conversationId,
    phone: pickFirstString(
      currentContext.phone,
      actor?.phone,
      payload?.phone
    ),
    kitchenId: pickFirstValue(
      currentContext.kitchenId,
      actor?.kitchenId,
      payload?.kitchenId
    ),
    orderId: pickFirstValue(
      finalContext?.orderId,
      adapterData?.orderId,
      currentContext.orderId,
      payload?.orderId
    ),
    actorRole: pickFirstString(
      currentContext.actorRole,
      actor?.role
    ) as HermesRuntimeContext["actorRole"],
    metadata: currentContext.metadata,
    lastAction: runtimeResult.actionRequest?.action ?? null,
    updatedAt: new Date().toISOString()
  }) as HermesConversationState;
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return undefined;
}

function pickFirstValue(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value as any;
    }
  }

  return undefined;
}
