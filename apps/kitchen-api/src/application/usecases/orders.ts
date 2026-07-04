import { normalizeMexicanText } from "../../shared/normalize";
import { repositories } from "../../infrastructure/container";
import {
  cacheResult,
  findCachedResult,
  findContextProcessedEvent,
  runInWriteTransaction,
  writeAuditEvent
} from "./live-helpers";

function getTrustedClientActor(actor: any) {
  if (actor?.role !== "CLIENT" || typeof actor.phone !== "string" || actor.phone.trim() === "") {
    return null;
  }

  return {
    role: "CLIENT",
    phone: actor.phone
  };
}

function getTrustedKitchenActor(actor: any) {
  if (
    actor?.role !== "KITCHEN" ||
    typeof actor.kitchenId !== "string" ||
    actor.kitchenId.trim() === "" ||
    typeof actor.contactId !== "string" ||
    actor.contactId.trim() === ""
  ) {
    return null;
  }

  return {
    role: "KITCHEN",
    kitchenId: actor.kitchenId,
    contactId: actor.contactId,
    ...(typeof actor.phone === "string" && actor.phone.trim() !== "" ? { phone: actor.phone } : {})
  };
}

function getTrustedDelivererActor(actor: any) {
  if (
    actor?.role !== "DELIVERER" ||
    typeof actor.id !== "string" ||
    actor.id.trim() === "" ||
    typeof actor.kitchenId !== "string" ||
    actor.kitchenId.trim() === ""
  ) {
    return null;
  }

  return {
    role: "DELIVERER",
    id: actor.id,
    ...(typeof actor.kitchenId === "string" && actor.kitchenId.trim() !== "" ? { kitchenId: actor.kitchenId } : {})
  };
}

function getTrustedOrderActor(actor: any) {
  if (actor?.role === "CLIENT") {
    return getTrustedClientActor(actor);
  }

  if (actor?.role === "KITCHEN") {
    return getTrustedKitchenActor(actor);
  }

  if (actor?.role === "DELIVERER") {
    return getTrustedDelivererActor(actor);
  }

  return null;
}

function buildKitchenAvailabilityError(kitchen: any) {
  const kitchenStatus = kitchen?.orderingStatus ?? kitchen?.status ?? "CLOSED";
  const schedule = typeof kitchen?.schedule === "string" && kitchen.schedule.trim() !== ""
    ? kitchen.schedule.trim()
    : undefined;

  return {
    ok: false,
    error: "kitchen_not_accepting_orders",
    kitchenStatus,
    ...(schedule ? { schedule } : {}),
    ...(schedule ? { availabilityMessage: `La cocina esta ${String(kitchenStatus).toLowerCase()}. Horario: ${schedule}.` } : {}),
    readyToConfirm: false
  };
}

function matchMenuItem(inputItem: any, menuItems: any[]) {
  const normalizedProductName = normalizeMexicanText(String(inputItem.productName ?? ""));
  const normalizedPortionLabel =
    typeof inputItem.portionLabel === "string" && inputItem.portionLabel.trim() !== ""
      ? normalizeMexicanText(inputItem.portionLabel)
      : null;
  const productMatches = menuItems.filter((item: any) => {
    return (item.normalizedProductName ?? normalizeMexicanText(item.name ?? "")) === normalizedProductName;
  });

  if (productMatches.length === 0) {
    return {
      menuItem: null,
      productChoices: []
    };
  }

  if (normalizedPortionLabel) {
    return {
      menuItem:
        productMatches.find((item: any) => normalizeMexicanText(item.portionLabel) === normalizedPortionLabel) ?? null,
      productChoices: productMatches
    };
  }

  if (productMatches.length === 1) {
    return {
      menuItem: productMatches[0],
      productChoices: productMatches
    };
  }

  const standardPortion = productMatches.find((item: any) => normalizeMexicanText(item.portionLabel) === "standard");

  return {
    menuItem: standardPortion ?? null,
    productChoices: productMatches
  };
}

function summarizePortionChoices(productChoices: any[]) {
  if (productChoices.length === 0) {
    return [];
  }

  return [
    {
      productName: productChoices[0].name,
      portionLabels: productChoices.map((item: any) => item.portionLabel),
      prices: productChoices.map((item: any) => ({
        label: item.portionLabel,
        price: item.price
      }))
    }
  ];
}

function validateSharedStock(orderItems: any[], menuItems: any[]) {
  const quantitiesByProduct = new Map<string, { menuItem: any; requestedQuantity: number }>();

  for (const orderItem of orderItems) {
    const menuItem = menuItems.find((item: any) => item.id === orderItem.menuItemId);

    if (!menuItem) {
      continue;
    }

    const productKey =
      menuItem.productId !== null && menuItem.productId !== undefined
        ? String(menuItem.productId)
        : normalizeMexicanText(menuItem.name);
    const existing = quantitiesByProduct.get(productKey) ?? {
      menuItem,
      requestedQuantity: 0
    };

    existing.requestedQuantity += orderItem.quantity;
    quantitiesByProduct.set(productKey, existing);
  }

  for (const { menuItem, requestedQuantity } of quantitiesByProduct.values()) {
    if (requestedQuantity > menuItem.stockQuantity) {
      return {
        ok: false,
        error: "insufficient_stock",
        soldOutItems: [
          {
            menuItemId: menuItem.id,
            name: menuItem.name,
            requestedQuantity,
            availableQuantity: menuItem.stockQuantity
          }
        ]
      };
    }
  }

  return { ok: true };
}

const REQUIRED_DELIVERY_ADDRESS_FIELDS = [
  "street",
  "exteriorNumber",
  "neighborhood",
  "reference"
] as const;

function normalizeOptionalAddressString(value: unknown) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function normalizePartialAddress(address: unknown) {
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return null;
  }

  const normalized = REQUIRED_DELIVERY_ADDRESS_FIELDS.reduce((result, fieldName) => {
    const fieldValue = normalizeOptionalAddressString((address as Record<string, unknown>)[fieldName]);

    return fieldValue
      ? {
          ...result,
          [fieldName]: fieldValue
        }
      : result;
  }, {} as Record<string, string>);

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function mergeDeliveryAddress(currentAddress: unknown, incomingAddress: unknown) {
  const baseAddress = normalizePartialAddress(currentAddress) ?? {};
  const nextAddress = normalizePartialAddress(incomingAddress);

  if (!nextAddress) {
    return Object.keys(baseAddress).length > 0 ? baseAddress : null;
  }

  return {
    ...baseAddress,
    ...nextAddress
  };
}

function getDeliveryDraftAddress(orderLike: any) {
  return orderLike?.deliveryAddressSnapshot ?? orderLike?.deliveryAddress ?? orderLike?.address ?? null;
}

function getDraftMissingFields(input: {
  deliveryType: string | null | undefined;
  paymentMethod: string | null | undefined;
  address: unknown;
}) {
  const missingFields: string[] = [];

  if (input.deliveryType === "DELIVERY") {
    const normalizedAddress = normalizePartialAddress(input.address);

    for (const fieldName of REQUIRED_DELIVERY_ADDRESS_FIELDS) {
      if (!normalizedAddress?.[fieldName]) {
        missingFields.push(`address.${fieldName}`);
      }
    }
  }

  if (input.paymentMethod === null || input.paymentMethod === undefined) {
    missingFields.push("paymentMethod");
  }

  return missingFields;
}

export async function createOrderDraft(input: any, context: any) {
  const trustedActor = getTrustedClientActor(input.actor);

  if (!trustedActor) {
    return {
      ok: false,
      error: "action_not_allowed",
      readyToConfirm: false
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "createOrderDraft");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed",
      readyToConfirm: false
    };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return {
      ok: false,
      error: "missing_fields",
      missingFields: ["items"],
      readyToConfirm: false
    };
  }

  const kitchenStatus = context.kitchen.orderingStatus ?? context.kitchen.status;

  if (kitchenStatus !== "OPEN") {
    return buildKitchenAvailabilityError(context.kitchen);
  }

  if (input.orderId && !context.existingDraft) {
    return {
      ok: false,
      error: "action_not_allowed",
      readyToConfirm: false
    };
  }

  if (input.orderId && context.existingDraft.clientPhone !== trustedActor.phone) {
    return {
      ok: false,
      error: "action_not_allowed",
      readyToConfirm: false
    };
  }

  if (context.existingDraft?.status !== undefined && context.existingDraft.status !== "DRAFT") {
    return {
      ok: false,
      error: "action_not_allowed",
      readyToConfirm: false
    };
  }

  const allowedDeliveryTypes = ["PICKUP", "DELIVERY"];

  if (input.deliveryType !== null && !allowedDeliveryTypes.includes(input.deliveryType)) {
    return {
      ok: false,
      error: "unsupported_delivery_type",
      allowedDeliveryTypes,
      readyToConfirm: false
    };
  }

  if (input.deliveryType === null) {
    return {
      ok: false,
      error: "missing_fields",
      missingFields: ["deliveryType"],
      readyToConfirm: false
    };
  }

  const allowedPaymentMethods = context.kitchen.paymentOptions ?? ["CASH", "TRANSFER"];

  if (input.paymentMethod !== null && !allowedPaymentMethods.includes(input.paymentMethod)) {
    return {
      ok: false,
      error: "unsupported_payment_method",
      allowedPaymentMethods,
      readyToConfirm: false
    };
  }

  const orderItems = [];

  for (const inputItem of input.items) {
    if (!Number.isInteger(inputItem.quantity) || inputItem.quantity < 1) {
      return {
        ok: false,
        error: "invalid_quantity",
        invalidItems: [
          {
            productName: inputItem.productName,
            quantity: inputItem.quantity
          }
        ],
        readyToConfirm: false
      };
    }

    const matchedMenuItem = matchMenuItem(inputItem, context.menuItems);

    if (!matchedMenuItem.menuItem) {
      if (!inputItem.portionLabel && matchedMenuItem.productChoices.length > 1) {
        return {
          ok: false,
          error: "missing_fields",
          missingFields: ["items.portionLabel"],
          productChoices: summarizePortionChoices(matchedMenuItem.productChoices),
          readyToConfirm: false
        };
      }

      return {
        ok: false,
        error: "product_not_found",
        productChoices: summarizePortionChoices(matchedMenuItem.productChoices),
        readyToConfirm: false
      };
    }

    const resolvedMenuItem = matchedMenuItem.menuItem;

    if (resolvedMenuItem.availabilityStatus !== "AVAILABLE") {
      return {
        ok: false,
        error: "item_sold_out",
        soldOutItems: [
          {
            menuItemId: resolvedMenuItem.id,
            name: resolvedMenuItem.name,
            availabilityStatus: resolvedMenuItem.availabilityStatus
          }
        ],
        readyToConfirm: false
      };
    }

    orderItems.push({
      menuItemId: resolvedMenuItem.id,
      nameSnapshot:
        normalizeMexicanText(resolvedMenuItem.portionLabel ?? "STANDARD") === "standard"
          ? resolvedMenuItem.name
          : `${resolvedMenuItem.name} (${resolvedMenuItem.portionLabel})`,
      quantity: inputItem.quantity,
      unitPriceSnapshot: resolvedMenuItem.price,
      lineTotal: resolvedMenuItem.price * inputItem.quantity
    });
  }

  const stockValidation = validateSharedStock(orderItems, context.menuItems);

  if (!stockValidation.ok) {
    return {
      ...stockValidation,
      readyToConfirm: false
    };
  }

  const deliveryEnabled =
    context.kitchen.deliverySettings?.enabled ??
    context.kitchen.deliveryEnabled ??
    true;

  if (input.deliveryType === "DELIVERY" && !deliveryEnabled) {
    return {
      ok: false,
      error: "unsupported_delivery_type",
      allowedDeliveryTypes: ["PICKUP"],
      readyToConfirm: false
    };
  }

  const deliveryAddress =
    input.deliveryType === "DELIVERY"
      ? mergeDeliveryAddress(getDeliveryDraftAddress(context.existingDraft), input.address)
      : null;

  const subtotal = orderItems.reduce((sum: number, item: any) => sum + item.lineTotal, 0);
  const deliveryFee =
    input.deliveryType === "DELIVERY"
      ? context.kitchen.deliverySettings?.fee ?? context.kitchen.deliveryFee ?? 0
      : 0;

  const order: Record<string, unknown> = {
    status: "DRAFT",
    items: orderItems,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee
  };

  if (input.paymentMethod === "TRANSFER") {
    order.paymentStatus = input.paymentStatus ?? "PENDING";
    if (input.paymentReference) {
      order.paymentReference = input.paymentReference;
    }
  }

  if (input.deliveryType === "DELIVERY" && deliveryAddress) {
    order.address = deliveryAddress;
    order.deliveryAddressSnapshot = deliveryAddress;
  }

  if (context.existingDraft) {
    order.id = context.existingDraft.id;
  }

  if (input.comments) {
    order.comments = input.comments;
  }

  const missingFields = getDraftMissingFields({
    deliveryType: input.deliveryType,
    paymentMethod: input.paymentMethod,
    address: deliveryAddress
  });

  return {
    ok: true,
    order,
    readyToConfirm: missingFields.length === 0,
    nextMissingField: missingFields[0] ?? null,
    ...(missingFields.length > 0 ? { missingFields } : {})
  };
}

function isAllowedTransition({ actorRole, fromStatus, toStatus, deliveryType }: any) {
  if (["DELIVERED", "CANCELLED"].includes(fromStatus)) {
    return false;
  }

  if (actorRole === "CLIENT") {
    return fromStatus === "DRAFT" && ["CONFIRMED", "CANCELLED"].includes(toStatus);
  }

  if (actorRole === "KITCHEN") {
    return (
      (fromStatus === "DRAFT" && toStatus === "CANCELLED") ||
      (fromStatus === "CONFIRMED" &&
        ["DELIVERED", "IN_PROCESS_OF_DELIVERY", "CANCELLED"].includes(toStatus)) ||
      (fromStatus === "IN_PROCESS_OF_DELIVERY" &&
        ["DELIVERED", "CANCELLED"].includes(toStatus))
    );
  }

  if (actorRole === "DELIVERER") {
    return (
      deliveryType === "DELIVERY" &&
      ((fromStatus === "CONFIRMED" && toStatus === "IN_PROCESS_OF_DELIVERY") ||
        (fromStatus === "IN_PROCESS_OF_DELIVERY" && ["DELIVERED", "CANCELLED"].includes(toStatus)))
    );
  }

  return false;
}

export async function changeOrderStatus(input: any, context: any) {
  const trustedActor: any = getTrustedOrderActor(input.actor);

  if (!trustedActor) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "changeOrderStatus");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  if (trustedActor.role === "CLIENT" && context.order.clientPhone !== trustedActor.phone) {
    return {
      ok: false,
      error: "order_not_found"
    };
  }

  const applyStatusChange = () => ({
    ...context.order,
    status: input.targetOrderStatus,
    ...(input.targetOrderStatus === "CANCELLED" && input.cancellationDescription
      ? { cancellationDescription: input.cancellationDescription }
      : {}),
    statusHistory: [
      ...(context.order.statusHistory ?? []),
      {
        fromStatus: context.order.status,
        toStatus: input.targetOrderStatus,
        actorRole: input.actor.role,
        messageId: input.messageId
      }
    ]
  });

  const buildAuditEvent = () => {
    if (!input.actor.contactId && !input.actor.id && !input.actor.phone) {
      return {};
    }

    return {
      auditEvent: {
        type: "order_status_changed",
        orderId: context.order.id,
        fromStatus: context.order.status,
        toStatus: input.targetOrderStatus,
        actorRole: trustedActor.role,
        ...(input.actor.contactId || input.actor.id
          ? { actorId: input.actor.contactId ?? input.actor.id }
          : { actorPhone: trustedActor.role === "CLIENT" ? trustedActor.phone : undefined }),
        messageId: input.messageId
      }
    };
  };

  if (trustedActor.role === "KITCHEN" && context.order.kitchenId !== trustedActor.kitchenId) {
    return {
      ok: false,
      error: "order_not_found"
    };
  }

  if (trustedActor.role === "DELIVERER") {
    if (context.order.kitchenId !== trustedActor.kitchenId || context.order.deliveryType !== "DELIVERY") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    if (input.targetOrderStatus === "IN_PROCESS_OF_DELIVERY") {
      if (
        context.order.deliveryDriverUserId &&
        context.order.deliveryDriverUserId !== trustedActor.id &&
        context.order.assignedDriverId !== trustedActor.id
      ) {
        return {
          ok: false,
          error: "action_not_allowed"
        };
      }
    } else if (
      context.order.deliveryDriverUserId !== trustedActor.id &&
      context.order.assignedDriverId !== trustedActor.id
    ) {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }
  }

  if (
    !isAllowedTransition({
      actorRole: trustedActor.role,
      fromStatus: context.order.status,
      toStatus: input.targetOrderStatus,
      deliveryType: context.order.deliveryType
    })
  ) {
    return {
      ok: false,
      error: "invalid_status_transition",
      currentStatus: context.order.status,
      requestedStatus: input.targetOrderStatus
    };
  }

  if (input.targetOrderStatus === "CONFIRMED") {
    const missingFields = getDraftMissingFields({
      deliveryType: context.order.deliveryType,
      paymentMethod: context.order.paymentMethod,
      address: getDeliveryDraftAddress(context.order)
    });

    if (missingFields.length > 0) {
      return {
        ok: false,
        error: "missing_fields",
        missingFields,
        nextMissingField: missingFields[0] ?? null
      };
    }
  }

  if (input.targetOrderStatus === "CONFIRMED") {
    const kitchenStatus = context.kitchen?.orderingStatus ?? context.kitchen?.status;

    if (kitchenStatus !== "OPEN") {
      return buildKitchenAvailabilityError(context.kitchen);
    }

    const stockValidation = validateSharedStock(context.order.items, context.menuItems ?? []);

    if (!stockValidation.ok) {
      return stockValidation;
    }
  }

  if (input.targetOrderStatus === "CONFIRMED" && context.confirmOrderAtomically) {
    try {
      const order = await context.confirmOrderAtomically({
        orderId: context.order.id,
        items: context.order.items.map((item: any) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity
        }))
      });

      return {
        ok: true,
        order,
        ...buildAuditEvent()
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.code
      };
    }
  }

  return {
    ok: true,
    order: applyStatusChange(),
    ...buildAuditEvent()
  };
}

export async function getOrder(input: any, context: any) {
  const trustedActor: any = getTrustedOrderActor(input.actor);

  if (!trustedActor) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  if (!context.order) {
    return {
      ok: false,
      error: "order_not_found"
    };
  }

  switch (trustedActor.role) {
    case "CLIENT":
      if (context.order.clientPhone !== trustedActor.phone) {
        return {
          ok: false,
          error: "order_not_found"
        };
      }
      break;
    case "KITCHEN":
      if (context.order.kitchenId !== trustedActor.kitchenId) {
        return {
          ok: false,
          error: "order_not_found"
        };
      }
      break;
    case "DELIVERER":
      if (
        context.order.kitchenId !== trustedActor.kitchenId ||
        context.order.deliveryType !== "DELIVERY" ||
        (context.order.assignedDriverId && context.order.assignedDriverId !== trustedActor.id)
      ) {
        return {
          ok: false,
          error: "order_not_found"
        };
      }
      break;
    default:
      return {
        ok: false,
        error: "action_not_allowed"
      };
  }

  return {
    ok: true,
    order: {
      id: context.order.id,
      status: context.order.status,
      total: context.order.total,
      ...(trustedActor.role === "KITCHEN"
        ? { clientPhone: context.order.clientPhone }
        : {}),
      ...(trustedActor.role === "DELIVERER"
        ? {
            deliveryAddress:
              context.order.deliveryAddressSnapshot ?? context.order.deliveryAddress
          }
        : {}),
      items: context.order.items.map((item: any) => ({
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPriceSnapshot,
        lineTotal: item.lineTotal
      }))
    }
  };
}

export async function queryOrders(input: any, context: any) {
  const trustedActor: any = getTrustedOrderActor(input.actor);

  if (!trustedActor) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const allowedFilters = [
    "active",
    "pending",
    "completed",
    "delivery_pending",
    "payment_pending"
  ];

  if (!allowedFilters.includes(input.filter)) {
    return {
      ok: false,
      error: "unsupported_filter"
    };
  }

  if (trustedActor.role === "CLIENT") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const activeStatuses = ["CONFIRMED", "IN_PROCESS_OF_DELIVERY"];

  const matchingOrders = context.orders.filter((order: any) => {
    return isVisibleToActor(order, trustedActor) && matchesFilter(order, input.filter);
  });

  function isVisibleToActor(order: any, actor: any) {
    if (actor.role === "DELIVERER") {
      return (
        order.kitchenId === actor.kitchenId &&
        order.deliveryType === "DELIVERY" &&
        (!order.assignedDriverId || order.assignedDriverId === actor.id)
      );
    }

    return order.kitchenId === actor.kitchenId;
  }

  function matchesFilter(order: any, filter: string) {
    if (filter === "active") {
      return activeStatuses.includes(order.status);
    }

    if (filter === "pending") {
      return order.status === "DRAFT";
    }

    if (filter === "completed") {
      return ["DELIVERED", "CANCELLED"].includes(order.status);
    }

    if (filter === "delivery_pending") {
      return order.deliveryType === "DELIVERY" &&
        ["CONFIRMED", "IN_PROCESS_OF_DELIVERY"].includes(order.status);
    }

    if (filter === "payment_pending") {
      return order.paymentMethod === "TRANSFER" && order.paymentStatus === "PENDING";
    }

    return false;
  }

  const pageOrders = input.limit ? matchingOrders.slice(0, input.limit) : matchingOrders;
  const nextOrder = input.limit ? matchingOrders[input.limit] : undefined;

  return {
    ok: true,
    orders: pageOrders.map((order: any) => ({
      id: order.id,
      status: order.status,
      total: order.total
    })),
    ...(nextOrder ? { nextCursor: nextOrder.id } : {})
  };
}

export async function executeCreateOrderDraft(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "createOrderDraft");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed",
        readyToConfirm: false
      };
    }

    const kitchen = await transactionDeps.kitchens.getById(input.kitchenId);
    const menuItems = await transactionDeps.orders.getCurrentMenuItems(input.kitchenId);
    const existingDraft = await transactionDeps.orders.getExistingDraft({
      kitchenId: input.kitchenId,
      orderId: input.orderId,
      phone: input.actor.phone
    });
    const result: any = await createOrderDraft(input, {
      kitchen,
      menuItems,
      existingDraft
    });

    if (!result.ok) {
      return result;
    }

    const persistedOrder = await transactionDeps.orders.saveDraft({
      input,
      draft: result.order
    });
    const finalResult = {
      ...result,
      order: {
        ...(persistedOrder.id ? { id: persistedOrder.id } : {}),
        status: persistedOrder.status,
        ...(persistedOrder.deliveryAddressSnapshot ? { address: persistedOrder.deliveryAddressSnapshot, deliveryAddressSnapshot: persistedOrder.deliveryAddressSnapshot } : {}),
        items: persistedOrder.items,
        subtotal: persistedOrder.subtotal,
        deliveryFee: persistedOrder.deliveryFee,
        total: persistedOrder.total,
        ...(persistedOrder.paymentStatus ? { paymentStatus: persistedOrder.paymentStatus } : {}),
        ...(persistedOrder.paymentReference ? { paymentReference: persistedOrder.paymentReference } : {}),
        ...(persistedOrder.comments ? { comments: persistedOrder.comments } : {})
      }
    };

    await transactionDeps.activityLogs.create({
      kitchenId: input.kitchenId,
      userId: null,
      entityType: "order",
      entityId: persistedOrder.id,
      eventType: "ORDER_DRAFT_UPDATED",
      description: "order_draft_updated",
      metadata: finalResult.order
    });
    await cacheResult(transactionDeps, input, "createOrderDraft", finalResult);

    return finalResult;
  });
}

export async function executeChangeOrderStatus(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const order = await transactionDeps.orders.getById(input.orderId);
    const kitchenId = order?.kitchenId ?? input.actor.kitchenId ?? null;
    const kitchen = order?.kitchenId ? await transactionDeps.kitchens.getById(order.kitchenId) : null;
    const cached = await findCachedResult(
      transactionDeps,
      {
        ...input,
        kitchenId
      },
      "changeOrderStatus"
    );

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const menuItems = order ? await transactionDeps.orders.getCurrentMenuItems(order.kitchenId) : [];
    const result: any = await changeOrderStatus(input, {
      order,
      kitchen,
      menuItems,
      confirmOrderAtomically: (args: any) => transactionDeps.orders.confirmOrderAtomically(args)
    });

    if (!result.ok) {
      return result;
    }

    const persistedOrder =
      input.targetOrderStatus === "CONFIRMED"
        ? result.order
        : await transactionDeps.orders.changeStatus({
            orderId: input.orderId,
            targetOrderStatus: input.targetOrderStatus,
            cancellationDescription: input.cancellationDescription,
            deliveryDriverUserId: input.targetOrderStatus === "IN_PROCESS_OF_DELIVERY"
              ? input.actor.role === "DELIVERER"
                ? input.actor.id
                : input.actor.role === "KITCHEN"
                  ? input.deliveryDriverUserId
                  : undefined
              : undefined
          });
    const finalOrder = {
      ...persistedOrder,
      ...(result.order.statusHistory ? { statusHistory: result.order.statusHistory } : {})
    };
    const finalResult = {
      ...result,
      order: finalOrder
    };

    await writeAuditEvent(transactionDeps, result.auditEvent);
    await cacheResult(
      transactionDeps,
      {
        ...input,
        kitchenId: finalOrder.kitchenId ?? kitchenId
      },
      "changeOrderStatus",
      finalResult
    );

    return finalResult;
  });
}

export async function executeGetOrder(input: any, deps: any = repositories) {
  const order = await deps.orders.getById(input.orderId);
  return getOrder(input, { order });
}

export async function executeQueryOrders(input: any, deps: any = repositories) {
  const earlyResult = await queryOrders(input, { orders: [] });

  if (!earlyResult.ok) {
    return earlyResult;
  }

  const orders = await deps.orders.query({
    filter: input.filter,
    kitchenId: input.actor.kitchenId,
    ...(input.actor.role === "DELIVERER" && input.actor.id
      ? { delivererUserId: input.actor.id }
      : {})
  });

  return queryOrders(input, { orders });
}
