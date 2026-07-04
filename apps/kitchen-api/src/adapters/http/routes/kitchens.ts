import { Router } from "express";
import { getStatusCodeForResult } from "../../../shared/errors";
import {
  executeRegisterKitchen,
  executeRegisterWhatsappSession,
  executeUpdateKitchenConfiguration,
  executeUpsertAuthorizedContact
} from "../../../application/usecases/kitchens";
import {
  validateRegisterKitchenRequest,
  validateRegisterWhatsappSessionRequest,
  validateUpdateKitchenConfigurationRequest,
  validateUpsertAuthorizedContactRequest
} from "../validators/kitchens";

export function createKitchensRouter() {
  const router = Router();

  router.post("/kitchens", async (request, response, next) => {
    try {
      const result = await executeRegisterKitchen(validateRegisterKitchenRequest(request));
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/kitchens/:kitchenId/register-whatsapp-sessions", async (request, response, next) => {
    try {
      const body = validateRegisterWhatsappSessionRequest(request);
      const result = await executeRegisterWhatsappSession({
        ...body,
        kitchenId: request.params.kitchenId
      });
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/kitchens/:kitchenId", async (request, response, next) => {
    try {
      const body = validateUpdateKitchenConfigurationRequest(request);
      const result = await executeUpdateKitchenConfiguration({
        ...body,
        kitchenId: request.params.kitchenId
      });
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/kitchens/:kitchenId/authorized-contacts", async (request, response, next) => {
    try {
      const body = validateUpsertAuthorizedContactRequest(request);
      const result = await executeUpsertAuthorizedContact({
        ...body,
        kitchenId: request.params.kitchenId
      });
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
