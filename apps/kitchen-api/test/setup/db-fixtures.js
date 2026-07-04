import { afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { normalizeMexicanPhone } from "../../src/shared/normalize.ts";
import { executeUpsertClient } from "../../src/application/usecases/clients.ts";
import { executeRegisterKitchen, executeUpsertAuthorizedContact } from "../../src/application/usecases/kitchens.ts";
import { executePublishMenu } from "../../src/application/usecases/menus.ts";
import { executeChangeOrderStatus, executeCreateOrderDraft } from "../../src/application/usecases/orders.ts";
import { clearDatabase, disconnectDatabase } from "./db.js";

export function useDbTestHooks() {
  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });
}

export async function seedKitchen(overrides = {}) {
  return prisma.kitchen.create({
    data: {
      name: "Kitchen Test",
      setupStatus: "ACTIVE",
      orderingStatus: "OPEN",
      ...overrides
    }
  });
}

export async function seedPrinter({ kitchenId, identifier = "printer-1", status = "ON", isActive = true } = {}) {
  return prisma.printer.create({
    data: {
      kitchenId: BigInt(kitchenId),
      identifier,
      status,
      isActive
    }
  });
}

export async function seedAuthorizedContact({
  kitchenId,
  phone = "+529991112233",
  role = "KITCHEN",
  name = "Admin",
  active = true
} = {}) {
  const normalizedPhone = normalizeMexicanPhone(phone);
  const existingLinkedPhone = await prisma.linkedPhone.findFirst({
    where: {
      kitchenId: BigInt(kitchenId),
      normalizedPhone
    },
    include: {
      user: true
    },
    orderBy: { id: "desc" }
  });

  if (existingLinkedPhone?.user) {
    const user = await prisma.user.update({
      where: { id: existingLinkedPhone.user.id },
      data: {
        name,
        role,
        isActive: active
      }
    });

    await prisma.linkedPhone.update({
      where: { id: existingLinkedPhone.id },
      data: {
        phone,
        normalizedPhone
      }
    });

    return {
      ok: true,
      contact: {
        id: user.id.toString(),
        kitchenId: String(kitchenId),
        phone,
        role: user.role,
        name: user.name,
        active: user.isActive
      }
    };
  }

  const user = await prisma.user.create({
    data: {
      kitchenId: BigInt(kitchenId),
      name,
      role,
      isActive: active
    }
  });

  await prisma.linkedPhone.create({
    data: {
      kitchenId: BigInt(kitchenId),
      userId: user.id,
      phone,
      normalizedPhone
    }
  });

  return {
    ok: true,
    contact: {
      id: user.id.toString(),
      kitchenId: String(kitchenId),
      phone,
      role: user.role,
      name: user.name,
      active: user.isActive
    }
  };
}

export async function publishSimpleMenu(kitchenId, items) {
  const adminPhone = `+52${String(kitchenId).padStart(10, "0").slice(-10)}`;
  const admin = await seedAuthorizedContact({
    kitchenId,
    phone: adminPhone,
    role: "KITCHEN",
    name: `Menu Admin ${kitchenId}`,
    active: true
  });

  return executePublishMenu({
    messageId: `seed_menu_${kitchenId}_${items.length}`,
    actor: {
      role: "KITCHEN",
      kitchenId: String(kitchenId),
      phone: admin.contact.phone,
      contactId: admin.contact.id
    },
    kitchenId: String(kitchenId),
    items
  });
}

export async function seedClient({
  kitchenId,
  phone = "+529991112233",
  profile = {}
} = {}) {
  return executeUpsertClient({
    messageId: `seed_client_${kitchenId}_${phone}`,
    actor: {
      role: "CLIENT",
      phone
    },
    kitchenId: String(kitchenId),
    profile
  });
}

export async function createDraftOrder({
  kitchenId,
  phone = "+529991112233",
  items,
  deliveryType = "PICKUP",
  paymentMethod = "CASH",
  address = null,
  comments = null,
  orderId = null,
  messageId = `seed_order_${Date.now()}`
}) {
  return executeCreateOrderDraft({
    messageId,
    actor: {
      role: "CLIENT",
      phone
    },
    kitchenId: String(kitchenId),
    orderId,
    items,
    deliveryType,
    address,
    paymentMethod,
    comments
  });
}

export async function confirmOrder({
  orderId,
  phone = "+529991112233",
  messageId = `seed_confirm_${Date.now()}`
}) {
  return executeChangeOrderStatus({
    messageId,
    actor: {
      role: "CLIENT",
      phone
    },
    orderId: String(orderId),
    targetOrderStatus: "CONFIRMED"
  });
}

export async function seedWhatsAppManagerConversationState({
  conversationId,
  senderId = null,
  phone = null,
  kitchenId = null,
  orderId = null,
  actorRole = null,
  metadata = null
} = {}) {
  if (!conversationId) {
    throw new Error("conversationId is required");
  }

  return prisma.whatsAppManagerConversationState.upsert({
    where: {
      conversationId
    },
    update: {
      senderId,
      phone,
      kitchenId,
      orderId,
      actorRole,
      metadata,
      updatedAt: new Date()
    },
    create: {
      conversationId,
      senderId,
      phone,
      kitchenId,
      orderId,
      actorRole,
      metadata,
      updatedAt: new Date()
    }
  });
}

export async function registerKitchen(input = {}) {
  return executeRegisterKitchen({
    messageId: "seed_register_kitchen",
    actor: {
      platformAccess: true,
      id: "support_seed"
    },
    tenant: {
      name: "Kitchen Seed"
    },
    ...input
  });
}
