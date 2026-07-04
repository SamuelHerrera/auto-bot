import { afterEach, describe, expect, it, vi } from "vitest";
import { HermesKitcheniaAdapter, KitcheniaHttpClient } from "../../src/integrations/hermes/index.ts";

function createFakeClient(responseOverrides = {}) {
  return {
    post: vi.fn(async (path, actor, body) => ({
      statusCode: 200,
      body: {
        ok: true,
        order: {
          id: "order_1",
          status: "DRAFT"
        },
        readyToConfirm: true,
        nextMissingField: null,
        ...responseOverrides
      }
    })),
    get: vi.fn(async (path, actor, query) => ({
      statusCode: 200,
      body: {
        ok: true,
        order: {
          id: "order_1",
          status: "DRAFT"
        },
        orders: [],
        ...responseOverrides
      }
    }))
  };
}

describe("HermesKitcheniaAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps create_order_draft to POST /orders/draft, canonicalizes phone, and auto-generates messageId", async () => {
    const client = createFakeClient();
    const adapter = new HermesKitcheniaAdapter(client);

    const result = await adapter.execute("create_order_draft", {
      phone: "9991112233",
      kitchenId: 2,
      items: [{ productName: "Taco", quantity: 1 }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH"
    });

    expect(client.post).toHaveBeenCalledWith(
      "/orders/draft",
      {
        role: "CLIENT",
        phone: "+529991112233"
      },
      expect.objectContaining({
        kitchenId: "2",
        deliveryType: "PICKUP",
        paymentMethod: "CASH"
      })
    );

    expect(client.post.mock.calls[0][2].messageId).toMatch(/^hermes_create_order_draft_/);
    expect(result.ok).toBe(true);
    expect(result.data.messageId).toMatch(/^hermes_create_order_draft_/);
  });

  it("maps get_order and query_orders to the correct GET endpoints", async () => {
    const client = createFakeClient({
      orders: [{ id: "order_1", status: "DRAFT", total: 75 }]
    });
    const adapter = new HermesKitcheniaAdapter(client);

    await adapter.execute("get_order", {
      actor: {
        role: "CLIENT",
        phone: "5219991112233"
      },
      orderId: 123
    });

    await adapter.execute("query_orders", {
      actor: {
        role: "KITCHEN",
        kitchenId: 2
      },
      filter: "pending"
    });

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      "/orders/123",
      {
        role: "CLIENT",
        phone: "+529991112233"
      }
    );
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      "/orders",
      {
        role: "KITCHEN",
        kitchenId: "2"
      },
      {
        filter: "pending",
        limit: undefined
      }
    );
  });

  it("maps change_order_status to POST /orders/:id/status and auto-generates messageId", async () => {
    const client = createFakeClient({
      order: {
        id: "order_1",
        status: "CONFIRMED"
      }
    });
    const adapter = new HermesKitcheniaAdapter(client);

    const result = await adapter.execute("change_order_status", {
      actor: {
        role: "CLIENT",
        phone: "+529991112233"
      },
      orderId: "1",
      targetOrderStatus: "CONFIRMED"
    });

    expect(client.post).toHaveBeenCalledWith(
      "/orders/1/status",
      {
        role: "CLIENT",
        phone: "+529991112233"
      },
      expect.objectContaining({
        targetOrderStatus: "CONFIRMED"
      })
    );
    expect(client.post.mock.calls[0][2].messageId).toMatch(/^hermes_change_order_status_/);
    expect(result.data.messageId).toMatch(/^hermes_change_order_status_/);
  });

  it("normalizes backend errors into Hermes adapter errors", async () => {
    const client = {
      post: vi.fn(async () => ({
        statusCode: 404,
        body: {
          ok: false,
          error: "product_not_found",
          productChoices: []
        }
      })),
      get: vi.fn()
    };
    const adapter = new HermesKitcheniaAdapter(client);

    const result = await adapter.execute("create_order_draft", {
      phone: "+529991112233",
      kitchenId: "2",
      items: [{ productName: "Inexistente", quantity: 1 }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH"
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toEqual({
      type: "product_not_found",
      code: "product_not_found",
      message: "product_not_found",
      details: {
        productChoices: []
      }
    });
  });
});

describe("KitcheniaHttpClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes x-caller-context as JSON headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    const client = new KitcheniaHttpClient({
      baseUrl: "http://example.test"
    });

    await client.post(
      "/orders/draft",
      {
        role: "CLIENT",
        phone: "+529991112233"
      },
      {
        messageId: "msg_1"
      }
    );

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers["x-caller-context"]).toBe('{"role":"CLIENT","phone":"+529991112233"}');
    expect(options.headers["Content-Type"]).toBe("application/json");
  });
});
