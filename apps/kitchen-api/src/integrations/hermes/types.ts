export type HermesActionName =
  | "create_order_draft"
  | "get_order"
  | "change_order_status"
  | "query_orders";

export type HermesBackendRole = "CLIENT" | "KITCHEN" | "DELIVERER";

export type HermesHttpIdentity = {
  role?: HermesBackendRole | "PLATFORM_SUPPORT";
  phone?: string;
  kitchenId?: string | number | bigint;
  id?: string;
  contactId?: string;
  platformAccess?: boolean;
};

export type HermesClientActorInput = {
  role?: "CLIENT";
  phone: string;
};

export type HermesKitchenActorInput = {
  role?: "KITCHEN";
  kitchenId: string | number | bigint;
};

export type HermesDelivererActorInput = {
  role?: "DELIVERER";
  id: string;
  kitchenId: string | number | bigint;
};

export type HermesActorInput =
  | HermesClientActorInput
  | HermesKitchenActorInput
  | HermesDelivererActorInput;

export type HermesOrderItemInput = {
  productName: string;
  portionLabel?: string;
  quantity: number;
};

export type HermesCreateOrderDraftInput = {
  phone: string;
  kitchenId: string | number | bigint;
  items: HermesOrderItemInput[];
  deliveryType?: "PICKUP" | "DELIVERY" | null;
  paymentMethod?: "CASH" | "TRANSFER" | null;
  address?: Record<string, unknown> | null;
  comments?: string | null;
  messageId?: string;
  orderId?: string | number | bigint | null;
  paymentStatus?: "PENDING" | "COMPLETED" | null;
  paymentReference?: string | null;
};

export type HermesGetOrderInput = {
  actor: HermesActorInput;
  orderId: string | number | bigint;
};

export type HermesChangeOrderStatusInput = {
  actor: HermesActorInput;
  orderId: string | number | bigint;
  targetOrderStatus: "CONFIRMED" | "CANCELLED" | "IN_PROCESS_OF_DELIVERY" | "DELIVERED";
  messageId?: string;
  cancellationDescription?: string;
  deliveryDriverUserId?: string | number | bigint;
  estimatedReadyAt?: string;
  printedAt?: string;
  printStatus?: "PENDING" | "PRINTED" | "FAILED" | "NOT_REQUIRED";
};

export type HermesQueryOrdersInput = {
  actor: HermesKitchenActorInput | HermesDelivererActorInput;
  filter: "pending" | "active" | "completed";
  limit?: number;
};

export type HermesActionInputMap = {
  create_order_draft: HermesCreateOrderDraftInput;
  get_order: HermesGetOrderInput;
  change_order_status: HermesChangeOrderStatusInput;
  query_orders: HermesQueryOrdersInput;
};

export type HermesAdapterErrorType =
  | "missing_fields"
  | "product_not_found"
  | "kitchen_not_accepting_orders"
  | "action_not_allowed"
  | "order_not_found"
  | "invalid_status_transition"
  | "unsupported_filter"
  | "validation_error"
  | "backend_error"
  | "network_error";

export type HermesAdapterError = {
  type: HermesAdapterErrorType;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type HermesActionResult<TAction extends HermesActionName = HermesActionName> = {
  ok: boolean;
  action: TAction;
  statusCode: number;
  data: Record<string, unknown> | null;
  error: HermesAdapterError | null;
  raw: unknown;
};

export type HermesOrchestratorRequest<TAction extends HermesActionName = HermesActionName> = {
  action: TAction;
  payload: HermesActionInputMap[TAction];
};

export type HermesFinalResponse = {
  status: "success" | "error";
  summary: string;
  nextSuggestedAction: HermesActionName | null;
  context?: Record<string, unknown>;
};

export type HermesOrchestratorResult<TAction extends HermesActionName = HermesActionName> = {
  ok: boolean;
  action: TAction;
  request: HermesOrchestratorRequest<TAction>;
  adapterResult: HermesActionResult<TAction>;
  finalResponse: HermesFinalResponse;
};

export type HermesRuntimeMessageInput = {
  id?: string;
  text: string;
  phone?: string;
  kitchenId?: string | number | bigint;
  orderId?: string | number | bigint;
  actorRole?: HermesBackendRole;
  metadata?: Record<string, unknown>;
};

export type HermesRuntimeContext = {
  phone?: string;
  kitchenId?: string | number | bigint;
  orderId?: string | number | bigint;
  actorRole?: HermesBackendRole;
  metadata?: Record<string, unknown>;
};

export type HermesRuntimeBridgeInput = {
  message: HermesRuntimeMessageInput;
  context?: HermesRuntimeContext;
  actionRequest?: HermesOrchestratorRequest;
};

export type HermesRuntimeBridgeProvider = {
  decideAction(input: HermesRuntimeBridgeInput): Promise<unknown> | unknown;
};

export type HermesProviderMode = "structured" | "rules" | "http";

export type HermesRuntimeBridgeOutboundResponse = {
  status: "success" | "error";
  message: string;
  nextSuggestedAction: HermesActionName | null;
  actionExecuted: HermesActionName | null;
  context?: Record<string, unknown>;
};

export type HermesRuntimeBridgeResult = {
  ok: boolean;
  inbound: HermesRuntimeBridgeInput;
  actionRequest: HermesOrchestratorRequest | null;
  orchestratorResult: HermesOrchestratorResult | null;
  outboundResponse: HermesRuntimeBridgeOutboundResponse;
};

export type HermesConversationState = HermesRuntimeContext & {
  conversationId: string;
  lastAction?: HermesActionName | null;
  updatedAt: string;
};

export type HermesTransportInput = {
  conversationId?: string;
  message: HermesRuntimeMessageInput;
  context?: HermesRuntimeContext;
  actionRequest?: HermesOrchestratorRequest;
};

export type HermesTransportResult = {
  ok: boolean;
  conversationId: string;
  request: HermesRuntimeBridgeInput;
  runtimeResult: HermesRuntimeBridgeResult;
  state: HermesConversationState;
  outboundResponse: HermesRuntimeBridgeOutboundResponse;
};

export type HermesCallerContext = {
  role: HermesBackendRole;
  phone?: string;
  kitchenId?: string;
  id?: string;
};

export type KitcheniaHttpResponse = {
  statusCode: number;
  body: any;
};
