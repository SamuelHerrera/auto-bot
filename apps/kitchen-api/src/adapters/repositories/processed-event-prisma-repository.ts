import type { PrismaClient } from "@prisma/client";
import type { ProcessedEventRepository } from "../../domain/ports/processed-event-repository";
import { prisma } from "../../infrastructure/prisma";
import { serializeEntity, toOptionalBigIntId } from "./helpers";

export class ProcessedEventPrismaRepository implements ProcessedEventRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async findByMessageId(input: Record<string, unknown>): Promise<any> {
    if (!input.messageId || !input.handlerName) {
      return null;
    }

    const record = await this.db.processedEvent.findFirst({
      where: {
        kitchenId: toOptionalBigIntId(input.kitchenId as string | number | bigint | null | undefined),
        messageId: String(input.messageId),
        handlerName: String(input.handlerName)
      },
      orderBy: { id: "desc" }
    });

    return record
      ? {
          id: String(record.id),
          kitchenId: record.kitchenId ? String(record.kitchenId) : null,
          messageId: record.messageId,
          handlerName: record.handlerName,
          result: serializeEntity(record.result)
        }
      : null;
  }

  async create(input: Record<string, unknown>): Promise<any> {
    const record = await this.db.processedEvent.create({
      data: {
        kitchenId: toOptionalBigIntId(input.kitchenId as string | number | bigint | null | undefined),
        messageId: String(input.messageId),
        handlerName: String(input.handlerName),
        result: serializeEntity(input.result) as any
      }
    });

    return {
      id: String(record.id),
      kitchenId: record.kitchenId ? String(record.kitchenId) : null,
      messageId: record.messageId,
      handlerName: record.handlerName,
      result: serializeEntity(record.result)
    };
  }
}
