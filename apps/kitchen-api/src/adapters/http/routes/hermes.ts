import { Router, type Request } from "express";
import { createHermesTransportService, type HermesTransportService } from "../../../integrations/hermes";
import { createError } from "../../../shared/errors";
import { config } from "../../../infrastructure/config";
import { HERMES_LOCAL_IDENTITY_HEADER } from "../../../integrations/hermes/local-identity";
import { prisma } from "../../../infrastructure/prisma";
import { normalizeMexicanPhone } from "../../../shared/normalize";

const defaultTransportService = createHermesTransportService();

function isTrustedInternalHermesRequest(request: { get(name: string): string | undefined }) {
  const authHeaderValue = request.get(config.hermes.kitcheniaAuthHeader);

  if (!authHeaderValue) {
    return false;
  }

  if ((process.env.NODE_ENV ?? "development") === "test") {
    return true;
  }

  const expectedApiKey = (
    config.hermes.kitcheniaApiKey.trim() ||
    (((process.env.NODE_ENV ?? "development") === "test") ? "test-kitchenia-internal-key" : "")
  ).trim();

  if (!expectedApiKey) {
    return false;
  }

  return authHeaderValue.trim() === `${config.hermes.kitcheniaAuthScheme} ${expectedApiKey}`.trim();
}

export function createHermesRouter(transportService: HermesTransportService = defaultTransportService) {
  const router = Router();

  router.post("/hermes/local/bootstrap-identity", async (request, response, next) => {
    try {
      if (!config.hermes.localIdentityEnabled || !config.hermes.localBootstrapEnabled) {
        throw createError(404, "route_not_found");
      }

      const actor = (request as Request & {
        actor?: {
          platformAccess?: boolean;
          id?: string;
        };
      }).actor;

      if (!actor?.platformAccess || !actor.id) {
        throw createError(403, "action_not_allowed");
      }

      const role = typeof request.body?.role === "string" ? request.body.role.trim().toUpperCase() : "";
      const kitchenId = request.body?.kitchenId !== undefined && request.body?.kitchenId !== null
        ? String(request.body.kitchenId).trim()
        : "";
      const phone = typeof request.body?.phone === "string" ? normalizeMexicanPhone(request.body.phone) : "";
      const name = typeof request.body?.name === "string" && request.body.name.trim() !== ""
        ? request.body.name.trim()
        : `Hermes Local ${role || "Actor"}`;

      if (!["KITCHEN", "DELIVERER"].includes(role) || !kitchenId || !phone) {
        throw createError(400, "missing_fields", {
          missingFields: [
            ...(!["KITCHEN", "DELIVERER"].includes(role) ? ["role"] : []),
            ...(kitchenId ? [] : ["kitchenId"]),
            ...(phone ? [] : ["phone"])
          ]
        } as any);
      }

      const kitchen = await prisma.kitchen.findUnique({
        where: { id: BigInt(kitchenId) },
        select: { id: true }
      });

      if (!kitchen) {
        throw createError(404, "order_not_found");
      }

      const normalizedPhone = normalizeMexicanPhone(phone);
      const existingLinkedPhone = await prisma.linkedPhone.findFirst({
        where: {
          kitchenId: kitchen.id,
          normalizedPhone
        },
        include: {
          user: true
        },
        orderBy: { id: "desc" }
      });

      let user;

      if (existingLinkedPhone?.user) {
        user = await prisma.user.update({
          where: { id: existingLinkedPhone.user.id },
          data: {
            kitchenId: kitchen.id,
            name,
            role,
            isActive: true
          }
        });

        await prisma.linkedPhone.update({
          where: { id: existingLinkedPhone.id },
          data: {
            phone,
            normalizedPhone
          }
        });
      } else {
        user = await prisma.user.create({
          data: {
            kitchenId: kitchen.id,
            name,
            role,
            isActive: true
          }
        });

        await prisma.linkedPhone.create({
          data: {
            kitchenId: kitchen.id,
            userId: user.id,
            phone,
            normalizedPhone
          }
        });
      }

      response.status(200).json({
        ok: true,
        actor: {
          role,
          kitchenId: kitchen.id.toString(),
          phone,
          id: user.id.toString(),
          ...(role === "KITCHEN" ? { contactId: user.id.toString() } : {})
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/hermes/messages", async (request, response, next) => {
    try {
      const hasLocalIdentity =
        config.hermes.localIdentityEnabled &&
        Boolean(request.get(config.hermes.localIdentityHeader ?? HERMES_LOCAL_IDENTITY_HEADER));

      if (!hasLocalIdentity && !isTrustedInternalHermesRequest(request)) {
        throw createError(403, "action_not_allowed");
      }

      const result = await transportService.execute(request.body, {
        allowCallerActionRequest: true
      });
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
