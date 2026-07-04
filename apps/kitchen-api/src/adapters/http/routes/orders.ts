import { Router } from "express";
import { getStatusCodeForResult } from "../../../shared/errors";
import {
  executeChangeOrderStatus,
  executeCreateOrderDraft,
  executeGetOrder,
  executeQueryOrders
} from "../../../application/usecases/orders";
import {
  validateChangeOrderStatusRequest,
  validateCreateOrderDraftRequest,
  validateGetOrderRequest,
  validateQueryOrdersRequest
} from "../validators/orders";

export function createOrdersRouter() {
  const router = Router();

  router.post("/orders/draft", async (request, response, next) => {
    try {
      const input = validateCreateOrderDraftRequest(request);
      const result = await executeCreateOrderDraft(input);
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/orders/:orderId/status", async (request, response, next) => {
    try {
      const input = {
        ...validateChangeOrderStatusRequest(request),
        orderId: request.params.orderId
      };
      const result = await executeChangeOrderStatus(input);
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders/:orderId", async (request, response, next) => {
    try {
      const result = await executeGetOrder(validateGetOrderRequest(request));
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/orders", async (request, response, next) => {
    try {
      const result = await executeQueryOrders(validateQueryOrdersRequest(request));
      response.status(getStatusCodeForResult(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
