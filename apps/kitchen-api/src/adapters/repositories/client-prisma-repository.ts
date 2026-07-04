import type { ClientRepository } from "../../domain/ports/client-repository";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../infrastructure/prisma";
import { normalizeMexicanPhone } from "../../shared/normalize";
import {
  mapAddressToView,
  resolveOrCreateAddress,
  resolveOrCreateClientIdentity,
  serializeEntity,
  toBigIntId
} from "./helpers";

export class ClientPrismaRepository implements ClientRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async findByPhone(kitchenId: string, phone: string): Promise<any> {
    const linkedPhone = await this.db.linkedPhone.findFirst({
      where: {
        kitchenId: toBigIntId(kitchenId, "kitchenId"),
        normalizedPhone: normalizeMexicanPhone(phone)
      },
      include: {
        user: {
          include: {
            addresses: {
              where: {
                kitchenId: toBigIntId(kitchenId, "kitchenId")
              },
              orderBy: { id: "asc" }
            }
          }
        }
      },
      orderBy: { id: "desc" }
    });

    if (!linkedPhone?.user) {
      return null;
    }

    return serializeEntity({
      id: linkedPhone.user.id,
      kitchenId,
      phone: linkedPhone.phone,
      name: linkedPhone.user.name,
      addresses: linkedPhone.user.addresses.map(mapAddressToView)
    });
  }

  async upsertClient(input: Record<string, unknown>): Promise<any> {
    const kitchenId = String(input.kitchenId);
    const phone = String(input.phone);
    const profile = (input.profile as Record<string, unknown>) ?? {};
    const identity = await resolveOrCreateClientIdentity(this.db as any, kitchenId, phone, (profile.name as string | undefined) ?? null);

    if (profile.address) {
      await resolveOrCreateAddress(this.db as any, {
        kitchenId,
        userId: identity.userId,
        address: profile.address as Record<string, unknown>
      });
    }

    if (profile.name) {
      await this.db.user.update({
        where: { id: identity.userId },
        data: { name: String(profile.name) }
      });
    }

    const result = await this.db.linkedPhone.findUniqueOrThrow({
      where: { id: identity.linkedPhoneId },
      include: {
        user: {
          include: {
            addresses: {
              where: {
                kitchenId: toBigIntId(kitchenId, "kitchenId")
              },
              orderBy: { id: "asc" }
            }
          }
        }
      }
    });

    return serializeEntity({
      id: result.user?.id,
      kitchenId,
      phone: result.phone,
      name: result.user?.name,
      addresses: result.user?.addresses.map(mapAddressToView) ?? []
    });
  }
}
