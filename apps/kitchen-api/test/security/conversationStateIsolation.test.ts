import { describe, expect, it, vi } from "vitest";
import {
  HermesTransportService,
  InMemoryHermesConversationStore
} from "../../src/integrations/hermes/index.ts";

function createRuntimeResult(action: string, orderId?: string) {
  return {
    ok: true,
    inbound: {
      message: {
        text: "hola"
      }
    },
    actionRequest: {
      action,
      payload: {}
    },
    orchestratorResult: {
      ok: true,
      action,
      request: {
        action,
        payload: {}
      },
      adapterResult: {
        ok: true,
        action,
        statusCode: 200,
        data: orderId ? { orderId, orderStatus: "DRAFT" } : {},
        error: null,
        raw: null
      },
      finalResponse: {
        status: "success",
        summary: "ok",
        nextSuggestedAction: null,
        ...(orderId ? { context: { orderId, orderStatus: "DRAFT" } } : {})
      }
    },
    outboundResponse: {
      status: "success",
      message: "ok",
      nextSuggestedAction: null,
      actionExecuted: action,
      ...(orderId ? { context: { orderId, orderStatus: "DRAFT" } } : {})
    }
  };
}

describe("security: conversation state isolation", () => {
  it("isolates phone-derived conversation state by kitchen scope", async () => {
    const bridge = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(createRuntimeResult("create_order_draft", "order_k1"))
        .mockResolvedValueOnce(createRuntimeResult("create_order_draft", "order_k2"))
    };
    const store = new InMemoryHermesConversationStore();
    const service = new HermesTransportService(bridge as any, store);

    await service.execute(
      {
        message: {
          text: "quiero pedir",
          phone: "+529991112233",
          kitchenId: "1"
        },
        actionRequest: {
          action: "create_order_draft",
          payload: {
            items: [{ productName: "Taco", quantity: 1 }]
          }
        }
      },
      { allowCallerActionRequest: true }
    );

    await service.execute(
      {
        message: {
          text: "quiero pedir",
          phone: "+529991112233",
          kitchenId: "2"
        },
        actionRequest: {
          action: "create_order_draft",
          payload: {
            items: [{ productName: "Taco", quantity: 1 }]
          }
        }
      },
      { allowCallerActionRequest: true }
    );

    expect(bridge.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: expect.objectContaining({
          phone: "+529991112233",
          kitchenId: "1"
        })
      }),
      { allowCallerActionRequest: true }
    );
    expect(bridge.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining({
          phone: "+529991112233",
          kitchenId: "2"
        })
      }),
      { allowCallerActionRequest: true }
    );
    expect((bridge.execute as any).mock.calls[1][0].context.orderId).toBeUndefined();
  });

  it("ignores unsigned inbound scope overrides when stored conversation state already exists", async () => {
    const bridge = {
      execute: vi.fn().mockResolvedValue(createRuntimeResult("get_order", "order_safe"))
    };
    const store = new InMemoryHermesConversationStore();
    store.set({
      conversationId: "phone:+529991112233",
      phone: "+529991112233",
      kitchenId: "1",
      orderId: "order_safe",
      actorRole: "CLIENT",
      updatedAt: "2026-06-29T00:00:00.000Z"
    });
    const service = new HermesTransportService(bridge as any, store);

    await service.execute(
      {
        message: {
          text: "ver pedido",
          phone: "+529991112233"
        },
        context: {
          kitchenId: "999",
          orderId: "order_poisoned",
          actorRole: "KITCHEN"
        },
        actionRequest: {
          action: "get_order",
          payload: {}
        }
      },
      { allowCallerActionRequest: true }
    );

    expect(bridge.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          phone: "+529991112233",
          kitchenId: "1",
          orderId: "order_safe",
          actorRole: "CLIENT",
          metadata: undefined
        }
      }),
      { allowCallerActionRequest: true }
    );
  });

  it("ignores unsigned message-level scope overrides when trusted state already exists", async () => {
    const bridge = {
      execute: vi.fn().mockResolvedValue(createRuntimeResult("get_order", "order_safe"))
    };
    const store = new InMemoryHermesConversationStore();
    store.set({
      conversationId: "phone:+529991112233:kitchen:1",
      phone: "+529991112233",
      kitchenId: "1",
      orderId: "order_safe",
      actorRole: "CLIENT",
      updatedAt: "2026-06-29T00:00:00.000Z"
    }, "phone:+529991112233:kitchen:1");
    const service = new HermesTransportService(bridge as any, store);

    await service.execute(
      {
        message: {
          text: "ver pedido",
          phone: "+529991112233",
          kitchenId: "1",
          orderId: "order_poisoned",
          actorRole: "KITCHEN"
        },
        actionRequest: {
          action: "get_order",
          payload: {}
        }
      },
      { allowCallerActionRequest: true }
    );

    expect(bridge.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          phone: "+529991112233",
          kitchenId: "1",
          orderId: "order_safe",
          actorRole: "CLIENT",
          metadata: undefined
        }
      }),
      { allowCallerActionRequest: true }
    );
  });
});
