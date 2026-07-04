import { Router } from "express";
import { getStatusCodeForResult } from "../../../shared/errors";
import { executeGetCurrentMenu, executePublishMenu, executeUpsertMenuProduct } from "../../../application/usecases/menus";
import { validateGetCurrentMenuRequest, validatePublishMenuRequest, validateUpsertMenuProductRequest } from "../validators/menus";

export function createMenusRouter() {
  const router = Router();

  router.get("/kitchens/:kitchenId/menus", async (request, response, next) => {
    try {
      const result = await executeGetCurrentMenu(validateGetCurrentMenuRequest(request));
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/kitchens/:kitchenId/menus", async (request, response, next) => {
    try {
      const body = validatePublishMenuRequest(request);
      const result = await executePublishMenu({
        ...body,
        kitchenId: request.params.kitchenId
      });
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/kitchens/:kitchenId/menu-products", async (request, response, next) => {
    try {
      const body = validateUpsertMenuProductRequest(request);
      const result = await executeUpsertMenuProduct({
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
