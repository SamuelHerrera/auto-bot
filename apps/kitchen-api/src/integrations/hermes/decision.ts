import { normalizeMexicanText } from "../../shared/normalize";
import type { HermesOrchestratorRequest, HermesRuntimeBridgeInput } from "./types";

type DecisionOptions = {
  fallbackToDraft: boolean;
  strictSeedFlow: boolean;
};

export function decideHermesActionByRules(
  input: HermesRuntimeBridgeInput,
  options: Partial<DecisionOptions> = {}
): HermesOrchestratorRequest {
  return decideHermesAction(input, {
    fallbackToDraft: options.fallbackToDraft ?? true,
    strictSeedFlow: options.strictSeedFlow ?? false
  });
}

export function decideHermesActionByStub(input: HermesRuntimeBridgeInput): HermesOrchestratorRequest {
  return decideHermesAction(input, {
    fallbackToDraft: false,
    strictSeedFlow: true
  });
}

function decideHermesAction(
  input: HermesRuntimeBridgeInput,
  options: DecisionOptions
): HermesOrchestratorRequest {
  const text = normalizeMexicanText(input.message.text);

  if (matchesAny(text, ["ver pendientes", "pedidos pendientes", "pendientes", "pending"])) {
    return {
      action: "query_orders",
      payload: {
        filter: "pending"
      } as any
    };
  }

  if (matchesAny(text, ["ver activas", "ver activos", "pedidos activos", "activos", "active", "en curso"])) {
    return {
      action: "query_orders",
      payload: {
        filter: "active"
      } as any
    };
  }

  if (matchesAny(text, ["ver completadas", "ver completados", "pedidos completados", "completados", "completed", "terminados", "entregados"])) {
    return {
      action: "query_orders",
      payload: {
        filter: "completed"
      } as any
    };
  }

  if (matchesAny(text, ["confirmar pedido", "confirmo pedido", "confirmar", "confirmo", "confirm"])) {
    return {
      action: "change_order_status",
      payload: {
        targetOrderStatus: "CONFIRMED"
      } as any
    };
  }

  if (matchesAny(text, ["ver mi pedido", "ver pedido", "mi pedido", "estado pedido", "status pedido", "donde va mi pedido", "get order"])) {
    return {
      action: "get_order",
      payload: {} as any
    };
  }

  if (matchesDraftIntent(text, options.strictSeedFlow)) {
    return {
      action: "create_order_draft",
      payload: {
        items: [
          {
            productName: "Taco",
            quantity: extractQuantity(text)
          }
        ],
        deliveryType: matchesAny(text, ["delivery", "domicilio"]) ? "DELIVERY" : "PICKUP",
        paymentMethod: matchesAny(text, ["transfer", "transferencia"]) ? "TRANSFER" : "CASH",
        comments: input.message.text
      } as any
    };
  }

  if (options.fallbackToDraft) {
    return {
      action: "create_order_draft",
      payload: {
        items: [
          {
            productName: "Taco",
            quantity: 1
          }
        ],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
        comments: input.message.text
      } as any
    };
  }

  const error: any = new Error("unable_to_decide_action");
  error.code = "unable_to_decide_action";
  error.details = {
    messageText: input.message.text
  };
  throw error;
}

function matchesDraftIntent(text: string, strictSeedFlow: boolean) {
  if (strictSeedFlow) {
    return matchesAny(text, ["quiero pedir un taco", "quiero pedir 1 taco", "pedir taco", "pedir un taco", "taco"]);
  }

  return matchesAny(text, ["quiero pedir", "pedir", "ordenar", "taco", "hacer pedido"]);
}

function extractQuantity(text: string) {
  const match = text.match(/\b(\d+)\b/);
  if (!match) {
    return 1;
  }

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function matchesAny(text: string, fragments: string[]) {
  return fragments.some((fragment) => text.includes(fragment));
}
