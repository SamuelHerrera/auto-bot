import { Router } from "express";
import { getStatusCodeForResult } from "../../../shared/errors";
import { executeUpsertClient } from "../../../application/usecases/clients";
import { validateUpsertClientRequest } from "../validators/clients";

export function createClientsRouter() {
  const router = Router();

  router.post("/clients", async (request, response, next) => {
    try {
      const result = await executeUpsertClient(validateUpsertClientRequest(request));
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
