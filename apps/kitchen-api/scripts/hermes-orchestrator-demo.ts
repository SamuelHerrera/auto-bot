import { readFile } from "node:fs/promises";
import {
  createHermesLocalOrchestrator,
  type HermesActionName,
  type HermesOrchestratorRequest
} from "../src/integrations/hermes";

async function main() {
  const orchestrator = createHermesLocalOrchestrator();
  const requestFile = getFlagValue("--input");
  const scenario = getFlagValue("--scenario") ?? "full-order-flow";
  const baseUrl = process.env.HERMES_KITCHENIA_BASE_URL ?? "http://localhost:3000";

  await waitForBackend(baseUrl);

  if (requestFile) {
    const request = await loadRequestFile(requestFile);
    const result = await orchestrator.execute(request as HermesOrchestratorRequest);
    printStep("single-action", result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (scenario !== "full-order-flow") {
    throw new Error(`Unsupported scenario: ${scenario}`);
  }

  const kitchenId = process.env.HERMES_DEMO_KITCHEN_ID ?? "2";
  const phone = process.env.HERMES_DEMO_PHONE ?? `+5299${String(Date.now()).slice(-8)}`;

  console.log("Hermes orchestrator demo");
  console.log(`Scenario: ${scenario}`);
  console.log(`Backend URL: ${baseUrl}`);
  console.log(`Kitchen ID: ${kitchenId}`);
  console.log(`Client phone: ${phone}`);

  const steps: Array<{ label: string; request: HermesOrchestratorRequest<any> }> = [
    {
      label: "create draft as CLIENT",
      request: {
        action: "create_order_draft",
        payload: {
          phone,
          kitchenId,
          items: [{ productName: "Taco", quantity: 1 }],
          deliveryType: "PICKUP",
          paymentMethod: "CASH",
          comments: "Hermes orchestrator demo"
        }
      }
    }
  ];

  const createResult = await orchestrator.execute(steps[0].request);
  printStep(steps[0].label, createResult);

  if (!createResult.ok || !createResult.adapterResult.data?.orderId) {
    process.exitCode = 1;
    return;
  }

  const orderId = String(createResult.adapterResult.data.orderId);

  const followUpSteps: Array<{ label: string; request: HermesOrchestratorRequest<any> }> = [
    {
      label: "query pending as KITCHEN",
      request: {
        action: "query_orders",
        payload: {
          actor: {
            role: "KITCHEN",
            kitchenId
          },
          filter: "pending"
        }
      }
    },
    {
      label: "read order as CLIENT",
      request: {
        action: "get_order",
        payload: {
          actor: {
            role: "CLIENT",
            phone
          },
          orderId
        }
      }
    },
    {
      label: "confirm order as CLIENT",
      request: {
        action: "change_order_status",
        payload: {
          actor: {
            role: "CLIENT",
            phone
          },
          orderId,
          targetOrderStatus: "CONFIRMED"
        }
      }
    },
    {
      label: "query active as KITCHEN",
      request: {
        action: "query_orders",
        payload: {
          actor: {
            role: "KITCHEN",
            kitchenId
          },
          filter: "active"
        }
      }
    },
    {
      label: "mark delivered as KITCHEN",
      request: {
        action: "change_order_status",
        payload: {
          actor: {
            role: "KITCHEN",
            kitchenId
          },
          orderId,
          targetOrderStatus: "DELIVERED"
        }
      }
    },
    {
      label: "query completed as KITCHEN",
      request: {
        action: "query_orders",
        payload: {
          actor: {
            role: "KITCHEN",
            kitchenId
          },
          filter: "completed"
        }
      }
    }
  ];

  let hasFailure = !createResult.ok;

  for (const step of followUpSteps) {
    const result = await orchestrator.execute(step.request);
    printStep(step.label, result);
    if (!result.ok) {
      hasFailure = true;
    }
  }

  process.exitCode = hasFailure ? 1 : 0;
}

function printStep(label: string, result: {
  request: unknown;
  adapterResult: unknown;
  finalResponse: unknown;
  ok: boolean;
  action: HermesActionName;
}) {
  console.log(`\n=== ${label} ===`);
  console.log(`action=${result.action} ok=${result.ok}`);
  console.log("input:");
  console.log(JSON.stringify(result.request, null, 2));
  console.log("adapterResult:");
  console.log(JSON.stringify(result.adapterResult, null, 2));
  console.log("finalResponse:");
  console.log(JSON.stringify(result.finalResponse, null, 2));
}

async function loadRequestFile(path: string) {
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
}

function getFlagValue(flagName: string) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

async function waitForBackend(baseUrl: string) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/`);
      if (response.status > 0) {
        return;
      }
    } catch {
      // Retry until the backend is reachable or the timeout expires.
    }

    await sleep(750);
  }

  throw new Error(`KitchenIA backend did not become reachable at ${baseUrl} within 15 seconds.`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Hermes orchestrator demo failed.");
  console.error(error);
  process.exitCode = 1;
});
