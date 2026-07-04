import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createHermesKitcheniaAdapter, HermesLocalOrchestrator, HermesRuntimeBridge } from "../../src/integrations/hermes/index.ts";

describe("Hermes integration end to end", () => {
  let server;
  let baseUrl;
  let capturedRequest;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks = [];

      for await (const chunk of request) {
        chunks.push(chunk);
      }

      capturedRequest = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
      };

      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          ok: true,
          order: {
            id: "order_1",
            status: "DRAFT",
            items: [
              {
                id: "line_1",
                menuItemId: "menu_item_1",
                productPortionId: "product_portion_1",
                nameSnapshot: "Taco",
                quantity: 1,
                unitPriceSnapshot: 75,
                lineTotal: 75
              }
            ],
            subtotal: 75,
            deliveryFee: 0,
            total: 75,
            comments: "bridge e2e"
          },
          readyToConfirm: true,
          nextMissingField: null
        })
      );
    });

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (!server) {
      return;
    }

    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("runs inbound message -> runtime bridge -> orchestrator -> adapter -> backend response -> outbound result", async () => {
    const adapter = createHermesKitcheniaAdapter({
      baseUrl
    });
    const orchestrator = new HermesLocalOrchestrator(adapter);
    const bridge = new HermesRuntimeBridge(orchestrator);

    const result = await bridge.execute(
      {
        message: {
          text: "quiero pedir un taco",
          phone: "+529991112233",
          kitchenId: "2"
        },
        context: {
          phone: "+529991112233",
          kitchenId: "2"
        },
        actionRequest: {
          action: "create_order_draft",
          payload: {
            items: [{ productName: "Taco", quantity: 1 }],
            deliveryType: "PICKUP",
            paymentMethod: "CASH",
            comments: "bridge e2e"
          }
        }
      },
      { allowCallerActionRequest: true }
    );

    expect(capturedRequest).toEqual({
      method: "POST",
      url: "/orders/draft",
      headers: expect.objectContaining({
        "x-caller-context": '{"role":"CLIENT","phone":"+529991112233"}',
        "content-type": "application/json"
      }),
      body: {
        messageId: expect.stringMatching(/^hermes_create_order_draft_/),
        kitchenId: "2",
        orderId: null,
        items: [{ productName: "Taco", quantity: 1 }],
        deliveryType: "PICKUP",
        address: null,
        paymentMethod: "CASH",
        comments: "bridge e2e"
      }
    });
    expect(result.ok).toBe(true);
    expect(result.actionRequest).toEqual({
      action: "create_order_draft",
      payload: {
        phone: "+529991112233",
        kitchenId: "2",
        items: [{ productName: "Taco", quantity: 1 }],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
        comments: "bridge e2e"
      }
    });
    expect(result.orchestratorResult.adapterResult.statusCode).toBe(200);
    expect(result.orchestratorResult.adapterResult.data.orderStatus).toBe("DRAFT");
    expect(result.outboundResponse).toEqual({
      status: "success",
      message: "draft_created",
      nextSuggestedAction: "get_order",
      actionExecuted: "create_order_draft",
      context: {
        orderId: "order_1",
        orderStatus: "DRAFT",
        readyToConfirm: true,
        nextMissingField: null
      }
    });
  });
});
