import type { SessionRepository } from "../../domain/ports/session-repository";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../infrastructure/prisma";
import { serializeEntity, toBigIntId } from "./helpers";

export class SessionPrismaRepository implements SessionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getByKitchenId(kitchenId: string): Promise<any> {
    const session = await this.db.whatsappSession.findFirst({
      where: { kitchenId: toBigIntId(kitchenId, "kitchenId") },
      orderBy: { id: "desc" }
    });

    return session
      ? serializeEntity({
          id: session.id,
          kitchenId: session.kitchenId,
          status: session.sessionStatus,
          qrMediaRef: session.qrCode,
          connectedAt: session.connectedAt,
          expiresAt: session.expiresAt
        })
      : null;
  }

  async registerWhatsappSession(input: Record<string, unknown>): Promise<any> {
    const kitchenId = toBigIntId(String(input.kitchenId), "kitchenId");
    const current = await this.db.whatsappSession.findFirst({
      where: { kitchenId },
      orderBy: { id: "desc" }
    });
    const session = current
      ? await this.db.whatsappSession.update({
          where: { id: current.id },
          data: {
            sessionStatus: input.status as any,
            qrCode: (input.qrMediaRef as string | undefined) ?? current.qrCode,
            connectedAt:
              input.status === "CONNECTED"
                ? new Date()
                : current.connectedAt,
            expiresAt:
              input.status === "EXPIRED"
                ? new Date()
                : current.expiresAt
          }
        })
      : await this.db.whatsappSession.create({
          data: {
            kitchenId,
            sessionStatus: (input.status as any) ?? "PENDING_LINK",
            qrCode: (input.qrMediaRef as string | undefined) ?? null,
            connectedAt: input.status === "CONNECTED" ? new Date() : null,
            expiresAt: input.status === "EXPIRED" ? new Date() : null
          }
        });

    return serializeEntity({
      id: session.id,
      kitchenId: session.kitchenId,
      status: session.sessionStatus,
      qrMediaRef: session.qrCode,
      connectedAt: session.connectedAt,
      expiresAt: session.expiresAt
    });
  }
}
