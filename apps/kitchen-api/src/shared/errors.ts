export class AppError extends Error {
  statusCode: number;
  errorCode: string;
  details?: Record<string, unknown>;

  constructor(statusCode: number, errorCode: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? errorCode);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const ERROR_STATUS_MAP: Record<string, number> = {
  action_not_allowed: 403,
  confirmation_required: 409,
  duplicate_product: 409,
  invalid_configuration: 400,
  invalid_menu_item: 400,
  invalid_quantity: 400,
  invalid_role: 400,
  invalid_status_transition: 409,
  item_sold_out: 409,
  kitchen_not_accepting_orders: 409,
  missing_fields: 400,
  order_not_found: 404,
  printer_not_authorized: 403,
  product_not_found: 404,
  protected_field: 409,
  route_not_found: 404,
  unsupported_delivery_type: 400,
  unsupported_field: 400,
  unsupported_filter: 400,
  unsupported_payment_method: 400,
  insufficient_stock: 409
};

export function createError(statusCode: number, errorCode: string, details?: Record<string, unknown>) {
  return new AppError(statusCode, errorCode, errorCode, details);
}

export function getStatusCodeForResult(result: any) {
  if (result?.ok) {
    return 200;
  }

  return ERROR_STATUS_MAP[result?.error] ?? 500;
}

export function toErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        ok: false,
        error: error.errorCode,
        ...(error.details ?? {})
      }
    };
  }

  if (
    error &&
    typeof error === "object" &&
    (((error as any).type === "entity.parse.failed" && ((error as any).status === 400 || (error as any).statusCode === 400)) ||
      (typeof (error as any).statusCode === "number" && (error as any).statusCode >= 400 && (error as any).statusCode < 500))
  ) {
    return {
      statusCode: (error as any).statusCode ?? (error as any).status,
      body: {
        ok: false,
        error: (error as any).type === "entity.parse.failed" ? "invalid_json" : "invalid_request"
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      ok: false,
      error: "internal_error"
    }
  };
}
