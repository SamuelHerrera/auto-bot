import type { KitchenRepository } from "../../domain/ports/kitchen-repository";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../infrastructure/prisma";
import { normalizeMexicanPhone } from "../../shared/normalize";
import { mapKitchenToView, serializeEntity, toBigIntId } from "./helpers";

export class KitchenPrismaRepository implements KitchenRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getById(kitchenId: string): Promise<any> {
    const kitchen = await this.db.kitchen.findUnique({
      where: { id: toBigIntId(kitchenId, "kitchenId") }
    });

    return kitchen ? mapKitchenToView(kitchen) : null;
  }

  async listContacts(kitchenId: string): Promise<any[]> {
    const contacts = await this.db.linkedPhone.findMany({
      where: {
        kitchenId: toBigIntId(kitchenId, "kitchenId"),
        userId: { not: null }
      },
      include: {
        user: true
      },
      orderBy: { id: "asc" }
    });

    return contacts.map((contact) =>
      serializeEntity({
        id: contact.user?.id,
        kitchenId: contact.kitchenId,
        phone: contact.phone,
        role: contact.user?.role,
        name: contact.user?.name,
        active: contact.user?.isActive
      })
    );
  }

  async registerKitchen(input: Record<string, unknown>): Promise<any> {
    const kitchen = await this.db.kitchen.create({
      data: {
        name: String(input.name),
        description: (input.description as string | undefined) ?? null,
        setupStatus: (input.setupStatus as any) ?? "PENDING_SETUP"
      }
    });

    return mapKitchenToView(kitchen);
  }

  async updateConfiguration(input: Record<string, unknown>): Promise<any> {
    const configuration = (input.configuration as Record<string, unknown>) ?? {};
    const kitchen = await this.db.kitchen.update({
      where: { id: toBigIntId(String(input.kitchenId), "kitchenId") },
      data: {
        orderingStatus: configuration.orderingStatus as any,
        businessVoice: (configuration.businessVoice as string | undefined) ?? undefined,
        schedule: (configuration.schedule as string | undefined) ?? undefined,
        paymentOptions: Array.isArray(configuration.paymentOptions)
          ? (configuration.paymentOptions as any)
          : undefined,
        deliveryEnabled:
          configuration.deliverySettings && typeof (configuration.deliverySettings as any).enabled === "boolean"
            ? Boolean((configuration.deliverySettings as any).enabled)
            : undefined,
        deliveryFee:
          configuration.deliverySettings && (configuration.deliverySettings as any).fee !== undefined
            ? (configuration.deliverySettings as any).fee
            : undefined
      }
    });

    return mapKitchenToView(kitchen);
  }

  async upsertAuthorizedContact(input: Record<string, unknown>): Promise<any> {
    const kitchenId = toBigIntId(String(input.kitchenId), "kitchenId");
    const contact = (input.contact as Record<string, unknown>) ?? {};
    const phone = normalizeMexicanPhone(String(contact.phone ?? ""));
    const existingPhone = await this.db.linkedPhone.findFirst({
      where: {
        kitchenId,
        normalizedPhone: phone
      },
      include: {
        user: true
      },
      orderBy: { id: "desc" }
    });

    if (existingPhone?.user) {
      const user = await this.db.user.update({
        where: { id: existingPhone.user.id },
        data: {
          name: String(contact.name),
          role: contact.role as any,
          isActive: contact.active === false ? false : true
        }
      });

      await this.db.linkedPhone.update({
        where: { id: existingPhone.id },
        data: {
          phone,
          normalizedPhone: phone
        }
      });

      return serializeEntity({
        id: user.id,
        kitchenId,
        phone,
        role: user.role,
        name: user.name,
        active: user.isActive
      });
    }

    const user = await this.db.user.create({
      data: {
        kitchenId,
        name: String(contact.name),
        role: contact.role as any,
        isActive: contact.active === false ? false : true
      }
    });

    await this.db.linkedPhone.create({
      data: {
        kitchenId,
        userId: user.id,
        phone,
        normalizedPhone: phone
      }
    });

    return serializeEntity({
      id: user.id,
      kitchenId,
      phone,
      role: user.role,
      name: user.name,
      active: user.isActive
    });
  }
}
