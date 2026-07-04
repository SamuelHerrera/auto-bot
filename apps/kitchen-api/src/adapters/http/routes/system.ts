import { Router } from "express";
import { prisma } from "../../../infrastructure/prisma";

export function createSystemRouter() {
  const router = Router();

  router.get("/healthz", (_request, response) => {
    response.status(200).json({
      ok: true,
      service: "kitchenia-backend",
      status: "healthy"
    });
  });

  router.get("/readyz", async (_request, response) => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");

      response.status(200).json({
        ok: true,
        service: "kitchenia-backend",
        status: "ready"
      });
    } catch (error: any) {
      response.status(503).json({
        ok: false,
        service: "kitchenia-backend",
        status: "not_ready",
        error: "service_not_ready"
      });
    }
  });

  return router;
}
