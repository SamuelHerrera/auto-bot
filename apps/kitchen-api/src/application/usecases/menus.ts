import { normalizeMexicanText } from "../../shared/normalize";
import { repositories } from "../../infrastructure/container";
import {
  cacheResult,
  findCachedResult,
  findContextProcessedEvent,
  runInWriteTransaction,
  writeAuditEvent
} from "./live-helpers";

function isTrustedKitchenActor(actor: any, kitchenId: string) {
  return Boolean(
    actor?.role === "KITCHEN" &&
      typeof actor.kitchenId === "string" &&
      actor.kitchenId === kitchenId &&
      typeof actor.contactId === "string" &&
      actor.contactId.trim() !== ""
  );
}

function canViewKitchenStock(actor: any, kitchenId: string) {
  return isTrustedKitchenActor(actor, kitchenId);
}

function buildAvailability(kitchen: any) {
  const orderingStatus = kitchen.orderingStatus ?? kitchen.status ?? "CLOSED";

  return {
    acceptingOrders: orderingStatus === "OPEN",
    ...(orderingStatus === "OPEN"
      ? {}
      : {
          reason: String(orderingStatus).toLowerCase(),
          ...(typeof kitchen.schedule === "string" && kitchen.schedule.trim() !== ""
            ? { schedule: kitchen.schedule.trim() }
            : {})
        })
  };
}

function groupCurrentMenuProducts(currentMenu: any, actor: any) {
  const includeStock = canViewKitchenStock(actor, currentMenu.kitchenId);
  const visibleItems = currentMenu.items.filter((item: any) => {
    if (includeStock) {
      return true;
    }

    return item.availabilityStatus === "AVAILABLE";
  });
  const groupedProducts = new Map<string, any>();

  for (const item of visibleItems) {
    const productKey =
      item.productId !== null && item.productId !== undefined
        ? String(item.productId)
        : `${item.normalizedProductName ?? normalizeMexicanText(item.name ?? "")}`;
    const existing = groupedProducts.get(productKey) ?? {
      productId: item.productId ?? null,
      name: item.name,
      availabilityStatus: item.availabilityStatus,
      portions: []
    };

    existing.portions.push({
      menuItemId: item.id,
      label: item.portionLabel ?? "STANDARD",
      price: item.price,
      availabilityStatus: item.availabilityStatus,
      ...(includeStock ? { stockQuantity: item.stockQuantity } : {})
    });
    existing.availabilityStatus = mergeAvailabilityStatus(existing.availabilityStatus, item.availabilityStatus);
    groupedProducts.set(productKey, existing);
  }

  return [...groupedProducts.values()]
    .map((product) => ({
      ...product,
      portions: product.portions.sort((left: any, right: any) => {
        return Number(left.price) - Number(right.price) || String(left.label).localeCompare(String(right.label));
      })
    }))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function mergeAvailabilityStatus(currentStatus: string, nextStatus: string) {
  const priority = {
    AVAILABLE: 3,
    SOLD_OUT: 2,
    HIDDEN: 1
  } as const;

  return (priority[nextStatus as keyof typeof priority] ?? 0) > (priority[currentStatus as keyof typeof priority] ?? 0)
    ? nextStatus
    : currentStatus;
}

function normalizeMenuProducts(products: Array<Record<string, unknown>>) {
  const normalizedNames = new Set();

  for (const product of products) {
    if (typeof product.name !== "string" || product.name.trim() === "") {
      return {
        ok: false,
        error: "invalid_menu_item",
        field: "product.name"
      };
    }

    const normalizedProductName = normalizeMexicanText(product.name);

    if (normalizedNames.has(normalizedProductName)) {
      return {
        ok: false,
        error: "duplicate_product"
      };
    }

    normalizedNames.add(normalizedProductName);

    if (!Number.isInteger(product.stockQuantity) || Number(product.stockQuantity) < 0) {
      return {
        ok: false,
        error: "invalid_menu_item",
        field: "product.stockQuantity"
      };
    }

    if (!Array.isArray(product.portions) || product.portions.length === 0) {
      return {
        ok: false,
        error: "missing_fields",
        missingFields: ["product.portions"]
      };
    }

    const normalizedPortionLabels = new Set();

    for (const portion of product.portions as Array<Record<string, unknown>>) {
      if (typeof portion.label !== "string" || portion.label.trim() === "") {
        return {
          ok: false,
          error: "invalid_menu_item",
          field: "product.portions.label"
        };
      }

      const normalizedPortionLabel = normalizeMexicanText(portion.label);

      if (normalizedPortionLabels.has(normalizedPortionLabel)) {
        return {
          ok: false,
          error: "duplicate_product"
        };
      }

      normalizedPortionLabels.add(normalizedPortionLabel);

      if (typeof portion.price !== "number" || portion.price <= 0) {
        return {
          ok: false,
          error: "invalid_menu_item",
          field: "product.portions.price"
        };
      }

      if (
        portion.availabilityStatus !== undefined &&
        !["AVAILABLE", "SOLD_OUT", "HIDDEN"].includes(String(portion.availabilityStatus))
      ) {
        return {
          ok: false,
          error: "invalid_menu_item",
          field: "product.portions.availabilityStatus"
        };
      }
    }
  }

  return { ok: true };
}

export async function publishMenu(input: any, context: any) {
  if (!isTrustedKitchenActor(input.actor, input.kitchenId)) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "publishMenu");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const normalizedNames = new Set();

  for (const item of input.items) {
    if (typeof item.name !== "string" || item.name.trim() === "") {
      return {
        ok: false,
        error: "invalid_menu_item",
        field: "name"
      };
    }

    const normalizedName = normalizeMexicanText(item.name);

    if (normalizedNames.has(normalizedName)) {
      return {
        ok: false,
        error: "duplicate_product"
      };
    }

    normalizedNames.add(normalizedName);

    if (typeof item.price !== "number" || item.price <= 0) {
      return {
        ok: false,
        error: "invalid_menu_item",
        field: "price"
      };
    }

    if (typeof item.stockQuantity !== "number" || item.stockQuantity < 0) {
      return {
        ok: false,
        error: "invalid_menu_item",
        field: "stockQuantity"
      };
    }

    if (!["AVAILABLE", "SOLD_OUT", "HIDDEN"].includes(item.availabilityStatus)) {
      return {
        ok: false,
        error: "invalid_menu_item",
        field: "availabilityStatus"
      };
    }
  }

  const publishedItems = input.items.map((item: any) => {
    const normalizedName = normalizeMexicanText(item.name);
    const existingItem = context.currentMenu?.items.find((currentItem: any) => {
      return normalizeMexicanText(currentItem.name) === normalizedName;
    });

    return {
      ...(existingItem ? { id: existingItem.id } : {}),
      name: existingItem ? normalizedName : item.name,
      price: item.price,
      stockQuantity: item.stockQuantity,
      availabilityStatus: item.availabilityStatus
    };
  });

  const publishedNames = new Set(input.items.map((item: any) => normalizeMexicanText(item.name)));
  const omittedExistingItems =
    context.currentMenu?.items.filter((item: any) => !publishedNames.has(normalizeMexicanText(item.name))) ?? [];

  return {
    ok: true,
    menu: {
      kitchenId: input.kitchenId,
      status: "PUBLISHED",
      isCurrent: true,
      items: [...publishedItems, ...omittedExistingItems]
    },
    ...(input.actor.contactId
      ? {
          auditEvent: {
            type: "menu_published",
            kitchenId: input.kitchenId,
            actorRole: input.actor.role,
            actorId: input.actor.contactId,
            messageId: input.messageId
          }
        }
      : {})
  };
}

export async function upsertMenuProduct(input: any) {
  if (!isTrustedKitchenActor(input.actor, input.kitchenId)) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, {}, "upsertMenuProduct");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const validation = normalizeMenuProducts([input.product]);

  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    product: {
      name: input.product.name,
      stockQuantity: input.product.stockQuantity,
      portions: input.product.portions.map((portion: any) => ({
        label: portion.label,
        price: portion.price,
        availabilityStatus: portion.availabilityStatus ?? "AVAILABLE"
      }))
    },
    auditEvent: {
      type: "menu_product_upserted",
      kitchenId: input.kitchenId,
      actorRole: input.actor.role,
      actorId: input.actor.contactId,
      messageId: input.messageId
    }
  };
}

export async function getCurrentMenu(input: any, context: any) {
  const currentMenu =
    context.currentMenu?.kitchenId === input.kitchenId
      ? context.currentMenu
      : null;

  return {
    ok: true,
    availability: buildAvailability(context.kitchen),
    menu: currentMenu
      ? {
          id: currentMenu.id,
          products: groupCurrentMenuProducts(currentMenu, input.actor)
        }
      : null
  };
}

export async function executePublishMenu(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "publishMenu");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const currentMenu = await transactionDeps.menus.getCurrentMenu(input.kitchenId);
    const result: any = await publishMenu(input, {
      currentMenu
    });

    if (!result.ok) {
      return result;
    }

    const persistedMenu = await transactionDeps.menus.publishMenu({
      kitchenId: input.kitchenId,
      items: result.menu.items
    });
    const finalResult = {
      ...result,
      menu: {
        kitchenId: input.kitchenId,
        status: "PUBLISHED",
        isCurrent: true,
        items: persistedMenu.items.map((item: any) => ({
          ...(item.id ? { id: item.id } : {}),
          name: item.name,
          price: item.price,
          stockQuantity: item.stockQuantity,
          availabilityStatus: item.availabilityStatus
        }))
      }
    };

    await writeAuditEvent(transactionDeps, result.auditEvent);
    await cacheResult(transactionDeps, input, "publishMenu", finalResult);

    return finalResult;
  });
}

export async function executeUpsertMenuProduct(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "upsertMenuProduct");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const result: any = await upsertMenuProduct(input);

    if (!result.ok) {
      return result;
    }

    const persistedProduct = await transactionDeps.menus.upsertMenuProduct({
      kitchenId: input.kitchenId,
      product: result.product
    });
    const finalResult = {
      ...result,
      product: persistedProduct
    };

    await writeAuditEvent(transactionDeps, result.auditEvent);
    await cacheResult(transactionDeps, input, "upsertMenuProduct", finalResult);

    return finalResult;
  });
}

export async function executeGetCurrentMenu(input: any, deps: any = repositories) {
  const kitchen = await deps.kitchens.getById(input.kitchenId);
  const currentMenu = await deps.menus.getCurrentMenu(input.kitchenId);

  return getCurrentMenu(input, {
    kitchen: kitchen ?? { id: input.kitchenId, orderingStatus: "CLOSED" },
    currentMenu
  });
}
