import type { OrderRepository } from "../../domain/ports/order-repository";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../infrastructure/prisma";
import { normalizeMexicanPhone } from "../../shared/normalize";
import {
  mapMenuToContext,
  mapOrderToContext,
  resolveOrCreateAddress,
  resolveOrCreateClientIdentity,
  toBigIntId,
  toOptionalBigIntId
} from "./helpers";

export class OrderPrismaRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getById(orderId: string): Promise<any> {
    const order = await this.db.order.findUnique({
      where: { id: toBigIntId(orderId, "orderId") },
      include: {
        linkedPhone: true,
        address: true,
        orderItems: {
          orderBy: { id: "asc" }
        }
      }
    });

    return order ? mapOrderToContext(order) : null;
  }

  async getCurrentMenuItems(kitchenId: string): Promise<any[]> {
    const menu = await this.db.menu.findFirst({
      where: {
        kitchenId: toBigIntId(kitchenId, "kitchenId"),
        isCurrent: true,
        status: "PUBLISHED"
      },
      include: {
        menuItems: {
          include: {
            productPortion: {
              include: {
                product: true,
                portion: true
              }
            }
          },
          orderBy: { id: "asc" }
        }
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }]
    });

    return mapMenuToContext(menu)?.items ?? [];
  }

  async getExistingDraft(input: Record<string, unknown>): Promise<any> {
    const kitchenId = toBigIntId(String(input.kitchenId), "kitchenId");
    const order = input.orderId
      ? await this.db.order.findUnique({
          where: { id: toBigIntId(String(input.orderId), "orderId") },
          include: {
            linkedPhone: true,
            address: true,
            orderItems: {
              orderBy: { id: "asc" }
            }
          }
        })
      : await this.db.order.findFirst({
          where: {
            kitchenId,
            status: "DRAFT",
            linkedPhone: {
              normalizedPhone: normalizeMexicanPhone(String(input.phone))
            }
          },
          include: {
            linkedPhone: true,
            address: true,
            orderItems: {
              orderBy: { id: "asc" }
            }
          },
          orderBy: { id: "desc" }
        });

    return order ? mapOrderToContext(order) : null;
  }

  async query(input: Record<string, unknown>): Promise<any[]> {
    const filter = String(input.filter);
    const kitchenId = input.kitchenId ? toBigIntId(String(input.kitchenId), "kitchenId") : null;
    const delivererUserId = toOptionalBigIntId(input.delivererUserId as any);
    const where: any = {};

    if (kitchenId) {
      where.kitchenId = kitchenId;
    }

    if (delivererUserId) {
      where.deliveryType = "DELIVERY";
      where.OR = [
        { deliveryDriverUserId: delivererUserId },
        { deliveryDriverUserId: null }
      ];
    }

    if (filter === "active") {
      where.status = { in: ["CONFIRMED", "IN_PROCESS_OF_DELIVERY"] };
    } else if (filter === "pending") {
      where.status = "DRAFT";
    } else if (filter === "completed") {
      where.status = { in: ["DELIVERED", "CANCELLED"] };
    } else if (filter === "delivery_pending") {
      where.status = { in: ["CONFIRMED", "IN_PROCESS_OF_DELIVERY"] };
      where.deliveryType = "DELIVERY";
    } else if (filter === "payment_pending") {
      where.paymentMethod = "TRANSFER";
      where.paymentStatus = "PENDING";
    }

    const orders = await this.db.order.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        linkedPhone: true,
        address: true,
        orderItems: {
          orderBy: { id: "asc" }
        }
      }
    });

    return orders.map(mapOrderToContext);
  }

  async saveDraft(input: Record<string, unknown>): Promise<any> {
    const payload = input.input as any;
    const draftResult = input.draft as any;
    const identity = await resolveOrCreateClientIdentity(
      this.db as any,
      payload.kitchenId,
      payload.actor.phone,
      null
    );
    const address = await resolveOrCreateAddress(this.db as any, {
      kitchenId: payload.kitchenId,
      userId: identity.userId,
      address: draftResult.address ?? payload.address
    });

    const draftId = draftResult.id ? toBigIntId(String(draftResult.id), "orderId") : null;
    const existing = draftId
      ? await this.db.order.findUnique({
          where: { id: draftId }
        })
      : await this.db.order.findFirst({
          where: {
            kitchenId: toBigIntId(String(payload.kitchenId), "kitchenId"),
            linkedPhoneId: identity.linkedPhoneId,
            status: "DRAFT"
          },
          orderBy: { id: "desc" }
        });

    const order = existing
      ? await this.db.order.update({
          where: { id: existing.id },
          data: {
            linkedPhoneId: identity.linkedPhoneId,
            addressId: address?.id ?? null,
            deliveryType: draftResult.address ? "DELIVERY" : (payload.deliveryType as any),
            paymentMethod: payload.paymentMethod as any,
            paymentStatus: draftResult.paymentStatus as any,
            paymentReference: draftResult.paymentReference ?? null,
            comments: draftResult.comments ?? null,
            deliveryFee: draftResult.deliveryFee ?? 0,
            deliveryAddressSnapshot: draftResult.deliveryAddressSnapshot ?? null
          }
        })
      : await this.db.order.create({
          data: {
            clientUserId: identity.userId,
            kitchenId: toBigIntId(String(payload.kitchenId), "kitchenId"),
            linkedPhoneId: identity.linkedPhoneId,
            addressId: address?.id ?? null,
            deliveryType: draftResult.address ? "DELIVERY" : (payload.deliveryType as any),
            paymentMethod: payload.paymentMethod as any,
            paymentStatus: draftResult.paymentStatus as any,
            paymentReference: draftResult.paymentReference ?? null,
            comments: draftResult.comments ?? null,
            deliveryFee: draftResult.deliveryFee ?? 0,
            deliveryAddressSnapshot: draftResult.deliveryAddressSnapshot ?? null,
            status: "DRAFT"
          }
        });

    await this.db.orderProductPortion.deleteMany({
      where: { orderId: order.id }
    });

    for (const item of draftResult.items) {
      const menuItem = await this.db.menuItem.findUniqueOrThrow({
        where: { id: toBigIntId(String(item.menuItemId), "menuItemId") }
      });

      await this.db.orderProductPortion.create({
        data: {
          order: {
            connect: { id: order.id }
          },
          menuItem: {
            connect: { id: menuItem.id }
          },
          productPortion: {
            connect: { id: menuItem.productPortionId }
          },
          nameSnapshot: menuItem.displayName,
          unitPrice: menuItem.price,
          quantity: Number(item.quantity)
        }
      });
    }

    const persisted = await this.db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        linkedPhone: true,
        address: true,
        orderItems: {
          orderBy: { id: "asc" }
        }
      }
    });

    return mapOrderToContext(persisted);
  }

  async confirmOrderAtomically(input: Record<string, unknown>): Promise<any> {
    const orderId = toBigIntId(String(input.orderId), "orderId");
    const order = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        linkedPhone: true,
        address: true,
        orderItems: {
          orderBy: { id: "asc" },
          include: {
            menuItem: {
              include: {
                productPortion: true
              }
            }
          }
        }
      }
    });
    const quantitiesByProduct = new Map<string, { productId: bigint; quantity: number; menuItemName: string }>();

    for (const item of order.orderItems) {
      const productId = item.menuItem?.productPortion?.productId;

      if (!productId) {
        continue;
      }

      const productKey = productId.toString();
      const existing = quantitiesByProduct.get(productKey) ?? {
        productId,
        quantity: 0,
        menuItemName: item.nameSnapshot
      };

      existing.quantity += item.quantity;
      quantitiesByProduct.set(productKey, existing);
    }

    for (const { productId, quantity } of quantitiesByProduct.values()) {
      const product = await this.db.product.findUniqueOrThrow({
        where: { id: productId }
      });

      if (product.stock < quantity) {
        const error: any = new Error("insufficient_stock");
        error.code = "insufficient_stock";
        throw error;
      }

      const nextQuantity = product.stock - quantity;
      await this.db.product.update({
        where: { id: product.id },
        data: {
          stock: nextQuantity
        }
      });

      const currentMenuItems = await this.db.menuItem.findMany({
        where: {
          menu: {
            kitchenId: order.kitchenId,
            isCurrent: true,
            status: "PUBLISHED"
          },
          productPortion: {
            productId: product.id
          }
        }
      });

      for (const menuItem of currentMenuItems) {
        await this.db.menuItem.update({
          where: { id: menuItem.id },
          data: {
            stockQuantity: nextQuantity,
            availabilityStatus:
              nextQuantity === 0 && menuItem.availabilityStatus !== "HIDDEN"
                ? "SOLD_OUT"
                : menuItem.availabilityStatus
          }
        });
      }
    }

    const confirmedOrder = await this.db.order.update({
      where: { id: order.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: order.confirmedAt ?? new Date(),
        printStatus: "PENDING",
        revision: { increment: 1 }
      },
      include: {
        linkedPhone: true,
        address: true,
        orderItems: {
          orderBy: { id: "asc" }
        }
      }
    });

    return mapOrderToContext(confirmedOrder);
  }

  async changeStatus(input: Record<string, unknown>): Promise<any> {
    const orderId = toBigIntId(String(input.orderId), "orderId");
    const updated = await this.db.order.update({
      where: { id: orderId },
      data: {
        status: input.targetOrderStatus as any,
        cancellationDescription: (input.cancellationDescription as string | undefined) ?? undefined,
        deliveryDriverUserId:
          input.deliveryDriverUserId !== undefined
            ? toOptionalBigIntId(input.deliveryDriverUserId as any)
            : undefined,
        printedAt: input.printedAt ? new Date(String(input.printedAt)) : undefined,
        estimatedReadyAt: input.estimatedReadyAt ? new Date(String(input.estimatedReadyAt)) : undefined,
        printStatus: (input.printStatus as any) ?? undefined,
        revision: { increment: 1 }
      },
      include: {
        linkedPhone: true,
        address: true,
        orderItems: {
          orderBy: { id: "asc" }
        }
      }
    });

    return mapOrderToContext(updated);
  }
}
