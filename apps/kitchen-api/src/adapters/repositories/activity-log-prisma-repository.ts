import type { PrismaClient } from "@prisma/client";
import type { ActivityLogRepository } from "../../domain/ports/activity-log-repository";
import { prisma } from "../../infrastructure/prisma";
import { serializeEntity, toOptionalBigIntId } from "./helpers";

export class ActivityLogPrismaRepository implements ActivityLogRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(input: Record<string, unknown>): Promise<any> {
    const candidateUserId = toOptionalBigIntId(input.userId as string | number | bigint | null | undefined);
    const existingUser = candidateUserId
      ? await this.db.user.findUnique({
          where: { id: candidateUserId },
          select: { id: true }
        })
      : null;
    const record = await this.db.activityLog.create({
      data: {
        kitchenId: toOptionalBigIntId(input.kitchenId as string | number | bigint | null | undefined),
        userId: existingUser?.id ?? null,
        entityType: (input.entityType as string | undefined) ?? null,
        entityId: toOptionalBigIntId(input.entityId as string | number | bigint | null | undefined),
        eventType: (input.eventType as string | undefined) ?? null,
        description: String(input.description ?? ""),
        metadata: input.metadata ? JSON.stringify(serializeEntity(input.metadata)) : null
      }
    });

    return serializeEntity({
      id: record.id,
      kitchenId: record.kitchenId,
      userId: record.userId,
      entityType: record.entityType,
      entityId: record.entityId,
      eventType: record.eventType,
      description: record.description,
      metadata: record.metadata
    });
  }
}
