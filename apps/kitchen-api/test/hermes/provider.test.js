import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  HermesHttpProvider,
  HermesMisconfiguredProvider,
  HermesRulesProvider
} from "../../src/integrations/hermes/index.ts";

describe("Hermes providers", () => {
  it("maps a local order message to a structured draft action", () => {
    const provider = new HermesRulesProvider();

    const action = provider.decideAction({
      message: {
        text: "Quiero pedir 2 tacos con efectivo",
        phone: "+529991112233",
        kitchenId: "2"
      }
    });

    expect(action).toEqual({
      action: "create_order_draft",
      payload: {
        items: [{ productName: "Taco", quantity: 2 }],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
        comments: "Quiero pedir 2 tacos con efectivo"
      }
    });
  });

  it("maps kitchen query messages to the corresponding filter action", () => {
    const provider = new HermesRulesProvider();

    expect(
      provider.decideAction({
        message: {
          text: "muestrame pedidos completados",
          kitchenId: "2",
          actorRole: "KITCHEN"
        }
      })
    ).toEqual({
      action: "query_orders",
      payload: {
        filter: "completed"
      }
    });
  });

  it("does not turn unrelated chat into a draft order", () => {
    const provider = new HermesRulesProvider();

    expect(() =>
      provider.decideAction({
        message: {
          text: "hola",
          phone: "+529991112233",
          kitchenId: "2"
        }
      })
    ).toThrowError("unable_to_decide_action");
  });

  it("raises a clear error when http provider mode is selected without required configuration", () => {
    const provider = new HermesMisconfiguredProvider("http", {
      reason: "missing_provider_url",
      requiredEnv: ["HERMES_PROVIDER_URL"]
    });

    expect(() => provider.decideAction()).toThrowError("provider_misconfigured");
  });

  describe("HermesHttpProvider", () => {
    let server;
    let providerUrl;
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
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        };

        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            actionRequest: {
              action: "get_order",
              payload: {}
            }
          })
        );
      });

      await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          providerUrl = `http://127.0.0.1:${address.port}/decide`;
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

    it("calls an external provider endpoint and accepts a structured action response", async () => {
      const provider = new HermesHttpProvider({
        url: providerUrl,
        apiKey: "secret-token"
      });

      const action = await provider.decideAction({
        message: {
          text: "quiero ver mi pedido",
          phone: "+529991112233"
        },
        context: {
          orderId: "25"
        }
      });

      expect(capturedRequest).toEqual({
        method: "POST",
        url: "/decide",
        headers: expect.objectContaining({
          authorization: "Bearer secret-token",
          "content-type": "application/json"
        }),
        body: {
          message: {
            text: "quiero ver mi pedido",
            phone: "+529991112233"
          },
          context: {
            orderId: "25"
          },
          supportedActions: [
            "create_order_draft",
            "get_order",
            "change_order_status",
            "query_orders"
          ]
        }
      });
      expect(action).toEqual({
        action: "get_order",
        payload: {}
      });
    });
  });
});
