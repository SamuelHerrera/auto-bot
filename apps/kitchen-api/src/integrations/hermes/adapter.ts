import { randomUUID } from "node:crypto";
import { normalizeMexicanPhone } from "../../shared/normalize";
import { serializeResult } from "../../shared/serialize";
import { KitcheniaHttpClient, type KitcheniaHttpClientOptions } from "./client";
import type {
  HermesActionInputMap,
  HermesActionName,
  HermesActionResult,
  HermesActorInput,
  HermesBackendRole,
  HermesCallerContext,
  HermesChangeOrderStatusInput,
  HermesCreateOrderDraftInput,
  HermesGetOrderInput,
  HermesQueryOrdersInput
} from "./types";

const BACKEND_ERROR_TYPES = new Set([
  "missing_fields",
  "product_not_found",
  "kitchen_not_accepting_orders",
  "action_not_allowed",
  "order_not_found",
  "invalid_status_transition",
  "unsupported_filter"
]);

export class HermesKitcheniaAdapter {
  constructor(private readonly client = new KitcheniaHttpClient()) {}

  async execute<TAction extends HermesActionName>(
    action: TAction,
    input: HermesActionInputMap[TAction]
  ): Promise<HermesActionResult<TAction>> {
    switch (action) {
      case "create_order_draft":
        return await this.createOrderDraft(input as HermesCreateOrderDraftInput) as HermesActionResult<TAction>;
      case "get_order":
        return await this.getOrder(input as HermesGetOrderInput) as HermesActionResult<TAction>;
      case "change_order_status":
        return await this.changeOrderStatus(input as HermesChangeOrderStatusInput) as HermesActionResult<TAction>;
      case "query_orders":
        return await this.queryOrders(input as HermesQueryOrdersInput) as HermesActionResult<TAction>;
      default:
        return this.validationError(action, "unsupported_action", {
          action
        }) as HermesActionResult<TAction>;
    }
  }

  async createOrderDraft(input: HermesCreateOrderDraftInput): Promise<HermesActionResult<"create_order_draft">> {
    const action = "create_order_draft";

    try {
      const phone = canonicalizeClientPhone(input.phone);
      const kitchenId = normalizeIntegerId(input.kitchenId, "kitchenId");
      assertItems(input.items);
      const messageId = resolveMessageId(action, input.messageId);
      const actor = createActorContext({
        role: "CLIENT",
        phone
      });

      const response = await this.client.post("/orders/draft", actor, {
        messageId,
        kitchenId,
        orderId: input.orderId === undefined ? null : normalizeNullableIntegerId(input.orderId, "orderId"),
        items: input.items.map((item) => ({
          productName: assertNonEmptyString(item.productName, "items.productName"),
          ...(item.portionLabel ? { portionLabel: assertNonEmptyString(item.portionLabel, "items.portionLabel") } : {}),
          quantity: assertInteger(item.quantity, "items.quantity")
        })),
        deliveryType: input.deliveryType ?? "PICKUP",
        address: input.address ?? null,
        paymentMethod: input.paymentMethod ?? null,
        paymentStatus: input.paymentStatus ?? undefined,
        paymentReference: input.paymentReference ?? undefined,
        comments: input.comments ?? null
      });

      return normalizeResult(action, response, (body) => ({
        actor: serializeResult(actor),
        messageId,
        orderId: body?.order?.id ?? null,
        orderStatus: body?.order?.status ?? null,
        readyToConfirm: body?.readyToConfirm ?? null,
        nextMissingField: body?.nextMissingField ?? null,
        order: body?.order ?? null
      }));
    } catch (error: any) {
      return this.validationError(action, error.code ?? "validation_error", error.details);
    }
  }

  async getOrder(input: HermesGetOrderInput): Promise<HermesActionResult<"get_order">> {
    const action = "get_order";

    try {
      const actor = normalizeActor(input.actor, action);
      const orderId = normalizeIntegerId(input.orderId, "orderId");
      const response = await this.client.get(`/orders/${orderId}`, actor);

      return normalizeResult(action, response, (body) => ({
        actor: serializeResult(actor),
        orderId,
        orderStatus: body?.order?.status ?? null,
        order: body?.order ?? null
      }));
    } catch (error: any) {
      return this.validationError(action, error.code ?? "validation_error", error.details);
    }
  }

  async changeOrderStatus(
    input: HermesChangeOrderStatusInput
  ): Promise<HermesActionResult<"change_order_status">> {
    const action = "change_order_status";

    try {
      const actor = normalizeActor(input.actor, action);
      const orderId = normalizeIntegerId(input.orderId, "orderId");
      const messageId = resolveMessageId(action, input.messageId);
      const response = await this.client.post(`/orders/${orderId}/status`, actor, {
        messageId,
        targetOrderStatus: assertNonEmptyString(input.targetOrderStatus, "targetOrderStatus"),
        ...(input.deliveryDriverUserId ? { deliveryDriverUserId: String(input.deliveryDriverUserId) } : {}),
        ...(input.cancellationDescription ? { cancellationDescription: input.cancellationDescription } : {}),
        ...(input.estimatedReadyAt ? { estimatedReadyAt: input.estimatedReadyAt } : {}),
        ...(input.printedAt ? { printedAt: input.printedAt } : {}),
        ...(input.printStatus ? { printStatus: input.printStatus } : {})
      });

      return normalizeResult(action, response, (body) => ({
        actor: serializeResult(actor),
        messageId,
        orderId,
        orderStatus: body?.order?.status ?? null,
        order: body?.order ?? null,
        auditEvent: body?.auditEvent ?? null
      }));
    } catch (error: any) {
      return this.validationError(action, error.code ?? "validation_error", error.details);
    }
  }

  async queryOrders(input: HermesQueryOrdersInput): Promise<HermesActionResult<"query_orders">> {
    const action = "query_orders";

    try {
      const actor = normalizeActor(input.actor, action);
      const filter = normalizeQueryFilter(input.filter);
      const response = await this.client.get("/orders", actor, {
        filter,
        limit: input.limit
      });

      return normalizeResult(action, response, (body) => ({
        actor: serializeResult(actor),
        filter,
        count: Array.isArray(body?.orders) ? body.orders.length : 0,
        orders: body?.orders ?? [],
        nextCursor: body?.nextCursor ?? null
      }));
    } catch (error: any) {
      return this.validationError(action, error.code ?? "validation_error", error.details);
    }
  }

  private validationError<TAction extends HermesActionName>(
    action: TAction,
    code: string,
    details?: Record<string, unknown>
  ): HermesActionResult<TAction> {
    return {
      ok: false,
      action,
      statusCode: 0,
      data: null,
      error: {
        type: "validation_error",
        code,
        message: code,
        ...(details ? { details } : {})
      },
      raw: details ?? null
    };
  }
}

export function createHermesKitcheniaAdapter(options?: KitcheniaHttpClientOptions) {
  return new HermesKitcheniaAdapter(new KitcheniaHttpClient(options));
}

function normalizeResult<TAction extends HermesActionName>(
  action: TAction,
  response: { statusCode: number; body: any },
  mapData: (body: any) => Record<string, unknown>
): HermesActionResult<TAction> {
  if (response.statusCode > 0 && response.body?.ok) {
    return {
      ok: true,
      action,
      statusCode: response.statusCode,
      data: serializeResult(mapData(response.body)) as Record<string, unknown>,
      error: null,
      raw: response.body
    };
  }

  const backendCode = response.body?.error ?? (response.statusCode === 0 ? "network_error" : "backend_error");
  const errorType =
    response.statusCode === 0
      ? "network_error"
      : BACKEND_ERROR_TYPES.has(backendCode)
        ? backendCode
        : "backend_error";

  return {
    ok: false,
    action,
    statusCode: response.statusCode,
    data: null,
    error: {
      type: errorType as any,
      code: backendCode,
      message: backendCode,
      details: extractErrorDetails(response.body)
    },
    raw: response.body
  };
}

function extractErrorDetails(body: any) {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const entries = Object.entries(body).filter(([key]) => key !== "ok" && key !== "error");

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeActor(actor: HermesActorInput, action: HermesActionName): HermesCallerContext {
  const role = String((actor as any).role ?? inferDefaultRole(action)).toUpperCase() as HermesBackendRole;

  switch (role) {
    case "CLIENT":
      return createActorContext({
        role,
        phone: canonicalizeClientPhone((actor as any).phone)
      });
    case "KITCHEN":
      return createActorContext({
        role,
        kitchenId: normalizeIntegerId((actor as any).kitchenId, "kitchenId")
      });
    case "DELIVERER":
      return createActorContext({
        role,
        id: assertNonEmptyString((actor as any).id, "id"),
        kitchenId: normalizeIntegerId((actor as any).kitchenId, "kitchenId")
      });
    default:
      throw createValidationError("unsupported_actor_role", {
        role
      });
  }
}

function inferDefaultRole(action: HermesActionName): HermesBackendRole {
  switch (action) {
    case "create_order_draft":
      return "CLIENT";
    case "query_orders":
      return "KITCHEN";
    default:
      return "CLIENT";
  }
}

function createActorContext(actor: HermesCallerContext): HermesCallerContext {
  return serializeResult(actor) as HermesCallerContext;
}

function canonicalizeClientPhone(phone: string) {
  return normalizeMexicanPhone(assertNonEmptyString(phone, "phone"));
}

function normalizeQueryFilter(filter: string) {
  const value = assertNonEmptyString(filter, "filter");
  const allowedFilters = new Set(["pending", "active", "completed"]);

  if (!allowedFilters.has(value)) {
    throw createValidationError("unsupported_filter", {
      filter: value
    });
  }

  return value as "pending" | "active" | "completed";
}

function normalizeIntegerId(value: string | number | bigint, fieldName: string) {
  if (value === null || value === undefined || value === "") {
    throw createValidationError("missing_fields", {
      missingFields: [fieldName]
    });
  }

  try {
    return BigInt(value).toString();
  } catch {
    throw createValidationError("validation_error", {
      field: fieldName,
      reason: "must_be_integer"
    });
  }
}

function normalizeNullableIntegerId(value: string | number | bigint | null | undefined, fieldName: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return normalizeIntegerId(value, fieldName);
}

function assertItems(items: { productName: string; quantity: number }[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createValidationError("missing_fields", {
      missingFields: ["items"]
    });
  }
}

function assertInteger(value: number, fieldName: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw createValidationError("validation_error", {
      field: fieldName,
      reason: "must_be_positive_integer"
    });
  }

  return value;
}

function assertNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw createValidationError("missing_fields", {
      missingFields: [fieldName]
    });
  }

  return value.trim();
}

function resolveMessageId(action: HermesActionName, messageId?: string) {
  if (messageId && messageId.trim() !== "") {
    return messageId.trim();
  }

  return `hermes_${action}_${randomUUID()}`;
}

function createValidationError(code: string, details?: Record<string, unknown>) {
  const error: any = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}
