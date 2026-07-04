import { ActivityLogPrismaRepository } from "../adapters/repositories/activity-log-prisma-repository";
import { ClientPrismaRepository } from "../adapters/repositories/client-prisma-repository";
import { KitchenPrismaRepository } from "../adapters/repositories/kitchen-prisma-repository";
import { MenuPrismaRepository } from "../adapters/repositories/menu-prisma-repository";
import { OrderPrismaRepository } from "../adapters/repositories/order-prisma-repository";
import { PrinterPrismaRepository } from "../adapters/repositories/printer-prisma-repository";
import { ProcessedEventPrismaRepository } from "../adapters/repositories/processed-event-prisma-repository";
import { SessionPrismaRepository } from "../adapters/repositories/session-prisma-repository";
import { prisma } from "./prisma";

function buildRepositories(db: any) {
  return {
    activityLogs: new ActivityLogPrismaRepository(db),
    clients: new ClientPrismaRepository(db),
    kitchens: new KitchenPrismaRepository(db),
    menus: new MenuPrismaRepository(db),
    orders: new OrderPrismaRepository(db),
    printers: new PrinterPrismaRepository(db),
    processedEvents: new ProcessedEventPrismaRepository(db),
    sessions: new SessionPrismaRepository(db)
  };
}

export const repositories = {
  ...buildRepositories(prisma),
  async withTransaction<T>(work: (transactionRepositories: ReturnType<typeof buildRepositories>) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (transaction) => work(buildRepositories(transaction)));
  }
};
