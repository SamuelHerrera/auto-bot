import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  HermesTransportService,
  InMemoryHermesConversationStore
} from "../../src/integrations/hermes/index.ts";
import { createHermesRouter } from "../../src/adapters/http/routes/hermes.ts";
import { loadHttpApp } from "../setup/http-app.js";

describe("Hermes transport", () => {
  it("merges stored context, executes the runtime bridge, and persists updated conversation state", async () => {
    const bridge = {
      execute: vi.fn(async (input) => ({
        ok: true,
        inbound: input,
        actionRequest: {
          action: "get_order",
          payload: {
            orderId: "55"
          }
        },
        orchestratorResult: {
          ok: true,
          action: "get_order",
          request: {
            action: "get_order",
            payload: {
              orderId: "55"
            }
          },
          adapterResult: {
            ok: true,
            action: "get_order",
            statusCode: 200,
            data: {
              orderId: "55",
              orderStatus: "DRAFT"
            },
            error: null,
            raw: null
          },
          finalResponse: {
            status: "success",
            summary: "order_retrieved",
            nextSuggestedAction: "change_order_status",
            context: {
              orderId: "55",
              orderStatus: "DRAFT"
            }
          }
        },
        outboundResponse: {
          status: "success",
          message: "order_retrieved",
          nextSuggestedAction: "change_order_status",
          actionExecuted: "get_order",
          context: {
            orderId: "55",
            orderStatus: "DRAFT"
          }
        }
      }))
    };
    const store = new InMemoryHermesConversationStore();

    store.set({
      conversationId: "phone:+529991112233",
      phone: "+529991112233",
      kitchenId: "2",
      updatedAt: "2026-06-28T00:00:00.000Z"
    });

    const service = new HermesTransportService(bridge, store);
    const result = await service.execute(
      {
        message: {
          text: "ver pedido",
          phone: "+529991112233"
        },
        actionRequest: {
          action: "get_order",
          payload: {}
        }
      },
      { allowCallerActionRequest: true }
    );

    expect(bridge.execute).toHaveBeenCalledWith(
      {
        message: {
          text: "ver pedido",
          phone: "+529991112233"
        },
        context: {
          phone: "+529991112233",
          kitchenId: "2",
          orderId: undefined,
          actorRole: undefined,
          metadata: undefined
        },
        actionRequest: {
          action: "get_order",
          payload: {}
        }
      },
      {
        allowCallerActionRequest: true
      }
    );
    expect(result.conversationId).toBe("phone:+529991112233");
    expect(result.state).toEqual({
      conversationId: "phone:+529991112233",
      phone: "+529991112233",
      kitchenId: "2",
      orderId: "55",
      lastAction: "get_order",
      updatedAt: expect.any(String)
    });
    expect(store.get("phone:+529991112233")).toEqual(result.state);
  });

  it("exposes the Hermes HTTP transport route with the normalized response envelope", async () => {
    const transportService = {
      execute: vi.fn(async (input) => ({
        ok: true,
        conversationId: "conversation-1",
        request: input,
        runtimeResult: {
          ok: true,
          inbound: input,
          actionRequest: {
            action: "create_order_draft",
            payload: {
              items: [{ productName: "Taco", quantity: 1 }]
            }
          },
          orchestratorResult: null,
          outboundResponse: {
            status: "success",
            message: "draft_created",
            nextSuggestedAction: "get_order",
            actionExecuted: "create_order_draft"
          }
        },
        state: {
          conversationId: "conversation-1",
          phone: "+529991112233",
          updatedAt: "2026-06-28T00:00:00.000Z"
        },
        outboundResponse: {
          status: "success",
          message: "draft_created",
          nextSuggestedAction: "get_order",
          actionExecuted: "create_order_draft"
        }
      }))
    };
    const app = express();

    app.use(express.json());
    app.use(createHermesRouter(transportService));

    const response = await request(app)
      .post("/hermes/messages")
      .set("Authorization", "Bearer test-kitchenia-internal-key")
      .send({
        conversationId: "conversation-1",
        message: {
          text: "quiero pedir un taco"
        }
      });

    expect(response.status).toBe(200);
    expect(transportService.execute).toHaveBeenCalledWith(
      {
        conversationId: "conversation-1",
        message: {
          text: "quiero pedir un taco"
        }
      },
      {
        allowCallerActionRequest: true
      }
    );
    expect(response.body).toEqual({
      ok: true,
      conversationId: "conversation-1",
      request: {
        conversationId: "conversation-1",
        message: {
          text: "quiero pedir un taco"
        }
      },
      runtimeResult: {
        ok: true,
        inbound: {
          conversationId: "conversation-1",
          message: {
            text: "quiero pedir un taco"
          }
        },
        actionRequest: {
          action: "create_order_draft",
          payload: {
            items: [{ productName: "Taco", quantity: 1 }]
          }
        },
        orchestratorResult: null,
        outboundResponse: {
          status: "success",
          message: "draft_created",
          nextSuggestedAction: "get_order",
          actionExecuted: "create_order_draft"
        }
      },
      state: {
        conversationId: "conversation-1",
        phone: "+529991112233",
        updatedAt: "2026-06-28T00:00:00.000Z"
      },
      outboundResponse: {
        status: "success",
        message: "draft_created",
        nextSuggestedAction: "get_order",
        actionExecuted: "create_order_draft"
      }
    });
  });

  it("returns 400 invalid_json for malformed inbound JSON", async () => {
    const app = await loadHttpApp();

    const response = await request(app)
      .post("/hermes/messages")
      .set("Authorization", "Bearer test-kitchenia-internal-key")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      ok: false,
      error: "invalid_json"
    });
  });

  it("rejects caller-supplied actionRequest when transport execution is not explicitly trusted", async () => {
    const service = new HermesTransportService({
      execute: vi.fn()
    });

    await expect(
      service.execute({
        message: {
          text: "quiero pedir"
        },
        actionRequest: {
          action: "create_order_draft",
          payload: {
            items: [{ productName: "Taco", quantity: 1 }]
          }
        }
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "action_not_allowed"
    });
  });
});
