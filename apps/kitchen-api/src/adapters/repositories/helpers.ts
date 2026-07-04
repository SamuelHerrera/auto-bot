import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeMexicanPhone, normalizeMexicanText } from "../../shared/normalize";
import { serializeResult } from "../../shared/serialize";

export function toBigIntId(value: string | number | bigint | null | undefined, fieldName: string) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`${fieldName} is required`);
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error(`${fieldName} must be a valid integer value`);
  }
}

export function toOptionalBigIntId(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function toDecimal(value: Prisma.Decimal | string | number | bigint) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value as any);
}

export function toMoneyNumber(value: unknown) {
  if (value instanceof Prisma.Decimal) {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  return Number(value ?? 0);
}

export function serializeEntity<T>(value: T) {
  return serializeResult(value) as T;
}

export function buildAddressLine(address: Record<string, unknown>) {
  const parts = [
    address.addressLine,
    address.street,
    address.exteriorNumber,
    address.interiorNumber,
    address.neighborhood,
    address.municipality,
    address.city,
    address.state,
    address.postalCode,
    address.reference
  ];

  return parts
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

export function normalizeAddress(address: Record<string, unknown>) {
  return [
    address.addressLine,
    address.street,
    address.exteriorNumber,
    address.interiorNumber,
    address.neighborhood,
    address.municipality,
    address.city,
    address.state,
    address.postalCode,
    address.reference
  ]
    .filter(Boolean)
    .map((part) => normalizeMexicanText(part))
    .join("|");
}

export function mapKitchenToView(kitchen: any) {
  return serializeEntity({
    id: kitchen.id,
    name: kitchen.name,
    description: kitchen.description,
    schedule: kitchen.schedule,
    setupStatus: kitchen.setupStatus,
    orderingStatus: kitchen.orderingStatus,
    businessVoice: kitchen.businessVoice,
    paymentOptions: kitchen.paymentOptions,
    deliveryEnabled: kitchen.deliveryEnabled,
    deliveryFee: kitchen.deliveryFee,
    deliverySettings: {
      enabled: kitchen.deliveryEnabled,
      fee: kitchen.deliveryFee
    }
  });
}

export function mapMenuToContext(menu: any) {
  if (!menu) {
    return null;
  }

  return serializeEntity({
    id: menu.id,
    kitchenId: menu.kitchenId,
    items: menu.menuItems.map((item: any) => ({
      id: item.id,
      menuId: item.menuId,
      productPortionId: item.productPortionId,
      productId: item.productPortion?.product?.id ?? null,
      normalizedProductName:
        item.productPortion?.product?.normalizedName ??
        normalizeMexicanText(item.productPortion?.product?.name ?? item.displayName ?? ""),
      name: item.productPortion?.product?.name ?? item.displayName,
      displayName: item.displayName,
      description: item.description ?? item.productPortion?.product?.description ?? null,
      portionLabel: item.productPortion?.portion?.size ?? "STANDARD",
      price: item.price,
      stockQuantity: item.stockQuantity,
      availabilityStatus: item.availabilityStatus
    }))
  });
}

export function mapAddressToView(address: any) {
  return serializeEntity({
    id: address.id,
    addressLine: address.addressLine,
    street: address.street,
    exteriorNumber: address.exteriorNumber,
    interiorNumber: address.interiorNumber,
    neighborhood: address.neighborhood,
    municipality: address.municipality,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    reference: address.reference,
    description: address.description
  });
}

export function computeOrderSubtotal(orderItems: Array<{ quantity: number; unitPrice: unknown }>) {
  return orderItems.reduce((sum, item) => sum + toMoneyNumber(item.unitPrice) * item.quantity, 0);
}

export function mapOrderToContext(order: any) {
  const items = order.orderItems.map((item: any) => ({
    id: item.id,
    menuItemId: item.menuItemId,
    productPortionId: item.productPortionId,
    nameSnapshot: item.nameSnapshot,
    quantity: item.quantity,
    unitPriceSnapshot: toMoneyNumber(item.unitPrice),
    lineTotal: toMoneyNumber(item.unitPrice) * item.quantity
  }));
  const subtotal = computeOrderSubtotal(
    order.orderItems.map((item: any) => ({ quantity: item.quantity, unitPrice: item.unitPrice }))
  );
  const deliveryFee = toMoneyNumber(order.deliveryFee);

  return serializeEntity({
    id: order.id,
    kitchenId: order.kitchenId,
    clientUserId: order.clientUserId,
    clientPhone: order.linkedPhone?.phone,
    linkedPhoneId: order.linkedPhoneId,
    addressId: order.addressId,
    deliveryDriverUserId: order.deliveryDriverUserId,
    assignedDriverId: order.deliveryDriverUserId,
    deliveryType: order.deliveryType,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentReference: order.paymentReference,
    status: order.status,
    printStatus: order.printStatus,
    revision: order.revision,
    orderNumber: order.orderNumber,
    comments: order.comments,
    cancellationDescription: order.cancellationDescription,
    deliveryFee,
    subtotal,
    total: subtotal + deliveryFee,
    deliveryAddressSnapshot: order.deliveryAddressSnapshot,
    deliveryAddress: order.deliveryAddressSnapshot ?? (order.address ? mapAddressToView(order.address) : null),
    items
  });
}

export async function resolveOrCreateClientIdentity(
  db: PrismaClient | Prisma.TransactionClient,
  kitchenIdInput: string | number | bigint,
  phone: string,
  name?: string | null
) {
  const kitchenId = toBigIntId(kitchenIdInput, "kitchenId");
  const normalizedPhone = normalizeMexicanPhone(phone);
  const linkedPhone = await db.linkedPhone.findFirst({
    where: {
      kitchenId,
      normalizedPhone
    },
    include: {
      user: true
    },
    orderBy: { id: "desc" }
  });

  if (linkedPhone?.user) {
    if (name && linkedPhone.user.name !== name) {
      await db.user.update({
        where: { id: linkedPhone.user.id },
        data: { name }
      });
    }

    return {
      userId: linkedPhone.user.id,
      linkedPhoneId: linkedPhone.id
    };
  }

  const user = await db.user.create({
    data: {
      kitchenId,
      role: "CLIENT",
      name: name?.trim() || phone
    }
  });

  const createdLinkedPhone = linkedPhone
    ? await db.linkedPhone.update({
        where: { id: linkedPhone.id },
        data: { userId: user.id, phone, normalizedPhone }
      })
    : await db.linkedPhone.create({
        data: {
          kitchenId,
          userId: user.id,
          phone,
          normalizedPhone
        }
      });

  return {
    userId: user.id,
    linkedPhoneId: createdLinkedPhone.id
  };
}

export async function resolveOrCreateAddress(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    kitchenId: string | number | bigint;
    userId: string | number | bigint;
    address?: Record<string, unknown> | null;
  }
) {
  if (!input.address) {
    return null;
  }

  const kitchenId = toBigIntId(input.kitchenId, "kitchenId");
  const userId = toBigIntId(input.userId, "userId");
  const normalizedAddress = normalizeAddress(input.address);

  const existing = await db.address.findFirst({
    where: {
      kitchenId,
      userId,
      normalizedAddress
    },
    orderBy: { id: "asc" }
  });

  if (existing) {
    return existing;
  }

  return db.address.create({
    data: {
      kitchenId,
      userId,
      addressLine: buildAddressLine(input.address) || String(input.address.addressLine ?? "Address"),
      street: (input.address.street as string | undefined) ?? null,
      exteriorNumber: (input.address.exteriorNumber as string | undefined) ?? null,
      interiorNumber: (input.address.interiorNumber as string | undefined) ?? null,
      neighborhood: (input.address.neighborhood as string | undefined) ?? null,
      municipality: (input.address.municipality as string | undefined) ?? null,
      city: (input.address.city as string | undefined) ?? null,
      state: (input.address.state as string | undefined) ?? null,
      postalCode: (input.address.postalCode as string | undefined) ?? null,
      reference: (input.address.reference as string | undefined) ?? null,
      description: (input.address.description as string | undefined) ?? null,
      normalizedAddress
    }
  });
}
