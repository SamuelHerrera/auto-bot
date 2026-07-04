import { Router } from "express";
import { getStatusCodeForResult } from "../../../shared/errors";
import { executeGetPrintQueue } from "../../../application/usecases/printing";
import { validateGetPrintQueueRequest } from "../validators/printing";

export function createPrintingRouter() {
  const router = Router();

  router.get("/kitchens/:kitchenId/print-queue", async (request, response, next) => {
    try {
      const result = await executeGetPrintQueue(validateGetPrintQueueRequest(request));
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
