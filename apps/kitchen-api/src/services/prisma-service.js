const { Prisma } = require("@prisma/client");
const { prisma } = require("../db/prisma");

const ACTIVE_ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PROCESS_OF_DELIVERY"
];

const FILTER_STATUS_MAP = {
  active: ACTIVE_ORDER_STATUSES,
  pending: ["DRAFT"],
  completed: ["DELIVERED", "CANCELLED"],
  delivery_pending: ["CONFIRMED", "IN_PROCESS_OF_DELIVERY"],
  payment_pending: ["CONFIRMED", "IN_PROCESS_OF_DELIVERY"]
};

const STATUS_TRANSITIONS = {
  CLIENT: {
    DRAFT: ["CONFIRMED", "CANCELLED"]
  },
  KITCHEN: {
    DRAFT: ["CANCELLED"],
    CONFIRMED: ["DELIVERED", "IN_PROCESS_OF_DELIVERY", "CANCELLED"],
    IN_PROCESS_OF_DELIVERY: ["DELIVERED", "CANCELLED"]
  },
  DELIVERER: {
    IN_PROCESS_OF_DELIVERY: ["DELIVERED", "CANCELLED"]
  }
};

function toBigInt(value, fieldName) {
  if (value === null || value === undefined) {
    return value;
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error(`${fieldName} must be a valid integer value`);
  }
}

function asDecimal(value) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function serializeBigInt(value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function normalizeMexicanText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeMexicanPhone(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");

  if (digits.length === 13 && digits.startsWith("521")) {
    digits = `52${digits.slice(3)}`;
  }

  if (digits.length === 10) {
    digits = `52${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("52")) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

function normalizeAddress(data) {
  return [
    data.addressLine,
    data.street,
    data.exteriorNumber,
    data.interiorNumber,
    data.neighborhood,
    data.municipality,
    data.city,
    data.state,
    data.postalCode,
    data.reference
  ]
    .filter(Boolean)
    .map(normalizeMexicanText)
    .join("|");
}

function serializeEntity(entity) {
  if (Array.isArray(entity)) {
    return entity.map(serializeEntity);
  }

  if (Prisma.Decimal.isDecimal?.(entity) || entity instanceof Prisma.Decimal) {
    return Number(entity);
  }

  if (entity && typeof entity === "object" && !(entity instanceof Date)) {
    return Object.fromEntries(
      Object.entries(entity).map(([key, value]) => [key, serializeEntity(value)])
    );
  }

  return serializeBigInt(entity);
}

function normalizeKitchenDescription(description) {
  if (description === undefined) {
    return undefined;
  }

  if (description === null) {
    return null;
  }

  return typeof description === "string" ? description : JSON.stringify(description);
}

function computeOrderTotal(orderItems) {
  return orderItems.reduce(
    (sum, item) => sum + Number(item.unitPrice) * item.quantity,
    0
  );
}

function serializeOrder(order) {
  return serializeEntity({
    id: order.id,
    kitchenId: order.kitchenId,
    clientUserId: order.clientUserId,
    linkedPhoneId: order.linkedPhoneId,
    addressId: order.addressId,
    deliveryDriverUserId: order.deliveryDriverUserId,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    printStatus: order.printStatus,
    comments: order.comments,
    cancellationDescription: order.cancellationDescription,
    deliveryType: order.deliveryType,
    estimatedReadyAt: order.estimatedReadyAt,
    confirmedAt: order.confirmedAt,
    printedAt: order.printedAt,
    scheduledDeliveryAt: order.scheduledDeliveryAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    total: computeOrderTotal(order.orderItems),
    items: order.orderItems.map((item) => ({
      id: item.id,
      productPortionId: item.productPortionId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      productName: item.productPortion.product.name,
      portionSize: item.productPortion.portion.size
    }))
  });
}

async function logActivity(tx, {
  kitchenId = null,
  userId = null,
  entityType = null,
  entityId = null,
  eventType = null,
  description,
  metadata = null
}) {
  return tx.activityLog.create({
    data: {
      kitchenId,
      userId,
      entityType,
      entityId,
      eventType,
      description,
      metadata: metadata ? JSON.stringify(metadata) : null
    }
  });
}

async function createKitchen(data) {
  const description = normalizeKitchenDescription(data.description);

  return prisma.kitchen.create({
    data: {
      name: data.name,
      description: description ?? null,
      zone: data.zone ?? null,
      schedule: data.schedule ?? null,
      printerIdentifier: data.printerIdentifier ?? null,
      setupStatus: data.setupStatus ?? "PENDING_SETUP"
    }
  });
}

async function saveKitchenConfiguration(data) {
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");

  const kitchen = await prisma.kitchen.update({
    where: { id: kitchenId },
    data: {
      description: normalizeKitchenDescription(data.configuration),
      zone: data.zone ?? undefined,
      schedule: data.schedule ?? undefined,
      printerIdentifier: data.printerIdentifier ?? undefined,
      setupStatus: data.setupStatus ?? undefined
    }
  });

  return serializeEntity(kitchen);
}

async function createUser(data) {
  const kitchenId = data.kitchenId ? toBigInt(data.kitchenId, "kitchenId") : null;

  if (data.role === "KITCHEN" && !kitchenId) {
    throw new Error("kitchenId is required when role is KITCHEN");
  }

  return prisma.user.create({
    data: {
      name: data.name,
      role: data.role,
      kitchenId
    }
  });
}

async function linkPhoneToUser(data) {
  const userId = toBigInt(data.userId, "userId");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId }
  });

  if (!user.kitchenId) {
    throw new Error("kitchenId is required before linking a phone to a user");
  }

  return prisma.linkedPhone.create({
    data: {
      userId,
      kitchenId: user.kitchenId,
      phone: data.phone,
      normalizedPhone: normalizeMexicanPhone(data.phone)
    }
  });
}

async function linkAddressToUser(data) {
  const userId = toBigInt(data.userId, "userId");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId }
  });

  if (!user.kitchenId) {
    throw new Error("kitchenId is required before linking an address to a user");
  }

  return prisma.address.create({
    data: {
      userId,
      kitchenId: user.kitchenId,
      addressLine: data.addressLine,
      street: data.street ?? null,
      exteriorNumber: data.exteriorNumber ?? null,
      interiorNumber: data.interiorNumber ?? null,
      neighborhood: data.neighborhood ?? null,
      municipality: data.municipality ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      postalCode: data.postalCode ?? null,
      reference: data.reference ?? null,
      normalizedAddress: normalizeAddress(data),
      description: data.description ?? null
    }
  });
}

async function linkUserToKitchen(data) {
  const userId = toBigInt(data.userId, "userId");
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");

  await prisma.kitchen.findUniqueOrThrow({
    where: { id: kitchenId }
  });

  return prisma.user.update({
    where: { id: userId },
    data: { kitchenId }
  });
}

async function resolveOrCreateProductPortion(tx, kitchenId, item) {
  let product = await tx.product.findFirst({
    where: {
      kitchenId,
      name: item.productName
    }
  });

  if (!product) {
    product = await tx.product.create({
      data: {
        kitchenId,
        name: item.productName,
        normalizedName: normalizeMexicanText(item.productName),
        description: item.productDescription ?? null,
        stock: item.productStock ?? item.stockQuantity ?? 0
      }
    });
  } else if (item.productDescription !== undefined || item.productStock !== undefined) {
    product = await tx.product.update({
      where: { id: product.id },
      data: {
        description: item.productDescription ?? product.description,
        normalizedName: normalizeMexicanText(item.productName),
        stock: item.productStock ?? product.stock
      }
    });
  }

  let portion = await tx.portion.findFirst({
    where: {
      size: item.portionSize,
      price: asDecimal(item.portionPrice)
    }
  });

  if (!portion) {
    portion = await tx.portion.create({
      data: {
        size: item.portionSize,
        price: asDecimal(item.portionPrice)
      }
    });
  }

  let productPortion = await tx.productPortion.findUnique({
    where: {
      productId_portionId: {
        productId: product.id,
        portionId: portion.id
      }
    }
  });

  if (!productPortion) {
    productPortion = await tx.productPortion.create({
      data: {
        productId: product.id,
        portionId: portion.id
      }
    });
  }

  return { product, portion, productPortion };
}

async function createMenu(data) {
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");
  const createdByUserId = data.createdByUserId
    ? toBigInt(data.createdByUserId, "createdByUserId")
    : null;
  const menuId = data.menuId ? toBigInt(data.menuId, "menuId") : null;

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  return prisma.$transaction(async (tx) => {
    await tx.kitchen.findUniqueOrThrow({
      where: { id: kitchenId }
    });

    if (createdByUserId) {
      await tx.user.findUniqueOrThrow({
        where: { id: createdByUserId }
      });
    }

    if (data.isCurrent) {
      await tx.menu.updateMany({
        where: { kitchenId },
        data: { isCurrent: false }
      });
    }

    const menu = menuId
      ? await tx.menu.update({
          where: { id: menuId },
          data: {
            name: data.name,
            status: data.status ?? "DRAFT",
            isCurrent: data.isCurrent ?? false,
            publishedAt: data.status === "PUBLISHED" ? new Date() : null,
            startsAt: data.startsAt ?? null,
            endsAt: data.endsAt ?? null,
            createdByUserId
          }
        })
      : await tx.menu.create({
          data: {
            kitchenId,
            name: data.name,
            status: data.status ?? "DRAFT",
            isCurrent: data.isCurrent ?? false,
            publishedAt: data.status === "PUBLISHED" ? new Date() : null,
            startsAt: data.startsAt ?? null,
            endsAt: data.endsAt ?? null,
            createdByUserId
          }
        });

    if (menuId) {
      await tx.menuItem.deleteMany({
        where: { menuId: menu.id }
      });
    }

    for (const item of data.items) {
      const { productPortion } = await resolveOrCreateProductPortion(tx, kitchenId, item);

      await tx.menuItem.create({
        data: {
          menuId: menu.id,
          productPortionId: productPortion.id,
          displayName: item.displayName ?? item.productName,
          normalizedDisplayName: normalizeMexicanText(
            item.displayName ?? item.productName
          ),
          description: item.description ?? item.productDescription ?? null,
          price: asDecimal(item.menuPrice ?? item.portionPrice),
          stockQuantity: item.stockQuantity ?? item.productStock ?? 0,
          availabilityStatus: item.availabilityStatus ?? "AVAILABLE"
        }
      });
    }

    await logActivity(tx, {
      kitchenId,
      userId: createdByUserId,
      entityType: "menu",
      entityId: menu.id,
      eventType: menu.status === "PUBLISHED" ? "MENU_PUBLISHED" : "MENU_SAVED",
      description: `Menu ${menu.name} saved`,
      metadata: { isCurrent: menu.isCurrent, status: menu.status }
    });

    return tx.menu.findUniqueOrThrow({
      where: { id: menu.id },
      include: {
        menuItems: {
          orderBy: { id: "asc" },
          include: {
            productPortion: {
              include: {
                product: true,
                portion: true
              }
            }
          }
        },
        kitchen: true
      }
    });
  }).then((menu) =>
    serializeEntity({
      id: menu.id,
      kitchenId: menu.kitchenId,
      name: menu.name,
      status: menu.status,
      isCurrent: menu.isCurrent,
      publishedAt: menu.publishedAt,
      startsAt: menu.startsAt,
      endsAt: menu.endsAt,
      items: menu.menuItems.map((item) => ({
        id: item.id,
        productPortionId: item.productPortionId,
        displayName: item.displayName,
        description: item.description,
        price: item.price,
        stockQuantity: item.stockQuantity,
        availabilityStatus: item.availabilityStatus,
        productName: item.productPortion.product.name,
        portionSize: item.productPortion.portion.size,
        portionPrice: item.productPortion.portion.price
      }))
    })
  );
}

async function getMenuByKitchen(kitchenIdInput) {
  const kitchenId = toBigInt(kitchenIdInput, "kitchenId");

  const menu = await prisma.menu.findFirst({
    where: {
      kitchenId,
      isCurrent: true,
      status: "PUBLISHED"
    },
    orderBy: [
      { publishedAt: "desc" },
      { id: "desc" }
    ],
    include: {
      kitchen: true,
      menuItems: {
        where: {
          availabilityStatus: {
            in: ["AVAILABLE", "SOLD_OUT"]
          }
        },
        orderBy: { id: "asc" },
        include: {
          productPortion: {
            include: {
              product: true,
              portion: true
            }
          }
        }
      }
    }
  });

  if (!menu) {
    return null;
  }

  return serializeEntity({
    kitchen: {
      id: menu.kitchen.id,
      name: menu.kitchen.name,
      description: menu.kitchen.description,
      zone: menu.kitchen.zone,
      schedule: menu.kitchen.schedule,
      setupStatus: menu.kitchen.setupStatus
    },
    menu: {
      id: menu.id,
      name: menu.name,
      status: menu.status,
      isCurrent: menu.isCurrent,
      publishedAt: menu.publishedAt
    },
    items: menu.menuItems.map((item) => ({
      id: item.id,
      productPortionId: item.productPortionId,
      displayName: item.displayName ?? item.productPortion.product.name,
      description: item.description ?? item.productPortion.product.description,
      menuPrice: item.price,
      portionPrice: item.productPortion.portion.price,
      stockQuantity: item.stockQuantity,
      availabilityStatus: item.availabilityStatus,
      portionSize: item.productPortion.portion.size
    }))
  });
}

async function getUserByPhone(phone, kitchenIdInput = null) {
  const kitchenId = kitchenIdInput ? toBigInt(kitchenIdInput, "kitchenId") : null;

  const linkedPhone = await prisma.linkedPhone.findFirst({
    where: {
      phone,
      OR: kitchenId
        ? [
            { kitchenId },
            { user: { kitchenId } }
          ]
        : undefined
    },
    orderBy: { id: "desc" },
    include: {
      user: {
        include: {
          addresses: {
            orderBy: { id: "asc" }
          }
        }
      },
      kitchen: true
    }
  });

  if (!linkedPhone) {
    return null;
  }

  return serializeEntity({
    linkedPhoneId: linkedPhone.id,
    phone: linkedPhone.phone,
    user: linkedPhone.user
      ? {
          id: linkedPhone.user.id,
          name: linkedPhone.user.name,
          role: linkedPhone.user.role,
          kitchenId: linkedPhone.user.kitchenId
        }
      : null,
    kitchenOwner: linkedPhone.kitchen
      ? {
          id: linkedPhone.kitchen.id,
          name: linkedPhone.kitchen.name
        }
      : null,
    addresses: linkedPhone.user
      ? linkedPhone.user.addresses.map((address) => ({
          id: address.id,
          addressLine: address.addressLine,
          description: address.description
        }))
      : []
  });
}

async function createOrUpdateConversation(data) {
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");
  const linkedPhoneId = toBigInt(data.linkedPhoneId, "linkedPhoneId");
  const clientUserId = data.clientUserId ? toBigInt(data.clientUserId, "clientUserId") : null;
  const currentOrderId = data.currentOrderId ? toBigInt(data.currentOrderId, "currentOrderId") : null;
  const assignedUserId = data.assignedUserId ? toBigInt(data.assignedUserId, "assignedUserId") : null;

  return prisma.$transaction(async (tx) => {
    const existingConversation = await tx.conversation.findFirst({
      where: {
        kitchenId,
        linkedPhoneId,
        status: {
          not: "CLOSED"
        }
      },
      orderBy: { id: "desc" }
    });

    if (existingConversation) {
      return tx.conversation.update({
        where: { id: existingConversation.id },
        data: {
          clientUserId: clientUserId ?? existingConversation.clientUserId,
          currentOrderId: currentOrderId ?? existingConversation.currentOrderId,
          status: data.status ?? existingConversation.status,
          assignedUserId: assignedUserId ?? existingConversation.assignedUserId
        }
      });
    }

    return tx.conversation.create({
      data: {
        kitchenId,
        linkedPhoneId,
        clientUserId,
        currentOrderId,
        status: data.status ?? "BOT_ACTIVE",
        assignedUserId
      }
    });
  });
}

async function registerWhatsappSession(data) {
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");

  return prisma.$transaction(async (tx) => {
    const existingSession = data.externalSessionId
      ? await tx.whatsappSession.findFirst({
          where: {
            kitchenId,
            externalSessionId: data.externalSessionId
          },
          orderBy: { id: "desc" }
        })
      : await tx.whatsappSession.findFirst({
          where: { kitchenId },
          orderBy: { id: "desc" }
        });

    if (existingSession) {
      return tx.whatsappSession.update({
        where: { id: existingSession.id },
        data: {
          externalSessionId: data.externalSessionId ?? existingSession.externalSessionId,
          sessionStatus: data.sessionStatus ?? existingSession.sessionStatus,
          qrCode: data.qrCode ?? existingSession.qrCode,
          expiresAt: data.expiresAt ?? existingSession.expiresAt,
          connectedAt: data.connectedAt ?? existingSession.connectedAt
        }
      });
    }

    return tx.whatsappSession.create({
      data: {
        kitchenId,
        externalSessionId: data.externalSessionId ?? null,
        sessionStatus: data.sessionStatus ?? "PENDING_LINK",
        qrCode: data.qrCode ?? null,
        expiresAt: data.expiresAt ?? null,
        connectedAt: data.connectedAt ?? null
      }
    });
  });
}

async function resolveCurrentMenuItem(tx, kitchenId, productPortionId) {
  const currentMenu = await tx.menu.findFirst({
    where: {
      kitchenId,
      isCurrent: true,
      status: "PUBLISHED"
    },
    orderBy: [
      { publishedAt: "desc" },
      { id: "desc" }
    ]
  });

  if (!currentMenu) {
    throw new Error("kitchen does not have a current published menu");
  }

  const menuItem = await tx.menuItem.findFirst({
    where: {
      menuId: currentMenu.id,
      productPortionId,
      availabilityStatus: "AVAILABLE"
    },
    include: {
      productPortion: {
        include: {
          product: true,
          portion: true
        }
      }
    }
  });

  if (!menuItem) {
    throw new Error(`productPortionId ${productPortionId} is not available in the current menu`);
  }

  return menuItem;
}

async function createOrUpdateDraftOrder(data) {
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");
  const clientUserId = toBigInt(data.clientUserId, "clientUserId");
  const linkedPhoneId = toBigInt(data.linkedPhoneId, "linkedPhoneId");
  const addressId = data.addressId ? toBigInt(data.addressId, "addressId") : null;
  const deliveryDriverUserId = data.deliveryDriverUserId
    ? toBigInt(data.deliveryDriverUserId, "deliveryDriverUserId")
    : null;
  const explicitOrderId = data.orderId ? toBigInt(data.orderId, "orderId") : null;

  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.findUniqueOrThrow({ where: { id: clientUserId } });
    await tx.kitchen.findUniqueOrThrow({ where: { id: kitchenId } });
    await tx.linkedPhone.findUniqueOrThrow({ where: { id: linkedPhoneId } });

    if (addressId) {
      await tx.address.findUniqueOrThrow({ where: { id: addressId } });
    }

    let draftOrder;

    if (explicitOrderId) {
      draftOrder = await tx.order.findUniqueOrThrow({
        where: { id: explicitOrderId }
      });
    } else {
      draftOrder = await tx.order.findFirst({
        where: {
          kitchenId,
          clientUserId,
          status: "DRAFT"
        },
        orderBy: { id: "desc" }
      });
    }

    if (!draftOrder) {
      draftOrder = await tx.order.create({
        data: {
          clientUserId,
          kitchenId,
          linkedPhoneId,
          addressId,
          deliveryDriverUserId,
          deliveryType: data.deliveryType ?? null,
          paymentMethod: data.paymentMethod ?? null,
          paymentStatus:
            data.paymentMethod === "TRANSFER"
              ? data.paymentStatus ?? "PENDING"
              : null,
          paymentReference:
            data.paymentMethod === "TRANSFER"
              ? data.paymentReference ?? null
              : null,
          deliveryAddressSnapshot:
            data.deliveryType === "DELIVERY" && data.deliveryAddressSnapshot
              ? data.deliveryAddressSnapshot
              : null,
          deliveryFee: asDecimal(data.deliveryFee ?? 0),
          comments: data.comments ?? null,
          scheduledDeliveryAt: data.scheduledDeliveryAt ?? null,
          status: "DRAFT"
        }
      });
    } else {
      draftOrder = await tx.order.update({
        where: { id: draftOrder.id },
        data: {
          linkedPhoneId,
          addressId,
          deliveryDriverUserId,
          deliveryType: data.deliveryType ?? draftOrder.deliveryType,
          paymentMethod: data.paymentMethod ?? draftOrder.paymentMethod,
          paymentStatus:
            data.paymentMethod === "TRANSFER"
              ? data.paymentStatus ?? draftOrder.paymentStatus ?? "PENDING"
              : null,
          paymentReference:
            data.paymentMethod === "TRANSFER"
              ? data.paymentReference ?? draftOrder.paymentReference
              : null,
          deliveryAddressSnapshot:
            data.deliveryType === "DELIVERY" && data.deliveryAddressSnapshot
              ? data.deliveryAddressSnapshot
              : draftOrder.deliveryAddressSnapshot,
          deliveryFee: asDecimal(data.deliveryFee ?? draftOrder.deliveryFee ?? 0),
          comments: data.comments ?? draftOrder.comments,
          scheduledDeliveryAt: data.scheduledDeliveryAt ?? draftOrder.scheduledDeliveryAt
        }
      });

      await tx.orderProductPortion.deleteMany({
        where: { orderId: draftOrder.id }
      });
    }

    for (const item of data.items) {
      const productPortionId = toBigInt(item.productPortionId, "productPortionId");
      const menuItem = await resolveCurrentMenuItem(tx, kitchenId, productPortionId);

      await tx.orderProductPortion.create({
        data: {
          orderId: draftOrder.id,
          productPortionId,
          menuItemId: menuItem.id,
          nameSnapshot: menuItem.displayName,
          quantity: item.quantity,
          unitPrice: menuItem.productPortion.portion.price
        }
      });
    }

    const updatedDraft = await tx.order.findUniqueOrThrow({
      where: { id: draftOrder.id },
      include: {
        orderItems: {
          orderBy: { id: "asc" },
          include: {
            productPortion: {
              include: {
                product: true,
                portion: true
              }
            }
          }
        }
      }
    });

    await logActivity(tx, {
      kitchenId,
      userId: clientUserId,
      entityType: "order",
      entityId: updatedDraft.id,
      eventType: "ORDER_DRAFT_UPDATED",
      description: `Draft order ${updatedDraft.id} saved`
    });

    return serializeOrder(updatedDraft);
  });
}

async function getOrderById(orderIdInput) {
  const orderId = toBigInt(orderIdInput, "orderId");

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      clientUser: true,
      kitchen: true,
      linkedPhone: true,
      address: true,
      deliveryDriverUser: true,
      orderItems: {
        orderBy: { id: "asc" },
        include: {
          productPortion: {
            include: {
              product: true,
              portion: true
            }
          }
        }
      }
    }
  });

  return serializeEntity({
    ...serializeOrder(order),
    clientUser: order.clientUser
      ? { id: order.clientUser.id, name: order.clientUser.name, role: order.clientUser.role }
      : null,
    kitchen: order.kitchen
      ? { id: order.kitchen.id, name: order.kitchen.name }
      : null,
    linkedPhone: order.linkedPhone
      ? { id: order.linkedPhone.id, phone: order.linkedPhone.phone }
      : null,
    address: order.address
      ? {
          id: order.address.id,
          addressLine: order.address.addressLine,
          description: order.address.description
        }
      : null,
    deliveryDriverUser: order.deliveryDriverUser
      ? {
          id: order.deliveryDriverUser.id,
          name: order.deliveryDriverUser.name,
          role: order.deliveryDriverUser.role
        }
      : null
  });
}

async function listOrdersByFilter(data) {
  const kitchenId = toBigInt(data.kitchenId, "kitchenId");
  const statuses = FILTER_STATUS_MAP[data.filter];

  if (!statuses) {
    throw new Error("unsupported filter");
  }

  const where = {
    kitchenId,
    status: { in: statuses }
  };

  if (data.filter === "delivery_pending") {
    where.deliveryType = "DELIVERY";
  }

  if (data.filter === "payment_pending") {
    where.paymentMethod = "CASH";
  }

  if (data.delivererUserId) {
    where.deliveryDriverUserId = toBigInt(data.delivererUserId, "delivererUserId");
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      orderItems: {
        include: {
          productPortion: {
            include: {
              product: true,
              portion: true
            }
          }
        }
      }
    }
  });

  return orders.map(serializeOrder);
}

async function changeOrderStatus(data) {
  const orderId = toBigInt(data.orderId, "orderId");
  const actorUserId = data.actorUserId ? toBigInt(data.actorUserId, "actorUserId") : null;
  const actorRole = data.actorRole;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            productPortion: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    const allowedTransitions = STATUS_TRANSITIONS[actorRole]?.[order.status] ?? [];

    if (!allowedTransitions.includes(data.nextStatus)) {
      throw new Error(
        `status transition ${order.status} -> ${data.nextStatus} is not allowed for ${actorRole}`
      );
    }

    if (data.nextStatus === "CONFIRMED") {
      if (!order.deliveryType) {
        throw new Error("deliveryType is required before confirming an order");
      }

      if (!order.paymentMethod) {
        throw new Error("paymentMethod is required before confirming an order");
      }

      if (order.deliveryType === "DELIVERY" && !order.addressId) {
        throw new Error("addressId is required before confirming a delivery order");
      }

      if (order.orderItems.length === 0) {
        throw new Error("an order must have at least one item before confirmation");
      }
    }

    const updateData = {
      status: data.nextStatus,
      comments: data.comments ?? order.comments,
      cancellationDescription:
        data.cancellationDescription ?? order.cancellationDescription,
      deliveryDriverUserId: data.deliveryDriverUserId
        ? toBigInt(data.deliveryDriverUserId, "deliveryDriverUserId")
        : order.deliveryDriverUserId,
      estimatedReadyAt: data.estimatedReadyAt ?? order.estimatedReadyAt,
      printedAt: data.printedAt ?? order.printedAt,
      printStatus: data.printStatus ?? order.printStatus
    };

    if (data.nextStatus === "CONFIRMED" && !order.confirmedAt) {
      updateData.confirmedAt = new Date();
    }

    if (data.nextStatus === "IN_PROCESS_OF_DELIVERY" && !updateData.deliveryDriverUserId && actorRole === "DELIVERER") {
      updateData.deliveryDriverUserId = actorUserId;
    }

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: updateData,
      include: {
        orderItems: {
          orderBy: { id: "asc" },
          include: {
            productPortion: {
              include: {
                product: true,
                portion: true
              }
            }
          }
        }
      }
    });

    await logActivity(tx, {
      kitchenId: updatedOrder.kitchenId,
      userId: actorUserId,
      entityType: "order",
      entityId: updatedOrder.id,
      eventType: "ORDER_STATUS_CHANGED",
      description: `Order ${updatedOrder.id} changed from ${order.status} to ${updatedOrder.status}`,
      metadata: {
        fromStatus: order.status,
        toStatus: updatedOrder.status,
        actorRole
      }
    });

    return serializeOrder(updatedOrder);
  });
}

module.exports = {
  createKitchen,
  saveKitchenConfiguration,
  createUser,
  linkPhoneToUser,
  linkAddressToUser,
  linkUserToKitchen,
  createMenu,
  getMenuByKitchen,
  getUserByPhone,
  createOrUpdateConversation,
  registerWhatsappSession,
  createOrUpdateDraftOrder,
  getOrderById,
  listOrdersByFilter,
  changeOrderStatus
};
