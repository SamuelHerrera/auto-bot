import { describe, expect, it, vi } from "vitest";
import { HermesLocalOrchestrator } from "../../src/integrations/hermes/index.ts";

describe("HermesLocalOrchestrator", () => {
  it("dispatches a structured action envelope to the adapter and returns the full output shape", async () => {
    const adapter = {
      execute: vi.fn(async () => ({
        ok: true,
        action: "create_order_draft",
        statusCode: 200,
        data: {
          orderId: "order_1",
          orderStatus: "DRAFT",
          readyToConfirm: true,
          nextMissingField: null
        },
        error: null,
        raw: { ok: true }
      }))
    };
    const orchestrator = new HermesLocalOrchestrator(adapter);

    const result = await orchestrator.execute({
      action: "create_order_draft",
      payload: {
        phone: "+529991112233",
        kitchenId: "2",
        items: [{ productName: "Taco", quantity: 1 }]
      }
    });

    expect(adapter.execute).toHaveBeenCalledWith("create_order_draft", {
      phone: "+529991112233",
      kitchenId: "2",
      items: [{ productName: "Taco", quantity: 1 }]
    });
    expect(result).toEqual({
      ok: true,
      action: "create_order_draft",
      request: {
        action: "create_order_draft",
        payload: {
          phone: "+529991112233",
          kitchenId: "2",
          items: [{ productName: "Taco", quantity: 1 }]
        }
      },
      adapterResult: expect.any(Object),
      finalResponse: {
        status: "success",
        summary: "draft_created",
        nextSuggestedAction: "get_order",
        context: {
          orderId: "order_1",
          orderStatus: "DRAFT",
          readyToConfirm: true,
          nextMissingField: null
        }
      }
    });
  });

  it("rejects invalid structured envelopes safely", async () => {
    const adapter = {
      execute: vi.fn()
    };
    const orchestrator = new HermesLocalOrchestrator(adapter);

    const result = await orchestrator.execute({
      action: "create_order_draft",
      payload: null
    });

    expect(adapter.execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.adapterResult.error.code).toBe("validation_error");
    expect(result.finalResponse.status).toBe("error");
  });

  it("suggests the next action for get_order while the order is still in DRAFT", async () => {
    const adapter = {
      execute: vi.fn(async () => ({
        ok: true,
        action: "get_order",
        statusCode: 200,
        data: {
          orderId: "order_1",
          orderStatus: "DRAFT"
        },
        error: null,
        raw: { ok: true }
      }))
    };
    const orchestrator = new HermesLocalOrchestrator(adapter);

    const result = await orchestrator.execute({
      action: "get_order",
      payload: {
        actor: {
          role: "CLIENT",
          phone: "+529991112233"
        },
        orderId: "order_1"
      }
    });

    expect(result.finalResponse.nextSuggestedAction).toBe("change_order_status");
  });

  it("propagates adapter errors into finalResponse", async () => {
    const adapter = {
      execute: vi.fn(async () => ({
        ok: false,
        action: "create_order_draft",
        statusCode: 400,
        data: null,
        error: {
          type: "missing_fields",
          code: "missing_fields",
          message: "missing_fields",
          details: {
            missingFields: ["items"]
          }
        },
        raw: { ok: false, error: "missing_fields" }
      }))
    };
    const orchestrator = new HermesLocalOrchestrator(adapter);

    const result = await orchestrator.execute({
      action: "create_order_draft",
      payload: {
        phone: "+529991112233",
        kitchenId: "2",
        items: []
      }
    });

    expect(result.ok).toBe(false);
    expect(result.adapterResult.error.code).toBe("missing_fields");
    expect(result.finalResponse).toEqual({
      status: "error",
      summary: "missing_fields",
      nextSuggestedAction: "create_order_draft",
      context: {
        missingFields: ["items"]
      }
    });
  });
});
