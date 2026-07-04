import type { PrinterRepository } from "../../domain/ports/printer-repository";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../infrastructure/prisma";
import { mapOrderToContext, serializeEntity, toBigIntId } from "./helpers";

export class PrinterPrismaRepository implements PrinterRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getByIdentifier(input: Record<string, unknown>): Promise<any> {
    const printer = await this.db.printer.findFirst({
      where: {
        kitchenId: toBigIntId(String(input.kitchenId), "kitchenId"),
        identifier: String(input.printerIdentifier),
        isActive: true
      },
      orderBy: { id: "desc" }
    });

    return printer
      ? serializeEntity({
          id: printer.id,
          kitchenId: printer.kitchenId,
          identifier: printer.identifier,
          status: printer.status,
          isActive: printer.isActive
        })
      : null;
  }

  async getPrintQueue(input: Record<string, unknown>): Promise<any[]> {
    const orders = await this.db.order.findMany({
      where: {
        kitchenId: toBigIntId(String(input.kitchenId), "kitchenId"),
        status: "CONFIRMED"
      },
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
}
