import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  createHermesKitcheniaAdapter,
  HermesLocalOrchestrator,
  HermesRuntimeBridge,
  HermesTransportService
} from "../../src/integrations/hermes/index.ts";
import { createHermesRouter } from "../../src/adapters/http/routes/hermes.ts";

describe("Hermes transport end to end", () => {
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
            id: "order_transport_1",
            status: "DRAFT"
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

  it("runs inbound HTTP request -> transport -> runtime bridge -> orchestrator -> adapter -> backend response -> outbound response", async () => {
    const adapter = createHermesKitcheniaAdapter({
      baseUrl,
      apiKey: "test-kitchenia-internal-key",
      authHeader: "Authorization",
      authScheme: "Bearer"
    });
    const orchestrator = new HermesLocalOrchestrator(adapter);
    const bridge = new HermesRuntimeBridge(orchestrator);
    const transport = new HermesTransportService(bridge);
    const app = express();

    app.use(express.json());
    app.use(createHermesRouter(transport));

    const response = await request(app)
      .post("/hermes/messages")
      .set("Authorization", "Bearer test-kitchenia-internal-key")
      .send({
        conversationId: "client-1",
        message: {
          text: "quiero pedir un taco",
          phone: "+529991112233",
          kitchenId: "2"
        },
        actionRequest: {
          action: "create_order_draft",
          payload: {
            items: [{ productName: "Taco", quantity: 1 }],
            deliveryType: "PICKUP",
            paymentMethod: "CASH",
            comments: "transport e2e"
          }
        }
      });

    expect(response.status).toBe(200);
    expect(capturedRequest.method).toBe("POST");
    expect(capturedRequest.url).toBe("/orders/draft");
    expect(capturedRequest.headers).toEqual(expect.objectContaining({
      "x-caller-context": '{"role":"CLIENT","phone":"+529991112233"}',
      authorization: "Bearer test-kitchenia-internal-key",
      "content-type": "application/json"
    }));
    expect(capturedRequest.body).toEqual({
      messageId: expect.stringMatching(/^hermes_create_order_draft_/),
      kitchenId: "2",
      orderId: null,
      items: [{ productName: "Taco", quantity: 1 }],
      deliveryType: "PICKUP",
      address: null,
      paymentMethod: "CASH",
      comments: "transport e2e"
    });
    expect(response.body.ok).toBe(true);
    expect(response.body.conversationId).toBe("client-1");
    expect(response.body.runtimeResult.orchestratorResult.adapterResult.data.orderId).toBe("order_transport_1");
    expect(response.body.outboundResponse).toEqual({
      status: "success",
      message: "draft_created",
      nextSuggestedAction: "get_order",
      actionExecuted: "create_order_draft",
      context: {
        orderId: "order_transport_1",
        orderStatus: "DRAFT",
        readyToConfirm: true,
        nextMissingField: null
      }
    });
    expect(response.body.state).toEqual({
      conversationId: "client-1",
      phone: "+529991112233",
      kitchenId: "2",
      orderId: "order_transport_1",
      lastAction: "create_order_draft",
      updatedAt: expect.any(String)
    });
  });
});
