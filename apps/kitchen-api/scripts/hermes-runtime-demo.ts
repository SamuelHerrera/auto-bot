type HermesTransportRequest = {
  conversationId?: string;
  message: {
    text: string;
    id?: string;
    phone?: string;
    kitchenId?: string;
    actorRole?: "CLIENT" | "KITCHEN";
  };
  context?: Record<string, unknown>;
  actionRequest?: {
    action: string;
    payload: Record<string, unknown>;
  };
};

type HermesRuntimeDiagnosticResult = {
  ok: boolean;
  state?: {
    orderId?: string;
  };
  bridge?: {
    actionRequest?: {
      action?: string;
    };
  };
  kitchenia?: {
    body?: {
      order?: {
        id?: string;
        status?: string;
      };
    };
  };
  error?: string;
};

async function main() {
  const mode = getFlagValue("--mode") ?? "structured";
  const providerDriven = mode === "provider";
  const managerBaseUrl = (process.env.WHATSAPP_MANAGER_BASE_URL ?? "http://localhost:4100").replace(/\/+$/, "");
  const opsToken = process.env.WHATSAPP_MANAGER_INTERNAL_API_KEY ?? "local-whatsapp-manager-ops-key";
  const kitchenId = process.env.HERMES_DEMO_KITCHEN_ID ?? "2";
  const clientPhone = process.env.HERMES_DEMO_PHONE ?? `+5299${String(Date.now()).slice(-8)}`;
  const clientConversationId = `client-${Date.now()}`;
  const kitchenConversationId = `kitchen-${Date.now()}`;

  await waitForServer(managerBaseUrl);
  console.log("Hermes runtime diagnostic demo");
  console.log(`WhatsApp Manager URL: ${managerBaseUrl}`);
  console.log(`Demo mode: ${providerDriven ? "provider-driven" : "structured"}`);
  console.log(`Kitchen ID: ${kitchenId}`);
  console.log(`Client phone: ${clientPhone}`);

  const createDraft = await postMessage(managerBaseUrl, opsToken, {
    conversationId: clientConversationId,
    message: {
      id: `runtime-demo-draft-${Date.now()}`,
      text: "Quiero pedir 1 Taco",
      phone: clientPhone,
      kitchenId
    },
    ...(providerDriven
      ? {}
      : {
          actionRequest: {
            action: "create_order_draft",
            payload: {
              items: [{ productName: "Taco", quantity: 1 }],
              deliveryType: "PICKUP",
              paymentMethod: "CASH",
              comments: "Hermes runtime transport demo"
            }
          }
        })
  });
  printStep("create draft", createDraft);

  const orderId = String(
    createDraft.state?.orderId ??
    createDraft.kitchenia?.body?.order?.id ??
    ""
  );
  if (!createDraft.ok || !orderId) {
    process.exitCode = 1;
    return;
  }

  const getOrder = await postMessage(managerBaseUrl, opsToken, {
    conversationId: clientConversationId,
    message: {
      id: `runtime-demo-read-${Date.now()}`,
      text: "Ver mi pedido"
    },
    ...(providerDriven
      ? {}
      : {
          actionRequest: {
            action: "get_order",
            payload: {}
          }
        })
  });
  printStep("get order", getOrder);

  const confirmOrder = await postMessage(managerBaseUrl, opsToken, {
    conversationId: clientConversationId,
    message: {
      id: `runtime-demo-confirm-${Date.now()}`,
      text: "Confirmar pedido"
    },
    ...(providerDriven
      ? {}
      : {
          actionRequest: {
            action: "change_order_status",
            payload: {
              targetOrderStatus: "CONFIRMED"
            }
          }
        })
  });
  printStep("confirm order", confirmOrder);

  const queryActive = await postMessage(managerBaseUrl, opsToken, {
    conversationId: kitchenConversationId,
    message: {
      id: `runtime-demo-active-${Date.now()}`,
      text: "Ver pedidos activos",
      kitchenId,
      actorRole: "KITCHEN"
    },
    ...(providerDriven
      ? {}
      : {
          actionRequest: {
            action: "query_orders",
            payload: {
              filter: "active"
            }
          }
        })
  });
  printStep("query active", queryActive);

  if (!getOrder.ok || !confirmOrder.ok || !queryActive.ok) {
    process.exitCode = 1;
  }
}

async function postMessage(
  managerBaseUrl: string,
  opsToken: string,
  request: HermesTransportRequest
): Promise<HermesRuntimeDiagnosticResult> {
  const response = await fetch(`${managerBaseUrl}/diagnostics/hermes-runtime/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opsToken}`
    },
    body: JSON.stringify(request)
  });
  return await response.json() as HermesRuntimeDiagnosticResult;
}

function printStep(label: string, result: Record<string, any>) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(result, null, 2));
}

function getFlagValue(flagName: string) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

async function waitForServer(baseUrl: string) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the API is reachable or timeout expires.
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`KitchenIA backend did not become reachable at ${baseUrl} within 15 seconds.`);
}

main().catch((error) => {
  console.error("Hermes runtime transport demo failed.");
  console.error(error);
  process.exitCode = 1;
});
