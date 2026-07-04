import { describe, expect, it, vi } from "vitest";
import { HermesRuntimeBridge } from "../../src/integrations/hermes/index.ts";

describe("HermesRuntimeBridge", () => {
  it("accepts message/context input, hydrates a structured action, and calls the orchestrator", async () => {
    const orchestrator = {
      execute: vi.fn(async (request) => ({
        ok: true,
        action: request.action,
        request,
        adapterResult: {
          ok: true,
          action: request.action,
          statusCode: 200,
          data: {
            orderId: "order_1",
            orderStatus: "DRAFT"
          },
          error: null,
          raw: { ok: true }
        },
        finalResponse: {
          status: "success",
          summary: "draft_created",
          nextSuggestedAction: "get_order",
          context: {
            orderId: "order_1"
          }
        }
      }))
    };
    const bridge = new HermesRuntimeBridge(orchestrator);

    const result = await bridge.execute(
      {
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
            paymentMethod: "CASH"
          }
        }
      },
      { allowCallerActionRequest: true }
    );

    expect(orchestrator.execute).toHaveBeenCalledWith({
      action: "create_order_draft",
      payload: {
        phone: "+529991112233",
        kitchenId: "2",
        items: [{ productName: "Taco", quantity: 1 }],
        deliveryType: "PICKUP",
        paymentMethod: "CASH"
      }
    });
    expect(result.outboundResponse).toEqual({
      status: "success",
      message: "draft_created",
      nextSuggestedAction: "get_order",
      actionExecuted: "create_order_draft",
      context: {
        orderId: "order_1"
      }
    });
  });

  it("rejects malformed provider outputs safely", async () => {
    const orchestrator = {
      execute: vi.fn()
    };
    const provider = {
      decideAction: vi.fn(() => "not-an-action-request")
    };
    const bridge = new HermesRuntimeBridge(orchestrator, provider);

    const result = await bridge.execute({
      message: {
        text: "quiero pedir"
      }
    });

    expect(provider.decideAction).toHaveBeenCalled();
    expect(orchestrator.execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.orchestratorResult).toBe(null);
    expect(result.outboundResponse.status).toBe("error");
    expect(result.outboundResponse.message).toBe("validation_error");
  });

  it("passes provider-selected actions through the orchestrator and preserves outbound shaping", async () => {
    const orchestrator = {
      execute: vi.fn(async (request) => ({
        ok: false,
        action: request.action,
        request,
        adapterResult: {
          ok: false,
          action: request.action,
          statusCode: 404,
          data: null,
          error: {
            type: "order_not_found",
            code: "order_not_found",
            message: "order_not_found"
          },
          raw: { ok: false, error: "order_not_found" }
        },
        finalResponse: {
          status: "error",
          summary: "order_not_found",
          nextSuggestedAction: "get_order"
        }
      }))
    };
    const provider = {
      decideAction: vi.fn(() => ({
        action: "get_order",
        payload: {
          actor: {
            role: "CLIENT",
            phone: "+529991112233"
          },
          orderId: "123"
        }
      }))
    };
    const bridge = new HermesRuntimeBridge(orchestrator, provider);

    const result = await bridge.execute({
      message: {
        text: "donde esta mi pedido"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.actionRequest).toEqual({
      action: "get_order",
      payload: {
        actor: {
          role: "CLIENT",
          phone: "+529991112233"
        },
        orderId: "123"
      }
    });
    expect(result.outboundResponse).toEqual({
      status: "error",
      message: "order_not_found",
      nextSuggestedAction: "get_order",
      actionExecuted: "get_order"
    });
  });

  it("returns a clear runtime error when the provider is misconfigured", async () => {
    const orchestrator = {
      execute: vi.fn()
    };
    const provider = {
      decideAction: vi.fn(() => {
        const error = new Error("provider_misconfigured");
        error.code = "provider_misconfigured";
        error.details = {
          mode: "http",
          reason: "missing_provider_url",
          requiredEnv: ["HERMES_PROVIDER_URL"]
        };
        throw error;
      })
    };
    const bridge = new HermesRuntimeBridge(orchestrator, provider);

    const result = await bridge.execute({
      message: {
        text: "quiero pedir"
      }
    });

    expect(orchestrator.execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.outboundResponse).toEqual({
      status: "error",
      message: "provider_misconfigured",
      nextSuggestedAction: null,
      actionExecuted: null,
      context: {
        mode: "http",
        reason: "missing_provider_url",
        requiredEnv: ["HERMES_PROVIDER_URL"]
      }
    });
  });

  it("rejects caller-supplied actionRequest unless the runtime bridge is invoked from a trusted internal path", async () => {
    const orchestrator = {
      execute: vi.fn()
    };
    const bridge = new HermesRuntimeBridge(orchestrator);

    const result = await bridge.execute({
      message: {
        text: "quiero pedir un taco",
        phone: "+529991112233"
      },
      actionRequest: {
        action: "create_order_draft",
        payload: {
          items: [{ productName: "Taco", quantity: 1 }]
        }
      }
    });

    expect(orchestrator.execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.outboundResponse).toEqual({
      status: "error",
      message: "action_not_allowed",
      nextSuggestedAction: null,
      actionExecuted: null
    });
  });
});
